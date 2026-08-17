#!/usr/bin/env node
/**
 * SENJA MART — CATEGORY RELATIONSHIP AUDIT (READ-ONLY)
 * ====================================================
 * Reports the real state of categories ↔ products in Supabase Cloud.
 * This script performs SELECT queries ONLY. It never INSERTs, UPDATEs,
 * DELETEs, or runs RPCs. Safe to run against production.
 *
 * Run:
 *   node --env-file=.env.local scripts/audit-categories.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ADMIN_EMAIL = process.env.SUPA_ADMIN_EMAIL || process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.SUPA_ADMIN_PASSWORD || process.env.IT_PASSWORD || '';

if (!SUPABASE_URL || !ANON_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

async function main() {
  console.log('SENJA MART — CATEGORY RELATIONSHIP AUDIT (READ-ONLY)');
  console.log(`host: ${new URL(SUPABASE_URL).host}`);

  // Admin session so RLS exposes inactive categories & products too.
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ERROR: admin credentials missing (SUPA_ADMIN_EMAIL/SUPA_ADMIN_PASSWORD or IT_ADMIN_EMAIL/IT_PASSWORD).');
    process.exit(1);
  }
  const { data: auth, error: se } = await supabase.auth.signInWithPassword({
    email: ADMIN_EMAIL, password: ADMIN_PASSWORD,
  });
  if (se || !auth.session) {
    console.error('ERROR: admin sign-in failed:', se?.message ?? 'no session');
    process.exit(1);
  }
  console.log('[auth] admin session OK\n');

  // ---- 1. all categories -------------------------------------------------
  const { data: cats, error: ce } = await supabase
    .from('categories')
    .select('id, name, slug, is_active, sort_order, created_at, updated_at')
    .order('sort_order').order('name');
  if (ce) { console.error('ERROR categories:', ce.message); process.exit(1); }

  // ---- 2. all products ---------------------------------------------------
  const { data: prods, error: pe } = await supabase
    .from('products')
    .select('id, name, slug, category_id, is_active');
  if (pe) { console.error('ERROR products:', pe.message); process.exit(1); }

  const catById = new Map((cats ?? []).map((c) => [c.id, c]));

  // ---- 3. aggregates -----------------------------------------------------
  const count = (pred) => (prods ?? []).filter(pred).length;
  const countFor = (catId, activeOnly) =>
    (prods ?? []).filter(
      (p) => p.category_id === catId && (!activeOnly || p.is_active === true)
    ).length;

  const orphaned = (prods ?? []).filter(
    (p) => p.category_id === null || !catById.has(p.category_id)
  );

  console.log('A. DATABASE RELATION CHECK');
  console.log('foreign key  : products.category_id -> public.categories(id)');
  console.log('ON DELETE    : SET NULL (from supabase/migrations/20260810092502_initial_senjamart.sql)');
  console.log('other refs   : none — categories is referenced only by products');
  console.log('is it safe to delete a category that still has products?');
  console.log('  -> DELETE would succeed but ALL its products get category_id = NULL');
  console.log('     (products become uncategorized / hidden from category pages).');
  console.log('  -> So: NOT safe to hard-delete a non-empty category without first');
  console.log('     reassigning or deactivating its products.');
  console.log('');

  console.log('B. CATEGORY INVENTORY');
  console.log('| Kategori                     | Slug                    | Produk (semua) | Produk (aktif) | Status | sort_order |');
  console.log('|------------------------------|-------------------------|----------------|----------------|--------|-----------|');
  for (const c of cats ?? []) {
    const all = countFor(c.id, false);
    const active = countFor(c.id, true);
    const name = (c.name ?? '').padEnd(28);
    const slug = (c.slug ?? '').padEnd(23);
    const st = c.is_active === false ? 'NONAKTIF' : 'aktif';
    console.log(`| ${name} | ${slug} | ${String(all).padEnd(14)} | ${String(active).padEnd(14)} | ${st.padEnd(7)} | ${String(c.sort_order ?? 0).padEnd(9)} |`);
  }
  console.log('');

  console.log('   Produk TANPA kategori (category_id NULL):', count((p) => p.category_id === null));
  console.log('   Produk dengan category_id TIDAK VALID   :', orphaned.filter((p) => p.category_id !== null && !catById.has(p.category_id)).length);
  console.log('   Total kategori                          :', cats?.length ?? 0);
  console.log('   Total produk                            :', prods?.length ?? 0);
  console.log('');

  console.log('C. PRODUCT → CATEGORY MAPPING');
  console.log('| Produk | Kategori | category_id |');
  for (const p of (prods ?? []).slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))) {
    const cat = p.category_id ? catById.get(p.category_id) : null;
    const catName = cat ? `${cat.name} (${cat.slug})` : (p.category_id ? `MISSING ID: ${p.category_id}` : '(tanpa kategori)');
    console.log(`| ${p.name} | ${catName} | ${p.category_id ?? 'NULL'} |`);
  }
  console.log('');

  console.log('D. ORPHANED / INVALID PRODUCT REFERENCES');
  if (orphaned.length === 0) {
    console.log('  (none — every product points to a valid category or is intentionally NULL)');
  } else {
    for (const p of orphaned) {
      console.log(`  - ${p.name} | category_id=${p.category_id ?? 'NULL'}`);
    }
  }
  console.log('');
  console.log('AUDIT COMPLETE — READ-ONLY, nothing was written.');
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
