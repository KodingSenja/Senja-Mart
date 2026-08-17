import type { Product, ProductBadge } from 'types/product';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';
import { slugify } from 'lib/utils/slugify';
import { adjustStock } from 'lib/services/inventory';

/** Shape of a products row (joined with categories + product_images). */
interface ProductRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price: number | string;
  compare_price: number | string | null;
  image_url: string | null;
  is_active: boolean;
  category_id: string | null;
  unit: string | null;
  featured: boolean;
  badge: string | null;
  rating: number | string | null;
  review_count: number | null;
  stock: number;
  reserved_stock: number;
  low_stock_threshold: number;
  is_popular: boolean;
  created_at: string;
  categories?: { id: string; name: string; slug: string } | null;
  product_images?: { image_url: string; sort_order: number }[];
}

/** Map a raw Supabase row to the app's Product shape. */
function mapProduct(row: ProductRow): Product {
  const images = [...(row.product_images ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((img) => img.image_url);
  const image = row.image_url ?? images[0] ?? '';
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    price: Number(row.price) || 0,
    compareAtPrice: row.compare_price != null ? Number(row.compare_price) : null,
    image,
    images: images.length > 0 ? images : [image],
    categoryId: row.category_id,
    category: row.categories
      ? {
          id: row.categories.id,
          name: row.categories.name,
          slug: row.categories.slug,
        }
      : null,
    unit: row.unit ?? '',
    rating: Number(row.rating) || 0,
    reviewCount: row.review_count ?? 0,
    badge: ['sale', 'hot', 'new'].includes(row.badge ?? '')
      ? (row.badge as ProductBadge)
      : null,
    stock: row.stock ?? 0,
    reservedStock: row.reserved_stock ?? 0,
    lowStockThreshold: row.low_stock_threshold ?? 5,
    featured: row.featured ?? false,
    isPopular: row.is_popular ?? false,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export interface GetProductsOptions {
  categoryId?: string;
  featured?: boolean;
  limit?: number;
  includeInactive?: boolean;
  search?: string;
}

/** Insert / update payload (fields editable by the admin). */
export interface ProductInput {
  name: string;
  slug?: string;
  description?: string;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  /** Ambang minimum untuk status "Stok Menipis". */
  lowStockThreshold?: number;
  unit?: string;
  categoryId: string | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  featured?: boolean;
  badge?: ProductBadge | null;
  isActive?: boolean;
  isPopular?: boolean;
}

const SELECT = '*, categories(id, name, slug), product_images(image_url, sort_order)';

/**
 * Product service — Supabase is the single source of truth.
 * When Supabase is not configured there is no catalog data at all
 * (no mock/seed fallback).
 */
export async function getProducts(options: GetProductsOptions = {}): Promise<Product[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  let query = supabase.from('products').select(SELECT);
  if (!options.includeInactive) {
    query = query.eq('is_active', true);
  }
  if (options.categoryId) {
    query = query.eq('category_id', options.categoryId);
  }
  if (options.featured) {
    query = query.eq('featured', true);
  }
  if (options.search) {
    query = query.ilike('name', `%${options.search}%`);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (!error && data) {
    return (data as ProductRow[]).map(mapProduct);
  }
  return [];
}

/** Active popular products for the "Produk Populer" homepage section. */
export async function getPopularProducts(): Promise<Product[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('products')
    .select(SELECT)
    .eq('is_active', true)
    .eq('is_popular', true)
    .order('created_at', { ascending: false });
  if (!error && data) {
    return (data as ProductRow[]).map(mapProduct);
  }
  return [];
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from('products')
    .select(SELECT)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (!error && data) return mapProduct(data as ProductRow);
  return null;
}

export async function getProductById(id: string): Promise<Product | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from('products')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!error && data) return mapProduct(data as ProductRow);
  return null;
}

export async function getProductsByCategory(categoryId: string): Promise<Product[]> {
  return getProducts({ categoryId });
}

export async function getRelatedProducts(product: Product, limit = 4): Promise<Product[]> {
  const sameCategory = await getProducts({ categoryId: product.categoryId ?? undefined });
  return sameCategory.filter((p) => p.id !== product.id).slice(0, limit);
}

// ------------------------------------------------------------------
// Admin CRUD — all writes go straight to Supabase.
// ------------------------------------------------------------------

export async function createProduct(input: ProductInput): Promise<Product> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa menyimpan produk.');
  }
  const slug = input.slug?.trim() || slugify(input.name);
  const imageUrls = input.imageUrls?.length
    ? input.imageUrls
    : input.imageUrl
      ? [input.imageUrl]
      : [];

  const { data, error } = await supabase
    .from('products')
    .insert({
      name: input.name,
      slug,
      description: input.description ?? '',
      price: input.price,
      compare_price: input.compareAtPrice ?? null,
      // Stok awal diset 0 lalu dinaikkan lewat RPC adjust_stock agar tercatat
      // di stock_movements dan tervalidasi (tidak pernah negatif).
      stock: 0,
      low_stock_threshold: input.lowStockThreshold ?? 5,
      unit: input.unit ?? '',
      category_id: input.categoryId,
      image_url: imageUrls[0] ?? null,
      featured: input.featured ?? false,
      badge: input.badge ?? null,
      is_active: input.isActive ?? true,
      is_popular: input.isPopular ?? false,
    })
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  const product = data as ProductRow;

  // Stok awal dicatat sebagai Restock (audited). Jika gagal, hapus produk
  // yang baru dibuat agar tidak menyisakan baris setengah jadi.
  if ((input.stock ?? 0) > 0) {
    try {
      await adjustStock(product.id, input.stock, 'Stok awal', 'restock');
    } catch (adjustErr) {
      await supabase.from('products').delete().eq('id', product.id);
      throw adjustErr;
    }
  }

  // Persist the rest of the gallery into product_images.
  if (imageUrls.length > 1) {
    const rows = imageUrls.slice(1).map((url, i) => ({
      product_id: product.id,
      image_url: url,
      sort_order: i + 1,
    }));
    const { error: imgError } = await supabase.from('product_images').insert(rows);
    if (imgError) throw new Error(imgError.message);
  }

  return mapProduct({
    ...product,
    stock: input.stock ?? 0,
    product_images: imageUrls.map((url, i) => ({ image_url: url, sort_order: i })),
  });
}

export async function updateProduct(id: string, input: ProductInput): Promise<Product> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa mengubah produk.');
  }
  const slug = input.slug?.trim() || slugify(input.name);
  const imageUrls = input.imageUrls?.length
    ? input.imageUrls
    : input.imageUrl
      ? [input.imageUrl]
      : [];

  // Stok lama dibaca dulu: perubahan stok dicatat via RPC adjust_stock
  // (tidak pernah lewat UPDATE langsung) agar selalu masuk riwayat.
  const { data: existing } = (await supabase
    .from('products')
    .select('stock')
    .eq('id', id)
    .maybeSingle()) as { data: { stock: number | string } | null; error: unknown };
  const oldStock =
    existing && existing.stock != null ? Number(existing.stock) || 0 : null;

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = slug;
  if (input.description !== undefined) patch.description = input.description;
  if (input.price !== undefined) patch.price = input.price;
  if (input.compareAtPrice !== undefined) patch.compare_price = input.compareAtPrice;
  if (input.lowStockThreshold !== undefined)
    patch.low_stock_threshold = input.lowStockThreshold;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.imageUrls !== undefined) patch.image_url = imageUrls[0] ?? null;
  if (input.featured !== undefined) patch.featured = input.featured;
  if (input.badge !== undefined) patch.badge = input.badge;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.isPopular !== undefined) patch.is_popular = input.isPopular;

  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  const product = data as ProductRow;

  // Replace the gallery with the submitted set (delete-then-insert so
  // shrinking the gallery never leaves orphaned product_images rows).
  const { error: delError } = await supabase
    .from('product_images')
    .delete()
    .eq('product_id', id);
  if (delError) throw new Error(delError.message);

  if (imageUrls.length > 1) {
    const rows = imageUrls.slice(1).map((url, i) => ({
      product_id: id,
      image_url: url,
      sort_order: i + 1,
    }));
    const { error: imgError } = await supabase.from('product_images').insert(rows);
    if (imgError) throw new Error(imgError.message);
  }

  // Ubah stok lewat RPC agar tercatat di riwayat.
  if (oldStock != null && input.stock !== undefined && input.stock !== oldStock) {
    await adjustStock(id, input.stock - oldStock, 'Edit produk — ubah stok', 'adjustment');
  }

  return mapProduct({
    ...product,
    stock: input.stock ?? oldStock ?? 0,
    low_stock_threshold: input.lowStockThreshold ?? product.low_stock_threshold,
    product_images: imageUrls.map((url, i) => ({ image_url: url, sort_order: i })),
  });
}

export async function deleteProduct(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa menghapus produk.');
  }
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setProductActive(id: string, isActive: boolean): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setProductPopular(id: string, isPopular: boolean): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase.from('products').update({ is_popular: isPopular }).eq('id', id);
  if (error) throw new Error(error.message);
}


