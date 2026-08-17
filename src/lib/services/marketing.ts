import type { MarketingContent, MarketingContentType } from 'types/marketing';
import {
  fallbackHeroSlides,
  fallbackMarketingBanners,
} from 'lib/data/marketing';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

/** Shape of a marketing_content row. */
interface MarketingContentRow {
  id: string;
  type: string;
  image_url: string;
  badge: string | null;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  cta_text: string | null;
  cta_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/** Map a raw Supabase row to the app's MarketingContent shape. */
function mapContent(row: MarketingContentRow): MarketingContent {
  return {
    id: row.id,
    type: (row.type === 'banner' ? 'banner' : 'hero') as MarketingContentType,
    imageUrl: row.image_url,
    badge: row.badge,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    ctaText: row.cta_text,
    ctaUrl: row.cta_url,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface MarketingContentInput {
  type: MarketingContentType;
  imageUrl?: string;
  badge?: string | null;
  title?: string | null;
  subtitle?: string | null;
  description?: string | null;
  ctaText?: string | null;
  ctaUrl?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

const SELECT = '*';

/**
 * Hero slider slides for the storefront homepage.
 * Supabase is the single source of truth. In production the static mock
 * slides are never used — on error or an empty table the real (empty)
 * state is returned so the UI renders the appropriate section instead of
 * silently showing pre-seeded marketing content.
 * The static fallback exists only for local development when Supabase is
 * not configured.
 */
export async function getHeroSlides(): Promise<MarketingContent[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('marketing_content')
      .select(SELECT)
      .eq('type', 'hero')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (!error && data) {
      return (data as MarketingContentRow[]).map(mapContent);
    }
    // Production: never silently fall back to mock content.
    if (process.env.NODE_ENV === 'production') return [];
    return fallbackHeroSlides;
  }
  // Supabase not configured — dev fallback only.
  return process.env.NODE_ENV === 'production' ? [] : fallbackHeroSlides;
}

/** Homepage promo banners (same fallback rules as getHeroSlides). */
export async function getMarketingBanners(): Promise<MarketingContent[]> {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase
      .from('marketing_content')
      .select(SELECT)
      .eq('type', 'banner')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (!error && data) {
      return (data as MarketingContentRow[]).map(mapContent);
    }
    // Production: never silently fall back to mock content.
    if (process.env.NODE_ENV === 'production') return [];
    return fallbackMarketingBanners;
  }
  // Supabase not configured — dev fallback only.
  return process.env.NODE_ENV === 'production' ? [] : fallbackMarketingBanners;
}

/**
 * All marketing content for the admin dashboard.
 * Never falls back — admins must see the real (possibly empty) state.
 */
export async function getAdminMarketingContent(
  options: { type?: MarketingContentType } = {}
): Promise<MarketingContent[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  let query = supabase.from('marketing_content').select(SELECT);
  if (options.type) query = query.eq('type', options.type);
  const { data, error } = await query.order('sort_order', { ascending: true });
  if (!error && data) return (data as MarketingContentRow[]).map(mapContent);
  return [];
}

export async function createMarketingContent(
  input: MarketingContentInput
): Promise<MarketingContent> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Tidak bisa menyimpan konten marketing.'
    );
  }
  const { data, error } = await supabase
    .from('marketing_content')
    .insert({
      type: input.type,
      image_url: input.imageUrl ?? '',
      badge: input.badge ?? null,
      title: input.title ?? null,
      subtitle: input.subtitle ?? null,
      description: input.description ?? null,
      cta_text: input.ctaText ?? null,
      cta_url: input.ctaUrl ?? null,
      is_active: input.isActive ?? true,
      sort_order: input.sortOrder ?? 0,
    })
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapContent(data as MarketingContentRow);
}

export async function updateMarketingContent(
  id: string,
  input: MarketingContentInput
): Promise<MarketingContent> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Tidak bisa mengubah konten marketing.'
    );
  }
  const patch: Record<string, unknown> = {};
  if (input.type) patch.type = input.type;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.badge !== undefined) patch.badge = input.badge;
  if (input.title !== undefined) patch.title = input.title;
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
  if (input.description !== undefined) patch.description = input.description;
  if (input.ctaText !== undefined) patch.cta_text = input.ctaText;
  if (input.ctaUrl !== undefined) patch.cta_url = input.ctaUrl;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

  const { data, error } = await supabase
    .from('marketing_content')
    .update(patch)
    .eq('id', id)
    .select(SELECT)
    .single();

  if (error) throw new Error(error.message);
  return mapContent(data as MarketingContentRow);
}

export async function deleteMarketingContent(id: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error(
      'Supabase belum dikonfigurasi. Tidak bisa menghapus konten marketing.'
    );
  }
  const { error } = await supabase
    .from('marketing_content')
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function setMarketingContentActive(
  id: string,
  isActive: boolean
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const { error } = await supabase
    .from('marketing_content')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) throw new Error(error.message);
}
