'use client';

import { supabase, isSupabaseConfigured } from 'lib/supabase/client';

const BUCKET = 'product-images';
const MARKETING_BUCKET = 'marketing-content';

/** Upload an image file and return its public URL. */
export async function uploadProductImage(
  file: File,
  folder = 'products'
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 60);
  const path = `${folder}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/** Delete an object by its storage path. */
export async function deleteStorageObject(path: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  // Only delete objects inside our bucket.
  const bucketPrefix = `/object/public/${BUCKET}/`;
  const idx = path.indexOf(bucketPrefix);
  const storagePath = idx >= 0 ? path.slice(idx + bucketPrefix.length) : path;
  if (!storagePath || storagePath.includes('..')) return;

  const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (error) console.error('Gagal menghapus gambar:', error.message);
}

/**
 * Upload an image for marketing content (hero slider / banner) into the
 * `marketing-content` bucket under the given folder. Returns its public URL.
 */
export async function uploadMarketingImage(
  file: File,
  folder: 'hero' | 'banner'
): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase belum dikonfigurasi.');
  }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 60);
  const path = `${folder}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage
    .from(MARKETING_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(MARKETING_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

/**
 * Delete a marketing image by public URL or storage path. Only objects that
 * actually live inside the `marketing-content` bucket are touched — local
 * fallback assets in /public are never deleted.
 */
export async function deleteMarketingImage(pathOrUrl: string): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const bucketPrefix = `/object/public/${MARKETING_BUCKET}/`;
  const idx = pathOrUrl.indexOf(bucketPrefix);
  if (idx < 0) return; // not stored in the marketing-content bucket
  const storagePath = pathOrUrl.slice(idx + bucketPrefix.length);
  if (!storagePath || storagePath.includes('..')) return;

  const { error } = await supabase.storage
    .from(MARKETING_BUCKET)
    .remove([storagePath]);
  if (error) console.error('Gagal menghapus gambar marketing:', error.message);
}
