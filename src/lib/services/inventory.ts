import type {
  InventoryProduct,
  StockMovement,
  StockMovementType,
  StockStatus,
} from 'types/inventory';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

/**
 * Inventory service — stok & riwayat stok langsung dari Supabase.
 *
 * Sumber kebenaran stok adalah tabel `products` (stock + reserved_stock).
 * Semua perubahan stok melewati RPC security-definer (adjust_stock /
 * fulfill_order_stock / release_order_reservation / cancel_order) sehingga
 * customer tidak bisa memanipulasi stok dan setiap perubahan tercatat di
 * `stock_movements`.
 */

/** Status stok: Aman / Menipis / Habis (rule Fase 5). */
export function stockStatus(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return 'out';
  if (stock <= threshold) return 'low';
  return 'safe';
}

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  safe: 'Aman',
  low: 'Menipis',
  out: 'Habis',
};

interface InventoryProductRow {
  id: string;
  name: string;
  slug: string;
  image_url: string | null;
  price: number | string;
  category_id: string | null;
  stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  categories?: { id: string; name: string } | null;
}

function mapInventoryProduct(row: InventoryProductRow): InventoryProduct {
  // PostgREST dapat mengembalikan relasi to-one sebagai objek ATAU array;
  // tangani keduanya agar aman.
  const category = Array.isArray(row.categories)
    ? row.categories[0]
    : row.categories;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image_url ?? '',
    price: Number(row.price) || 0,
    categoryId: row.category_id,
    categoryName: category?.name ?? null,
    stock: row.stock ?? 0,
    reservedStock: row.reserved_stock ?? 0,
    lowStockThreshold: row.low_stock_threshold ?? 5,
    isActive: row.is_active,
  };
}

/** Semua produk (termasuk nonaktif) dengan info stok — untuk halaman Stok. */
export async function getInventoryProducts(): Promise<InventoryProduct[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('products')
    .select(
      'id, name, slug, image_url, price, category_id, stock, reserved_stock, low_stock_threshold, is_active, categories(id, name)'
    )
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as InventoryProductRow[]).map(mapInventoryProduct);
}

interface MovementRow {
  id: string;
  product_id: string;
  type: StockMovementType;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reference_type: string;
  reference_id: string | null;
  note: string | null;
  created_at: string;
  products?: { name: string } | null;
  profiles?: { full_name: string | null } | null;
}

function mapMovement(row: MovementRow): StockMovement {
  const product = Array.isArray(row.products) ? row.products[0] : row.products;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    id: row.id,
    productId: row.product_id,
    productName: product?.name ?? 'Produk',
    type: row.type,
    quantity: row.quantity,
    stockBefore: row.stock_before,
    stockAfter: row.stock_after,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    note: row.note,
    adminName: profile?.full_name ?? null,
    createdAt: row.created_at,
  };
}

/** Riwayat perubahan stok (terbaru dulu). Admin-only via RLS. */
export async function getStockMovements(limit = 200): Promise<StockMovement[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('stock_movements')
    .select(
      'id, product_id, type, quantity, stock_before, stock_after, reference_type, reference_id, note, created_at, products(name), profiles(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as MovementRow[]).map(mapMovement);
}

/** Label Indonesia untuk jenis movement. */
export const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  restock: 'Restock',
  sale: 'Penjualan',
  adjustment: 'Penyesuaian',
  cancellation: 'Pembatalan',
  refund: 'Refund',
};

/**
 * Admin adjustment (Tambah/Kurangi) via RPC security-definer.
 * `delta` bertanda: positif = restock, negatif = kurangi.
 */
export async function adjustStock(
  productId: string,
  delta: number,
  note: string,
  type: 'restock' | 'adjustment'
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase.rpc('adjust_stock', {
    p_product_id: productId,
    p_delta: delta,
    p_note: note,
    p_type: type,
  });
  if (error) {
    const message = error.message ?? '';
    if (message.includes('stock_negative')) {
      throw new Error('Stok tidak boleh negatif.');
    }
    if (message.includes('stock_below_reserved')) {
      throw new Error(
        'Stok tidak bisa dikurangi di bawah jumlah yang sudah dipesan (reserved).'
      );
    }
    if (message.includes('admin_required')) {
      throw new Error('Hanya admin yang bisa menyesuaikan stok.');
    }
    throw new Error('Gagal menyesuaikan stok. Silakan coba lagi.');
  }
}
