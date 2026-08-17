/**
 * Server-side Supabase data access for AI tools.
 *
 * Every query runs through the signed-in user's OWN server-side client
 * (`AgentContext.supabase`), so RLS applies exactly as it does for the admin
 * pages — the AI Agent never bypasses RLS and never uses a service key.
 *
 * All aggregations reuse the project's single revenue definition:
 *   omzet = SUM(total) where payment_status = 'paid' AND status != 'cancelled'
 * (refunded orders are never counted).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Date helpers (Asia/Jakarta, same convention as dashboard.ts / reports.ts)
// ---------------------------------------------------------------------------

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function jakartaDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JAKARTA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Start (UTC ISO) of the Jakarta day `daysAgo` days before today. */
export function daysAgoStartUTC(daysAgo: number): string {
  const jakartaNow = new Date(Date.now() + JAKARTA_OFFSET_MS);
  const todayStartJakarta = Date.UTC(
    jakartaNow.getUTCFullYear(),
    jakartaNow.getUTCMonth(),
    jakartaNow.getUTCDate()
  );
  const start = todayStartJakarta - daysAgo * DAY_MS - JAKARTA_OFFSET_MS;
  return new Date(start).toISOString();
}

export function startOfJakartaMonthUTC(): string {
  const jn = new Date(Date.now() + JAKARTA_OFFSET_MS);
  return new Date(
    Date.UTC(jn.getUTCFullYear(), jn.getUTCMonth(), 1) - JAKARTA_OFFSET_MS
  ).toISOString();
}

export function isUuid(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

// ---------------------------------------------------------------------------
// Row shapes (loose — consistent with the rest of the codebase)
// ---------------------------------------------------------------------------

export interface OrderItemRow {
  id: string;
  product_id: string | null;
  product_name: string;
  product_image: string | null;
  price: number | string;
  quantity: number;
}

export interface OrderRow {
  id: string;
  order_number: string | null;
  user_id: string | null;
  status: string;
  payment_status: string;
  subtotal: number | string;
  shipping_cost: number | string;
  total: number | string;
  shipping_address: Record<string, unknown> | null;
  fulfillment_issue: string | null;
  created_at: string;
  order_items?: OrderItemRow[] | null;
}

export interface ProductRow {
  id: string;
  name: string;
  slug: string;
  price: number | string;
  image_url: string | null;
  stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  is_popular: boolean;
  featured: boolean;
  badge: string | null;
  category_id: string | null;
  categories?: { id: string; name: string } | { id: string; name: string }[] | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function fetchOrders(
  supabase: SupabaseClient,
  opts: {
    status?: string;
    paymentStatus?: string;
    from?: string;
    to?: string;
    limit?: number;
    search?: string;
  } = {}
): Promise<OrderRow[]> {
  let q = supabase
    .from('orders')
    .select('*, order_items(id, product_id, product_name, product_image, price, quantity)');
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.paymentStatus) q = q.eq('payment_status', opts.paymentStatus);
  if (opts.from) q = q.gte('created_at', opts.from);
  if (opts.to) q = q.lt('created_at', opts.to);
  if (opts.search) {
    q = q.or(
      `order_number.ilike.%${opts.search}%,shipping_address->>name.ilike.%${opts.search}%`
    );
  }
  q = q.order('created_at', { ascending: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as OrderRow[];
}

export interface MidtransTxnRow {
  transaction_id: string | null;
  status: string | null;
  amount: number | string;
}

export interface OrderDetailRow extends OrderRow {
  midtrans_transactions?: MidtransTxnRow | MidtransTxnRow[] | null;
}

export async function fetchOrderById(
  supabase: SupabaseClient,
  id: string
): Promise<OrderDetailRow | null> {
  const { data, error } = await supabase
    .from('orders')
    .select(
      '*, order_items(id, product_id, product_name, product_image, price, quantity), midtrans_transactions(transaction_id, status, amount)'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as OrderDetailRow | null) ?? null;
}

export async function fetchProducts(
  supabase: SupabaseClient,
  opts: { search?: string; categoryId?: string; includeInactive?: boolean; limit?: number } = {}
): Promise<ProductRow[]> {
  let q = supabase.from('products').select('*');
  if (!opts.includeInactive) q = q.eq('is_active', true);
  if (opts.categoryId) q = q.eq('category_id', opts.categoryId);
  if (opts.search) q = q.ilike('name', `%${opts.search}%`);
  q = q.order('name', { ascending: true });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductRow[];
}

export async function fetchProductById(
  supabase: SupabaseClient,
  id: string
): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ProductRow | null) ?? null;
}

/**
 * Resolve an admin-friendly reference to an order: either a UUID or an
 * order number (full or partial, e.g. "SJ-20260813-FE1526"). Returns
 * { ambiguous: true } when the partial number matches several orders.
 */
export async function findOrderByReference(
  supabase: SupabaseClient,
  ref: string
): Promise<{ order: OrderDetailRow | null; ambiguous: boolean }> {
  if (isUuid(ref)) {
    const order = await fetchOrderById(supabase, ref);
    return { order, ambiguous: false };
  }
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .ilike('order_number', `%${ref}%`)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { order: null, ambiguous: false };
  if (data.length > 1) return { order: null, ambiguous: true };
  const order = await fetchOrderById(supabase, (data[0] as { id: string }).id);
  return { order, ambiguous: false };
}

/**
 * Resolve a reference to a product: either a UUID or a product name
 * (exact, then case-insensitive contains — ambiguous matches are rejected).
 */
export async function findProductByReference(
  supabase: SupabaseClient,
  ref: string
): Promise<{ product: ProductRow | null; ambiguous: boolean }> {
  if (isUuid(ref)) {
    const product = await fetchProductById(supabase, ref);
    return { product, ambiguous: false };
  }
  const { data, error } = await supabase
    .from('products')
    .select('id')
    .ilike('name', `%${ref}%`)
    .limit(2);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { product: null, ambiguous: false };
  if (data.length > 1) return { product: null, ambiguous: true };
  const product = await fetchProductById(supabase, (data[0] as { id: string }).id);
  return { product, ambiguous: false };
}

export async function fetchCategories(
  supabase: SupabaseClient,
  limit = 50
): Promise<CategoryRow[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, image_url, is_active')
    .order('sort_order')
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CategoryRow[];
}

export async function fetchCustomerCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Aggregations (revenue definition is the single source of truth)
// ---------------------------------------------------------------------------

export interface RevenueAgg {
  omzet: number;
  orderCount: number;
  paidCount: number;
}

export function isRevenueOrder(o: { payment_status: string; status: string }): boolean {
  return o.payment_status === 'paid' && o.status !== 'cancelled';
}

export function num(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function customerName(o: { shipping_address: Record<string, unknown> | null }): string | null {
  const name = o.shipping_address?.name;
  return typeof name === 'string' && name.trim() ? name : null;
}

/** Aggregate omzet + counts from raw order rows. */
export function aggregateRevenue(rows: OrderRow[]): RevenueAgg {
  let omzet = 0;
  let orderCount = 0;
  let paidCount = 0;
  for (const o of rows) {
    orderCount += 1;
    if (o.payment_status === 'paid') paidCount += 1;
    if (isRevenueOrder(o)) omzet += num(o.total);
  }
  return { omzet, orderCount, paidCount };
}

/** Daily omzet series (Jakarta calendar days) over the last N days, zero-filled. */
export function dailyRevenueSeries(rows: OrderRow[], days: number): { date: string; revenue: number }[] {
  const byDay = new Map<string, number>();
  for (const o of rows) {
    if (!isRevenueOrder(o)) continue;
    const key = jakartaDateKey(o.created_at);
    byDay.set(key, (byDay.get(key) ?? 0) + num(o.total));
  }
  const series: { date: string; revenue: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = jakartaDateKey(daysAgoStartUTC(i));
    series.push({ date: d, revenue: byDay.get(d) ?? 0 });
  }
  return series;
}

/** Top products by units sold from paid, non-cancelled orders' line items. */
export function topProductsFromOrders(
  rows: OrderRow[],
  limit = 5
): { id: string; name: string; quantitySold: number; revenue: number }[] {
  const agg = new Map<string, { name: string; quantitySold: number; revenue: number }>();
  for (const o of rows) {
    if (!isRevenueOrder(o)) continue;
    for (const item of o.order_items ?? []) {
      const pid = item.product_id ?? `snapshot:${item.product_name}`;
      const cur = agg.get(pid) ?? {
        name: item.product_name || 'Produk',
        quantitySold: 0,
        revenue: 0,
      };
      cur.quantitySold += item.quantity;
      cur.revenue += num(item.price) * item.quantity;
      agg.set(pid, cur);
    }
  }
  return [...agg.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, limit);
}
