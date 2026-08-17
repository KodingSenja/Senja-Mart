/**
 * Admin Global Search — reads-only, cross-dashboard lookup.
 *
 * Searches three entities (products, categories, orders) in ONE debounced
 * call (three parallel queries) and returns lightweight results for the
 * navbar dropdown. Never writes anything: no orders, no products, no
 * categories, no payment/order status changes.
 *
 * Authorization is inherited from RLS: the navbar only renders inside the
 * admin layout, and the signed-in user's session drives these queries, so
 * non-admins cannot read orders through this path (same policy as the
 * existing admin services).
 */
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';
import { formatRupiah } from 'lib/utils/format';

export type GlobalSearchEntity = 'product' | 'category' | 'order';

export interface GlobalSearchResult {
  id: string;
  type: GlobalSearchEntity;
  title: string;
  subtitle: string;
  /** Destination page in the admin dashboard (never a per-row page). */
  href: string;
}

/** Max results per entity — keeps the dropdown fast and focused. */
const RESULT_LIMIT = 5;

/** Embedded `categories(name)` — PostgREST returns a single object for the
 * to-one FK, but supabase-js types it as an array; accept both. */
type ProductCategoryHit =
  | { name: string }
  | { name: string }[]
  | null
  | undefined;

interface ProductHit {
  id: string;
  name: string;
  slug: string;
  price: number | string;
  categories?: ProductCategoryHit;
}

interface CategoryHit {
  id: string;
  name: string;
  slug: string;
  products?: { count: number }[];
}

interface OrderHit {
  id: string;
  order_number: string | null;
  status: string;
  payment_status: string;
  total: number | string;
  shipping_address: Record<string, unknown> | null;
}

const orderStatusLabels: Record<string, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
};

/**
 * Search products / categories / orders for `query` (case-insensitive).
 * Returns an empty array when Supabase is not configured. Throws when a
 * real query fails so the dropdown can show an error state.
 */
export async function searchGlobal(query: string): Promise<GlobalSearchResult[]> {
  const q = query.trim();
  if (!q || !isSupabaseConfigured || !supabase) return [];

  const like = `%${q}%`;

  const [pRes, cRes, oRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, slug, price, categories(name)')
      .ilike('name', like)
      .order('created_at', { ascending: false })
      .limit(RESULT_LIMIT),
    supabase
      .from('categories')
      .select('id, name, slug, products:products(count)')
      .ilike('name', like)
      .order('sort_order')
      .limit(RESULT_LIMIT),
    supabase
      .from('orders')
      .select(
        'id, order_number, status, payment_status, total, shipping_address'
      )
      .or(
        `order_number.ilike.${like},shipping_address->>name.ilike.${like}`
      )
      .order('created_at', { ascending: false })
      .limit(RESULT_LIMIT),
  ]);

  // A real failure (RLS, network, malformed query) must surface — the
  // dropdown shows an error state instead of silently pretending there are
  // no results.
  const firstError =
    pRes.error ?? cRes.error ?? oRes.error;
  if (firstError) {
    throw new Error(firstError.message || 'Gagal mencari.');
  }

  const results: GlobalSearchResult[] = [];

  for (const p of (pRes.data as ProductHit[] | null) ?? []) {
    const catName = Array.isArray(p.categories)
      ? p.categories[0]?.name
      : p.categories?.name;
    results.push({
      id: p.id,
      type: 'product',
      title: p.name,
      subtitle: [
        formatRupiah(Number(p.price) || 0),
        catName,
      ]
        .filter(Boolean)
        .join(' · '),
      href: '/admin/senjamart/products',
    });
  }

  for (const c of (cRes.data as CategoryHit[] | null) ?? []) {
    results.push({
      id: c.id,
      type: 'category',
      title: c.name,
      subtitle: `${c.slug} · ${c.products?.[0]?.count ?? 0} produk`,
      href: '/admin/senjamart/categories',
    });
  }

  for (const o of (oRes.data as OrderHit[] | null) ?? []) {
    const customerName = (o.shipping_address as { name?: string } | null)
      ?.name;
    results.push({
      id: o.id,
      type: 'order',
      title: `Pesanan ${o.order_number ?? o.id.slice(0, 8).toUpperCase()}`,
      subtitle: [
        customerName,
        formatRupiah(Number(o.total) || 0),
        orderStatusLabels[o.status] ?? o.status,
      ]
        .filter(Boolean)
        .join(' · '),
      href: '/admin/senjamart/orders',
    });
  }

  return results;
}
