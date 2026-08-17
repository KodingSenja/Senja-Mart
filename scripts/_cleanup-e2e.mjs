#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.IT_ADMIN_EMAIL || '';
const PW = process.env.IT_PASSWORD || 'SenjaMart-IT-2026!x';

const base = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: s, error: le } = await base.auth.signInWithPassword({ email: EMAIL, password: PW });
if (le) { console.log('LOGIN FAIL:', le.message); process.exit(1); }
const c = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
await c.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });

// 1. products
const { data: prods } = await c.from('products').select('id, name, image_url').ilike('name', 'E2E_TEST%');
for (const p of prods || []) {
  // remove storage objects referenced by this product
  if (p.image_url) {
    const prefix = '/storage/v1/object/public/product-images/';
    const idx = p.image_url.indexOf(prefix);
    if (idx >= 0) {
      const path = p.image_url.slice(idx + prefix.length);
      await c.storage.from('product-images').remove([path]);
      console.log('removed storage obj:', path);
    }
  }
  const { error } = await c.from('products').delete().eq('id', p.id);
  console.log(`deleted product ${p.name}:`, error ? error.message.split('\n')[0] : 'OK');
}

// 2. categories
const { data: cats } = await c.from('categories').select('id, name').ilike('name', 'E2E_TEST%');
for (const k of cats || []) {
  const { error } = await c.from('categories').delete().eq('id', k.id);
  console.log(`deleted category ${k.name}:`, error ? error.message.split('\n')[0] : 'OK');
}

// 3. verify
const pc = await c.from('products').select('id', { count: 'exact', head: true });
const cc = await c.from('categories').select('id', { count: 'exact', head: true });
console.log('FINAL: products =', pc.count, 'categories =', cc.count);
