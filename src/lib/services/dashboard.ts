import type { OrderStatus, PaymentStatus } from 'types/order';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

/**
 * Dashboard Analytics — aggregates REAL Supabase data only (never mock).
 *
 * Data comes from three tables the admin is allowed to read via RLS:
 *   * orders (+ nested order_items)          → omzet, counts, chart, terlaris, recent
 *   * products                               → stok menipis
 *
 * No DB change / no new migration is required: everything is aggregated
 * client-side from the same tables the admin pages already read.
 */

export interface RevenuePoint {
  date: string; // yyyy-mm-dd (Asia/Jakarta)
  revenue: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  quantitySold: number;
  revenue: number;
}

export interface RecentOrder {
  id: string;
  orderNumber: string | null;
  customer: string | null;
  total: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

export interface LowStockProduct {
  id: string;
  name: string;
  image: string;
  stock: number;
}

export interface DashboardAnalytics {
  revenueToday: number;
  revenue7d: number;
  revenue30d: number;
  orderCounts: Record<OrderStatus, number>;
  totalOrders: number;
  /** Last 30 days (Asia/Jakarta), zero-filled so the chart can slice 7/30. */
  revenueByDay: RevenuePoint[];
  topProducts: TopProduct[];
  recentOrders: RecentOrder[];
  lowStock: LowStockProduct[];
  /** Produk dengan stock = 0 (habis). */
  outOfStockCount: number;
  /** Produk dengan 0 < stock <= LOW_STOCK_THRESHOLD (menipis). */
  lowStockCount: number;
}

/** Produk dengan stok ≤ nilai ini dianggap "stok menipis" di dashboard. */
export const LOW_STOCK_THRESHOLD = 20;
const RECENT_ORDERS_LIMIT = 8;
const TOP_PRODUCTS_LIMIT = 5;
const LOW_STOCK_LIMIT = 8;

const JAKARTA_OFFSET_MS = 7 * 60 * 60 * 1000; // UTC+7 (WIB)
const DAY_MS = 24 * 60 * 60 * 1000;

/** Bucket an ISO timestamp into its Asia/Jakarta calendar date (yyyy-mm-dd). */
function jakartaDateKey(iso: string): string {
  return new Date(new Date(iso).getTime() + JAKARTA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Start (UTC ISO) of the day `daysAgo` days before today, in Jakarta. */
function daysAgoStartUTC(daysAgo: number): string {
  const jakartaNow = new Date(Date.now() + JAKARTA_OFFSET_MS);
  const todayStartJakarta = Date.UTC(
    jakartaNow.getUTCFullYear(),
    jakartaNow.getUTCMonth(),
    jakartaNow.getUTCDate()
  );
  const start = todayStartJakarta - daysAgo * DAY_MS - JAKARTA_OFFSET_MS;
  return new Date(start).toISOString();
}

function emptyOrderCounts(): Record<OrderStatus, number> {
  return {
    pending: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  };
}

interface OrderItemRow {
  product_id: string | null;
  product_name: string;
  price: number | string;
  quantity: number;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  total: number | string;
  status: string;
  payment_status: string;
  created_at: string;
  shipping_address: Record<string, unknown> | null;
  order_items?: OrderItemRow[] | null;
}

interface ProductRow {
  id: string;
  name: string;
  image_url: string | null;
  stock: number;
  low_stock_threshold: number;
}

/** Fallback used when Supabase isn't configured (no mock numbers). */
function emptyAnalytics(): DashboardAnalytics {
  return {
    revenueToday: 0,
    revenue7d: 0,
    revenue30d: 0,
    orderCounts: emptyOrderCounts(),
    totalOrders: 0,
    revenueByDay: Array.from({ length: 30 }, (_, i) => ({
      date: daysAgoStartUTC(29 - i).slice(0, 10),
      revenue: 0,
    })),
    topProducts: [],
    recentOrders: [],
    lowStock: [],
    outOfStockCount: 0,
    lowStockCount: 0,
  };
}

/**
 * Load + aggregate dashboard analytics from Supabase.
 * Throws when a query fails (the page shows an error instead of fake data).
 */
export async function getDashboardAnalytics(): Promise<DashboardAnalytics> {
  if (!isSupabaseConfigured || !supabase) return emptyAnalytics();

  const [{ data: orders, error: orderError }, { data: products, error: productError }] =
    await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, order_number, total, status, payment_status, created_at, shipping_address, order_items(product_id, product_name, price, quantity)'
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('products')
        .select('id, name, image_url, stock, low_stock_threshold')
        .order('stock', { ascending: true })
        .limit(200),
    ]);

  if (orderError) throw new Error(orderError.message);
  if (productError) throw new Error(productError.message);

  const rows = (orders ?? []) as OrderRow[];
  const productsRows = (products ?? []) as ProductRow[];

  // ---- Omzet (paid & non-cancelled only, same definition as reports.ts) ----
  const todayStart = daysAgoStartUTC(0);
  const weekStart = daysAgoStartUTC(6);
  const monthStart = daysAgoStartUTC(29);

  let revenueToday = 0;
  let revenue7d = 0;
  let revenue30d = 0;

  const orderCounts = emptyOrderCounts();
  const byDay = new Map<string, number>();
  const topById = new Map<
    string,
    { name: string; quantitySold: number; revenue: number }
  >();
  const recentOrders: RecentOrder[] = [];

  for (const o of rows) {
    const total = Number(o.total) || 0;
    const status = o.status as OrderStatus;
    const created = o.created_at;
    const cancelled = status === 'cancelled';
    // Omzet hanya dari order lunas (paid) dan tidak dibatalkan. Unpaid /
    // pending / expired / failed / refunded tidak pernah dihitung — konsisten
    // dengan reports.ts.
    const validRevenue = o.payment_status === 'paid' && !cancelled;

    if (Object.prototype.hasOwnProperty.call(orderCounts, status)) {
      orderCounts[status] += 1;
    }

    if (validRevenue) {
      if (created >= todayStart) revenueToday += total;
      if (created >= weekStart) revenue7d += total;
      if (created >= monthStart) revenue30d += total;

      const key = jakartaDateKey(created);
      byDay.set(key, (byDay.get(key) ?? 0) + total);

      // Top products from the order's line items.
      for (const item of o.order_items ?? []) {
        const pid = item.product_id ?? item.product_name;
        const price = Number(item.price) || 0;
        const qty = item.quantity || 0;
        const agg = topById.get(pid) ?? {
          name: item.product_name || 'Produk',
          quantitySold: 0,
          revenue: 0,
        };
        agg.quantitySold += qty;
        agg.revenue += price * qty;
        topById.set(pid, agg);
      }
    }

    if (recentOrders.length < RECENT_ORDERS_LIMIT) {
      recentOrders.push({
        id: o.id,
        orderNumber: o.order_number ?? null,
        customer:
          (o.shipping_address?.name as string | undefined) ?? null,
        total,
        status,
        paymentStatus: (o.payment_status as PaymentStatus) ?? 'unpaid',
      });
    }
  }

  // ---- 30-day revenue series (zero-filled) ----
  const revenueByDay: RevenuePoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = jakartaDateKey(daysAgoStartUTC(i));
    revenueByDay.push({ date: d, revenue: byDay.get(d) ?? 0 });
  }

  const topProducts: TopProduct[] = [...topById.entries()]
    .map(([productId, v]) => ({
      productId,
      name: v.name,
      quantitySold: v.quantitySold,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, TOP_PRODUCTS_LIMIT);

  // Perilaku dashboard existing dipertahankan: ambang global 20 (tidak
  // mengubah card "Stok Menipis" yang sudah PASS). Halaman Stok memakai
  // low_stock_threshold per produk — keduanya independen.
  const outOfStockCount = productsRows.filter((p) => p.stock === 0).length;
  const lowStockCount = productsRows.filter(
    (p) => p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD
  ).length;

  const lowStock: LowStockProduct[] = productsRows
    .filter((p) => p.stock <= LOW_STOCK_THRESHOLD)
    .slice(0, LOW_STOCK_LIMIT)
    .map((p) => ({
      id: p.id,
      name: p.name,
      image: p.image_url ?? '',
      stock: p.stock,
    }));

  return {
    revenueToday,
    revenue7d,
    revenue30d,
    orderCounts,
    totalOrders: rows.length,
    revenueByDay,
    topProducts,
    recentOrders,
    lowStock,
    outOfStockCount,
    lowStockCount,
  };
}
