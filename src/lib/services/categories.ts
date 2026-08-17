import type { Category } from 'types/category';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';
import { slugify } from 'lib/utils/slugify';

/** Shape of a categories row (with embedded product count). */
interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  products?: { count: number }[];
}

/** Map a raw Supabase row to the app's Category shape. */
function mapCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    image: row.image_url ?? '',
    description: row.description ?? null,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    productCount: row.products?.[0]?.count ?? 0,
  };
}

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
  imageUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

const SELECT = '*, products:products(count)';

/** Active categories for the storefront, ordered by sort_order then name. */
export async function getActiveCategories(): Promise<Category[]> {
  return getCategories({ includeInactive: false });
}

/**
 * Category service — Supabase is the single source of truth.
 * When Supabase is not configured there is no catalog data at all
 * (no mock/seed fallback).
 */
export async function getCategories(
  options: { includeInactive?: boolean } = {}
): Promise<Category[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  let query = supabase.from('categories').select(SELECT);
  if (!options.includeInactive) {
    query = query.eq('is_active', true);
  }
  const { data, error } = await query.order('sort_order').order('name');
  if (!error && data) {
    return (data as CategoryRow[]).map(mapCategory);
  }
  return [];
}

export async function getCategoryBySlug(slug: string): Promise<Category | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from('categories')
    .select(SELECT)
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle();
  if (!error && data) return mapCategory(data as CategoryRow);
  return null;
}

export async function getCategoryById(id: string): Promise<Category | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase
    .from('categories')
    .select(SELECT)
    .eq('id', id)
    .maybeSingle();
  if (!error && data) return mapCategory(data as CategoryRow);
  return null;
}

// ------------------------------------------------------------------
// Admin CRUD — all writes go straight to Supabase.
// ------------------------------------------------------------------

export async function createCategory(input: CategoryInput): Promise<Category> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa menyimpan kategori.');
  }
  const slug = input.slug?.trim() || slugify(input.name);
  const { data, error } = await supabase
    .from('categories')
    .insert({
      name: input.name,
      slug,
      description: input.description ?? null,
      image_url: input.imageUrl ?? null,
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapCategory(data as CategoryRow);
}

export async function updateCategory(id: string, input: CategoryInput): Promise<Category> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa mengubah kategori.');
  }
  const slug = input.slug?.trim() || slugify(input.name);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = slug;
  if (input.description !== undefined) patch.description = input.description;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapCategory(data as CategoryRow);
}

export async function deleteCategory(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi. Tidak bisa menghapus kategori.');
  }
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setCategoryActive(id: string, isActive: boolean): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase.from('categories').update({ is_active: isActive }).eq('id', id);
  if (error) throw new Error(error.message);
}
