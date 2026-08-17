#!/usr/bin/env node
/**
 * SENJA MART — SEED CATALOG (categories + products) INTO SUPABASE
 * ==================================================================
 * Converts the former local seed catalog into REAL Supabase data:
 *   - uploads category + product images to the existing `product-images`
 *     bucket (preserving original filenames for dedup)
 *   - creates categories (sort_order) and products (is_popular) rows
 * Source: the catalog previously shipped in src/lib/data (FreshCart
 * template assets). Production now reads ONLY from Supabase.
 *
 * Idempotent & safe to re-run:
 *   - never duplicates an uploaded object (checks bucket first)
 *   - never duplicates a category/product (checks slug first)
 *   - never deletes existing rows / objects
 *
 * Run:
 *   node --env-file=.env.local scripts/seed-catalog.mjs
 * Options:
 *   --dry-run   report only, write nothing
 */
import { createClient } from '@supabase/supabase-js';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ADMIN_EMAIL = process.env.SUPA_ADMIN_EMAIL || process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.SUPA_ADMIN_PASSWORD || process.env.IT_PASSWORD || '';

const DRY_RUN = process.argv.includes('--dry-run');
const BUCKET = 'product-images';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(1);
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const mimeFor = (name) => MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';

const log = (m) => console.log(m);
let errors = 0;
const err = (m) => { errors += 1; console.error('  [ERROR]', m); };

// ------------------------------------------------------------------
// Catalog source data (formerly src/lib/data)
// ------------------------------------------------------------------
const CATEGORIES = [
  { slug: 'susu-roti-telur', name: 'Susu, Roti & Telur', description: 'Susu segar, roti rumahan, dan telur pilihan setiap hari.', image: 'category-dairy-bread-eggs.jpg' },
  { slug: 'snack-makanan-ringan', name: 'Snack & Makanan Ringan', description: 'Keripik, kacang, dan camilan untuk menemani harimu.', image: 'category-snack-munchies.jpg' },
  { slug: 'bakery-biskuit', name: 'Bakery & Biskuit', description: 'Roti, biskuit, dan kue kering berkualitas.', image: 'category-bakery-biscuits.jpg' },
  { slug: 'makanan-instan', name: 'Makanan Instan', description: 'Siap saji untuk kebutuhan serba cepat.', image: 'category-instant-food.jpg' },
  { slug: 'teh-kopi-minuman', name: 'Teh, Kopi & Minuman', description: 'Teh, kopi, dan minuman favorit keluarga.', image: 'category-tea-coffee-drinks.jpg' },
  { slug: 'beras-sembako', name: 'Beras & Sembako', description: 'Beras premium dan kebutuhan dapur harian.', image: 'category-atta-rice-dal.jpg' },
  { slug: 'buah-sayur', name: 'Buah & Sayur', description: 'Buah dan sayur segar langsung dari petani.', image: 'category-fruits-vegetables.jpg' },
  { slug: 'ayam-daging-ikan', name: 'Ayam, Daging & Ikan', description: 'Protein segar untuk masakan istimewa.', image: 'category-chicken-meat-fish.jpg' },
  { slug: 'minuman-dingin-jus', name: 'Minuman Dingin & Jus', description: 'Jus dan minuman dingin menyegarkan.', image: 'category-cold-drinks-juices.jpg' },
  { slug: 'perawatan-bayi', name: 'Perawatan Bayi', description: 'Kebutuhan lengkap untuk si kecil.', image: 'category-baby-care.jpg' },
  { slug: 'kebersihan-rumah', name: 'Kebersihan Rumah', description: 'Perlengkapan bersih-bersih rumah.', image: 'category-cleaning-essentials.jpg' },
  { slug: 'perawatan-hewan', name: 'Perawatan Hewan', description: 'Makanan dan kebutuhan hewan kesayangan.', image: 'category-pet-care.jpg' },
];

const POPULAR_SLUGS = new Set([
  'kopi-bubuk-arabika-250g',
  'mie-instan-goreng-5-pcs',
  'beras-premium-pandan-wangi-5kg',
  'telur-ayam-negeri-1kg',
  'buah-apel-fuji-1kg',
]);

const PRODUCTS = [
  { name: 'Sev Bhujia Haldiram 200g', slug: 'sev-bhujia-haldiram-200g', category: 'snack-makanan-ringan', price: 18000, compare: 24000, stock: 48, unit: '200 g', featured: true, badge: 'sale', image: 'product-img-1.jpg', description: 'Camilan renyah khas India dengan paduan rempah pilihan. Cocok untuk teman santai dan keluarga.' },
  { name: 'Biskuit Digestive NutriChoice 250g', slug: 'biskuit-digestive-nutrichoice-250g', category: 'bakery-biskuit', price: 24000, compare: null, stock: 62, unit: '250 g', featured: true, badge: null, image: 'product-img-2.jpg', description: 'Biskuit gandum utuh dengan serat tinggi, baik untuk pencernaan. Cocok untuk sarapan atau camilan sehat.' },
  { name: 'Cokelat Cadbury 5 Star 1kg', slug: 'cokelat-cadbury-5-star-1kg', category: 'bakery-biskuit', price: 32000, compare: 35000, stock: 35, unit: '1 kg', featured: true, badge: 'sale', image: 'product-img-3.jpg', description: 'Cokelat susu dengan isian wafer dan karamel yang lumer di mulut. Kemasan ekonomis untuk keluarga.' },
  { name: 'Keripik Kentang Rasa Bawang 250g', slug: 'keripik-kentang-rasa-bawang-250g', category: 'snack-makanan-ringan', price: 15000, compare: 20000, stock: 120, unit: '250 g', featured: true, badge: 'hot', image: 'product-img-4.jpg', description: 'Keripik kentang renyah dengan bumbu bawang yang gurih. Snack favorit semua kalangan.' },
  { name: 'Popcorn Instan Rasa Garam 100g', slug: 'popcorn-instan-rasa-garam-100g', category: 'makanan-instan', price: 15000, compare: 25000, stock: 90, unit: '100 g', featured: true, badge: 'sale', image: 'product-img-5.jpg', description: 'Popcorn instan siap saji dengan rasa gurih. Praktis untuk menemani nonton film.' },
  { name: 'Susu UHT Full Cream 1L', slug: 'susu-uht-full-cream-1l', category: 'susu-roti-telur', price: 22000, compare: null, stock: 75, unit: '1 L', featured: true, badge: null, image: 'product-img-6.jpg', description: 'Susu UHT full cream dengan kandungan gizi lengkap untuk seluruh keluarga.' },
  { name: 'Kopi Bubuk Arabika 250g', slug: 'kopi-bubuk-arabika-250g', category: 'teh-kopi-minuman', price: 45000, compare: 50000, stock: 40, unit: '250 g', featured: true, badge: 'sale', image: 'product-img-7.jpg', description: 'Kopi bubuk arabika dengan aroma khas dan cita rasa premium. Untuk pecinta kopi sejati.' },
  { name: 'Teh Celup Melati 25 Kantong', slug: 'teh-celup-melati-25-kantong', category: 'teh-kopi-minuman', price: 12000, compare: null, stock: 150, unit: '25 kantong', featured: false, badge: null, image: 'product-img-8.jpg', description: 'Teh celup melati harum dengan rasa segar, dalam kemasan 25 kantong.' },
  { name: 'Beras Premium Pandan Wangi 5kg', slug: 'beras-premium-pandan-wangi-5kg', category: 'beras-sembako', price: 85000, compare: null, stock: 30, unit: '5 kg', featured: true, badge: null, image: 'product-img-9.jpg', description: 'Beras premium pandan wangi pulen dan harum, kemasan 5kg untuk kebutuhan bulanan.' },
  { name: 'Minyak Goreng Sawit 2L', slug: 'minyak-goreng-sawit-2l', category: 'beras-sembako', price: 36000, compare: null, stock: 55, unit: '2 L', featured: false, badge: null, image: 'product-img-10.jpg', description: 'Minyak goreng sawit jernih dan higienis, kemasan 2 liter untuk kebutuhan dapur.' },
  { name: 'Telur Ayam Negeri 1kg', slug: 'telur-ayam-negeri-1kg', category: 'susu-roti-telur', price: 28000, compare: null, stock: 80, unit: '1 kg', featured: true, badge: null, image: 'product-img-11.jpg', description: 'Telur ayam negeri segar, kaya protein. Pilihan tepat untuk kebutuhan harian keluarga.' },
  { name: 'Roti Tawar Gandum 400g', slug: 'roti-tawar-gandum-400g', category: 'bakery-biskuit', price: 18000, compare: 20000, stock: 110, unit: '400 g', featured: false, badge: 'sale', image: 'product-img-12.jpg', description: 'Roti tawar gandum lembut dan sehat, cocok untuk sarapan keluarga.' },
  { name: 'Mie Instan Goreng 5 Pcs', slug: 'mie-instan-goreng-5-pcs', category: 'makanan-instan', price: 17500, compare: null, stock: 200, unit: '5 pcs', featured: true, badge: null, image: 'product-img-13.jpg', description: 'Mie instan goreng dengan bumbu lezat, kemasan isi 5 untuk stok dapur.' },
  { name: 'Buah Apel Fuji 1kg', slug: 'buah-apel-fuji-1kg', category: 'buah-sayur', price: 42000, compare: null, stock: 45, unit: '1 kg', featured: true, badge: null, image: 'product-img-14.jpg', description: 'Apel fuji segar, manis, dan renyah. Kaya vitamin untuk kesehatan keluarga.' },
  { name: 'Daging Ayam Segar 500g', slug: 'daging-ayam-segar-500g', category: 'ayam-daging-ikan', price: 30000, compare: null, stock: 38, unit: '500 g', featured: false, badge: null, image: 'product-img-15.jpg', description: 'Daging ayam segar dan higienis, cocok untuk berbagai olahan masakan.' },
  { name: 'Ikan Salmon Fillet 250g', slug: 'ikan-salmon-fillet-250g', category: 'ayam-daging-ikan', price: 95000, compare: 110000, stock: 20, unit: '250 g', featured: true, badge: 'sale', image: 'product-img-16.jpg', description: 'Fillet ikan salmon segar, kaya omega-3. Pilihan premium untuk menu sehat.' },
  { name: 'Jus Jeruk Segar 1L', slug: 'jus-jeruk-segar-1l', category: 'minuman-dingin-jus', price: 28000, compare: null, stock: 60, unit: '1 L', featured: false, badge: null, image: 'product-img-17.jpg', description: 'Jus jeruk segar tanpa pengawet, kaya vitamin C untuk tubuh yang bugar.' },
  { name: 'Sabun Cuci Piring 800ml', slug: 'sabun-cuci-piring-800ml', category: 'kebersihan-rumah', price: 16000, compare: null, stock: 130, unit: '800 ml', featured: false, badge: null, image: 'product-img-18.jpg', description: 'Sabun cuci piring dengan wangi segar, ampuh mengangkat lemak.' },
  { name: 'Makanan Kucing Premium 1kg', slug: 'makanan-kucing-premium-1kg', category: 'perawatan-hewan', price: 68000, compare: 75000, stock: 42, unit: '1 kg', featured: false, badge: 'sale', image: 'product-img-19.jpg', description: 'Makanan kucing premium dengan nutrisi lengkap untuk kesehatan bulu dan tulang.' },
];

// ------------------------------------------------------------------
// 0. Admin session (RLS requires an authenticated admin)
// ------------------------------------------------------------------
const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function connectAsAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ERROR: admin credentials missing (SUPA_ADMIN_EMAIL/SUPA_ADMIN_PASSWORD or IT_ADMIN_EMAIL/IT_PASSWORD).');
    process.exit(1);
  }
  const { data, error: se } = await supabase.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  if (se || !data.session) { console.error('ERROR: admin sign-in failed:', se?.message ?? 'no session'); process.exit(1); }
  const { data: prof } = await supabase.from('profiles').select('role').eq('id', data.user.id).maybeSingle();
  if (prof?.role !== 'admin') { console.error('ERROR: not an admin account.'); process.exit(1); }
  log(`[auth] signed in as admin: ${ADMIN_EMAIL}`);
}

// ------------------------------------------------------------------
// 1. Upload helper (idempotent)
// ------------------------------------------------------------------
async function uploadIfMissing(folder, filename, localDir) {
  const storagePath = `${folder}/${filename}`;
  const { data: objs, error: le } = await supabase.storage.from(BUCKET).list(folder);
  if (!le && (objs ?? []).some((o) => o.name === filename)) {
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`; // already exists
  }
  if (DRY_RUN) return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  let bytes;
  try { bytes = await readFile(path.join(localDir, filename)); }
  catch (e) { err(`read ${filename} failed: ${e.message}`); return null; }
  const { error: ue } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, { contentType: mimeFor(filename), upsert: false });
  if (ue) { err(`upload ${storagePath} failed: ${ue.message ?? ue}`); return null; }
  log(`  [ok] upload ${storagePath}`);
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

// ------------------------------------------------------------------
// 2. main
// ------------------------------------------------------------------
async function main() {
  log('SENJA MART — SEED CATALOG');
  log(`mode: ${DRY_RUN ? 'DRY-RUN' : 'SEED'} | host: ${new URL(SUPABASE_URL).host}`);

  await connectAsAdmin();

  const catDir = path.join(ROOT, 'public/senjamart/category');
  const prodDir = path.join(ROOT, 'public/senjamart/products');

  // existing slugs
  const { data: existingCats } = await supabase.from('categories').select('slug');
  const existingCatSlugs = new Set((existingCats ?? []).map((c) => c.slug));
  const { data: existingProds } = await supabase.from('products').select('slug');
  const existingProdSlugs = new Set((existingProds ?? []).map((p) => p.slug));

  // categories
  let createdCats = 0, skippedCats = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const c = CATEGORIES[i];
    if (existingCatSlugs.has(c.slug)) { skippedCats += 1; continue; }
    const imageUrl = await uploadIfMissing('categories', c.image, catDir);
    if (!imageUrl) continue;
    if (DRY_RUN) { log(`  [dry] category ${c.slug}`); createdCats += 1; continue; }
    const { error: ce } = await supabase.from('categories').insert({
      name: c.name, slug: c.slug, description: c.description, image_url: imageUrl,
      is_active: true, sort_order: i + 1,
    });
    if (ce) { err(`insert category ${c.slug}: ${ce.message}`); continue; }
    createdCats += 1;
    log(`  [ok] category ${c.slug} (sort=${i + 1})`);
  }

  // products (map category slug -> id)
  const { data: cats } = await supabase.from('categories').select('id, slug');
  const slugToId = Object.fromEntries((cats ?? []).map((c) => [c.slug, c.id]));

  let createdProds = 0, skippedProds = 0;
  for (const p of PRODUCTS) {
    if (existingProdSlugs.has(p.slug)) { skippedProds += 1; continue; }
    const imageUrl = await uploadIfMissing('products', p.image, prodDir);
    if (!imageUrl) continue;
    if (DRY_RUN) { log(`  [dry] product ${p.slug}`); createdProds += 1; continue; }
    const { error: pe } = await supabase.from('products').insert({
      name: p.name, slug: p.slug, description: p.description,
      price: p.price, compare_price: p.compare, stock: p.stock, unit: p.unit,
      category_id: slugToId[p.category] ?? null, image_url: imageUrl,
      featured: p.featured, badge: p.badge, is_active: true,
      is_popular: POPULAR_SLUGS.has(p.slug),
    });
    if (pe) { err(`insert product ${p.slug}: ${pe.message}`); continue; }
    createdProds += 1;
    log(`  [ok] product ${p.slug}${POPULAR_SLUGS.has(p.slug) ? ' (popular)' : ''}`);
  }

  // summary
  const { count: catCount } = await supabase.from('categories').select('id', { count: 'exact', head: true });
  const { count: prodCount } = await supabase.from('products').select('id', { count: 'exact', head: true });
  const { count: popCount } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_popular', true);

  console.log('\n================ SUMMARY ================');
  console.log(`Kategori dibuat   : ${createdCats} (dilewati karena ada: ${skippedCats})`);
  console.log(`Produk dibuat     : ${createdProds} (dilewati karena ada: ${skippedProds})`);
  console.log(`Total kategori DB : ${catCount ?? '?'}`);
  console.log(`Total produk DB   : ${prodCount ?? '?'}`);
  console.log(`Produk populer DB : ${popCount ?? '?'}`);
  console.log(`Error             : ${errors}`);
  console.log('==========================================');
  if (errors > 0) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
