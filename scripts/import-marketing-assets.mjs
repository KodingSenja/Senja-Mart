#!/usr/bin/env node
/**
 * SENJA MART — BULK IMPORT MARKETING ASSETS (hero slider + banner)
 * ==================================================================
 * Imports the locally existing hero/banner assets into Supabase so the
 * admin page /admin/senjamart/marketing is populated and the homepage
 * keeps showing the exact same content (via the fallback copy in
 * src/lib/data/marketing.ts, which is imported directly — no copy drift).
 *
 * What it does per asset:
 *   1. uploads the file to the "marketing-content" bucket (hero/ | banner/)
 *   2. builds the public URL
 *   3. inserts a marketing_content record (type, text, is_active, sort_order)
 *
 * Idempotent & safe to re-run:
 *   - never creates a duplicate file (checks the bucket first)
 *   - never creates a duplicate record (checks existing rows first)
 *   - never deletes local assets or existing rows
 *
 * Run:
 *   node --env-file=.env.local --experimental-strip-types \
 *     scripts/import-marketing-assets.mjs
 *
 * Options:
 *   --dry-run            only report what would happen, write nothing
 *   --include-unmapped   also import slider/banner files that have no
 *                        fallback copy (as is_active = false, empty text)
 *
 * Auth: inserts/uploads require an admin session (RLS uses is_admin()).
 * Credentials come from SUPA_ADMIN_EMAIL / SUPA_ADMIN_PASSWORD, or the
 * existing IT_ADMIN_EMAIL / IT_PASSWORD convention.
 */
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fallbackHeroSlides, fallbackMarketingBanners } from '../src/lib/data/marketing.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ADMIN_EMAIL = process.env.SUPA_ADMIN_EMAIL || process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.SUPA_ADMIN_PASSWORD || process.env.IT_PASSWORD || '';

const DRY_RUN = process.argv.includes('--dry-run');
const INCLUDE_UNMAPPED = process.argv.includes('--include-unmapped');

const BUCKET = 'marketing-content';
const SLIDER_DIR = path.join(ROOT, 'public/senjamart/slider');
const BANNER_DIR = path.join(ROOT, 'public/senjamart/banner');

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(1);
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
};

const mimeFor = (name) =>
  MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';

const storagePathFor = (type, filename) =>
  `${type === 'hero' ? 'hero' : 'banner'}/${filename}`;

const publicUrlFor = (storagePath) =>
  `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

const stats = {
  sliderFiles: 0,
  bannerFiles: 0,
  importedHero: 0,
  importedBanner: 0,
  skippedExisting: 0,
  skippedUnmapped: 0,
  errors: 0,
  storagePaths: [],
  createdRecords: 0,
};

const log = (msg) => console.log(msg);
const error = (msg) => {
  stats.errors += 1;
  console.error('  [ERROR]', msg);
};

// ------------------------------------------------------------------
// 0. Admin session (RLS requires an authenticated admin)
// ------------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function connectAsAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error(
      'ERROR: admin credentials missing. Set SUPA_ADMIN_EMAIL/SUPA_ADMIN_PASSWORD' +
        ' (or IT_ADMIN_EMAIL/IT_PASSWORD) to import (RLS requires an admin session).'
    );
    process.exit(1);
  }
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (signInError || !data.session) {
    console.error('ERROR: admin sign-in failed:', signInError?.message ?? 'no session');
    process.exit(1);
  }
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    console.error(`ERROR: "${ADMIN_EMAIL}" is not an admin (role=${profile?.role ?? 'unknown'})`);
    process.exit(1);
  }
  log(`[auth] signed in as admin: ${ADMIN_EMAIL}`);
}

// ------------------------------------------------------------------
// 1. Pre-checks: table + bucket
// ------------------------------------------------------------------
async function preCheck() {
  // Note: avoid `head: true` here — it can mask a missing table (PGRST205).
  const { error: tableError } = await supabase
    .from('marketing_content')
    .select('*')
    .limit(1);

  let tableMissing = false;
  if (tableError) {
    const msg = tableError.message ?? '';
    tableMissing = /does not exist|PGRST205|relation/i.test(msg);
    console.error(
      tableMissing
        ? 'ERROR: table marketing_content does not exist yet. Apply migration' +
            ' supabase/migrations/20260810220000_marketing_content.sql first.'
        : `ERROR: cannot read marketing_content: ${msg}`
    );
    process.exit(1);
  }
  log('[precheck] table marketing_content OK');

  // Bucket metadata can be stale for SQL-created buckets (see the project's
  // restore_product_images_bucket migration). Warn instead of failing hard;
  // the upload itself is the functional check.
  const { error: bucketError } = await supabase.storage.getBucket(BUCKET);
  if (bucketError) {
    log(
      `[precheck] storage bucket "${BUCKET}" tidak terlihat via metadata API` +
        ` (${bucketError.message ?? bucketError}) — upload akan menjadi validasi fungsional.`
    );
  } else {
    log(`[precheck] storage bucket "${BUCKET}" OK`);
  }
}

// ------------------------------------------------------------------
// 2. Collect local assets
// ------------------------------------------------------------------
async function collectLocal() {
  const [slider, banner] = await Promise.all([
    readdir(SLIDER_DIR).catch((e) => {
      error(`cannot read slider dir: ${e.message}`);
      return [];
    }),
    readdir(BANNER_DIR).catch((e) => {
      error(`cannot read banner dir: ${e.message}`);
      return [];
    }),
  ]);

  stats.sliderFiles = slider.filter((f) => !f.startsWith('.')).length;
  stats.bannerFiles = banner.filter((f) => !f.startsWith('.')).length;
  return { slider: slider.filter((f) => !f.startsWith('.')), banner: banner.filter((f) => !f.startsWith('.')) };
}

// ------------------------------------------------------------------
// 3. Existing state (bucket objects + records) for dedup
// ------------------------------------------------------------------
async function existingState() {
  const existingObjects = new Set();
  for (const folder of ['hero', 'banner']) {
    const { data, error: listError } = await supabase.storage.from(BUCKET).list(folder);
    if (listError) {
      error(`list ${folder}/ failed: ${listError.message ?? listError}`);
      continue;
    }
    for (const obj of data ?? []) existingObjects.add(`${folder}/${obj.name}`);
  }

  const existingUrls = new Set();
  const existingPaths = new Set();
  const { data: rows, error: rowsError } = await supabase
    .from('marketing_content')
    .select('id, type, image_url');
  if (rowsError) {
    error(`read marketing_content rows failed: ${rowsError.message}`);
  } else {
    for (const row of rows ?? []) {
      existingUrls.add(row.image_url);
      const marker = `/object/public/${BUCKET}/`;
      const idx = (row.image_url ?? '').indexOf(marker);
      if (idx >= 0) existingPaths.add(row.image_url.slice(idx + marker.length));
    }
  }

  return { existingObjects, existingUrls, existingPaths };
}

// ------------------------------------------------------------------
// 4. Import one asset
// ------------------------------------------------------------------
async function importAsset({ type, filename, text, active, sortOrder, dir }) {
  const folder = type === 'hero' ? 'hero' : 'banner';
  const storagePath = storagePathFor(type, filename);
  const publicUrl = publicUrlFor(storagePath);
  const label = `${type}/${filename}`;

  const objectExists = state.existingObjects.has(storagePath);
  const recordExists =
    state.existingUrls.has(publicUrl) || state.existingPaths.has(storagePath);

  if (objectExists && recordExists) {
    stats.skippedExisting += 1;
    log(`  [skip] ${label} — sudah ada (file + record)`);
    return;
  }

  if (DRY_RUN) {
    log(`  [dry]  ${label} -> upload:${!objectExists} record:${!recordExists}`);
    stats.storagePaths.push(storagePath);
    return;
  }

  // upload file if missing
  if (!objectExists) {
    const filePath = path.join(dir, filename);
    let bytes;
    try {
      bytes = await readFile(filePath);
    } catch (e) {
      error(`read ${filePath} failed: ${e.message}`);
      return;
    }
    const { error: upError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: mimeFor(filename), upsert: false });
    if (upError) {
      const duplicate = /duplicate|already exists|The resource already exists/i.test(upError.message ?? '');
      if (duplicate) {
        log(`  [skip] ${label} — file sudah ada di storage`);
      } else {
        error(`upload ${storagePath} failed: ${upError.message ?? upError}`);
        return;
      }
    } else {
      log(`  [ok]   ${label} uploaded -> ${storagePath}`);
    }
  }

  // insert record if missing
  if (!recordExists) {
    const { error: insError } = await supabase.from('marketing_content').insert({
      type,
      image_url: publicUrl,
      badge: text?.badge ?? null,
      title: text?.title ?? null,
      subtitle: text?.subtitle ?? null,
      description: text?.description ?? null,
      cta_text: text?.ctaText ?? null,
      cta_url: text?.ctaUrl ?? null,
      is_active: active,
      sort_order: sortOrder,
    });
    if (insError) {
      error(`insert record ${label} failed: ${insError.message}`);
      return;
    }
    stats.createdRecords += 1;
    if (type === 'hero') stats.importedHero += 1;
    else stats.importedBanner += 1;
    log(`  [ok]   ${label} record created (sort_order=${sortOrder}, active=${active})`);
  }

  stats.storagePaths.push(storagePath);
}

// ------------------------------------------------------------------
// 5. main
// ------------------------------------------------------------------
async function main() {
  log('SENJA MART — IMPORT MARKETING ASSETS');
  log(`mode: ${DRY_RUN ? 'DRY-RUN (tidak menulis apa pun)' : 'IMPORT'}`);
  log(`host: ${new URL(SUPABASE_URL).host}`);

  await connectAsAdmin();
  await preCheck();

  const { slider, banner } = await collectLocal();
  log(`\n[scan] slider: ${stats.sliderFiles} file, banner: ${stats.bannerFiles} file`);

  state = await existingState();
  log(`[dedup] storage objects: ${state.existingObjects.size}, existing records: ${state.existingUrls.size}`);

  // fallback-mapped assets (authoritative copy + order)
  const assets = [];
  for (const s of fallbackHeroSlides) {
    assets.push({
      type: 'hero',
      filename: path.basename(s.imageUrl),
      text: s,
      active: true,
      sortOrder: s.sortOrder,
    });
  }
  for (const b of fallbackMarketingBanners) {
    assets.push({
      type: 'banner',
      filename: path.basename(b.imageUrl),
      text: b,
      active: true,
      sortOrder: b.sortOrder,
    });
  }
  assets.sort((a, b) => (a.type === b.type ? a.sortOrder - b.sortOrder : 0));

  log('\n[import] asset dengan data fallback:');
  for (const asset of assets) {
    const dir = asset.type === 'hero' ? SLIDER_DIR : BANNER_DIR;
    await importAsset({ ...asset, dir });
  }

  // files without fallback copy (optional, imported inactive)
  if (INCLUDE_UNMAPPED) {
    const mappedHero = new Set(assets.filter((a) => a.type === 'hero').map((a) => a.filename));
    const mappedBanner = new Set(assets.filter((a) => a.type === 'banner').map((a) => a.filename));
    let extra = 0;
    for (const filename of slider) {
      if (mappedHero.has(filename)) continue;
      extra += 1;
      await importAsset({
        type: 'hero',
        filename,
        text: null,
        active: false,
        sortOrder: 100 + extra,
        dir: SLIDER_DIR,
      });
    }
    for (const filename of banner) {
      if (mappedBanner.has(filename)) continue;
      extra += 1;
      await importAsset({
        type: 'banner',
        filename,
        text: null,
        active: false,
        sortOrder: 100 + extra,
        dir: BANNER_DIR,
      });
    }
  } else {
    const mappedHero = new Set(assets.filter((a) => a.type === 'hero').map((a) => a.filename));
    const mappedBanner = new Set(assets.filter((a) => a.type === 'banner').map((a) => a.filename));
    const skipped = [...slider.filter((f) => !mappedHero.has(f)), ...banner.filter((f) => !mappedBanner.has(f))];
    if (skipped.length > 0) {
      stats.skippedUnmapped = skipped.length;
      log('\n[skip] file tanpa data fallback (tidak dipakai homepage, dilewati agar UI tidak berubah):');
      for (const f of skipped) log(`  - ${f}`);
      log('  (gunakan --include-unmapped untuk ikut mengimpornya sebagai nonaktif)');
    }
  }

  // final record count
  const { count } = await supabase
    .from('marketing_content')
    .select('id', { count: 'exact', head: true });
  log(`\n[summary] total record marketing_content sekarang: ${count ?? '?'}`);

  console.log('\n================ SUMMARY ================');
  console.log(`Slider files ditemukan        : ${stats.sliderFiles}`);
  console.log(`Banner files ditemukan        : ${stats.bannerFiles}`);
  console.log(`Hero berhasil di-import       : ${stats.importedHero}`);
  console.log(`Banner berhasil di-import     : ${stats.importedBanner}`);
  console.log(`Record dibuat                 : ${stats.createdRecords}`);
  console.log(`File dilewati (sudah ada)     : ${stats.skippedExisting}`);
  console.log(`File dilewati (tanpa fallback): ${stats.skippedUnmapped}`);
  console.log(`Error                         : ${stats.errors}`);
  if (stats.storagePaths.length > 0) {
    console.log('\nStorage paths:');
    for (const p of stats.storagePaths) console.log(`  - ${BUCKET}/${p}`);
  }
  console.log('==========================================');
  if (stats.errors > 0) process.exitCode = 1;
}

let state = null;
main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
