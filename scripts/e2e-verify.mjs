#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_EMAIL = process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASS = process.env.IT_PASSWORD;
const CUST_PASS = process.env.E2E_CUST_PASSWORD;

const base = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: s, error: le } = await base.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
if (le) { console.log('ADMIN LOGIN FAIL:', le.message); process.exit(1); }
const admin = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
await admin.auth.setSession({ access_token: s.session.access_token, refresh_token: s.session.refresh_token });
console.log('ADMIN LOGIN OK (no creds printed)');

// ---- find E2E customer + product ----
const { data: profs, error: profErr } = await admin.from('profiles').select('id, full_name, role, created_at').ilike('full_name', 'E2E Test Customer').order('created_at', { ascending: false }).limit(1);
if (profErr) console.log('profiles query err:', profErr.message.split('\n')[0]);
// profiles has no email; get user via auth? Use auth admin not available. Find by id then look up auth user email via customer login later.
const profile = (profs || [])[0];
if (!profile) { console.log('FAIL: E2E customer profile not found'); process.exit(1); }
const custId = profile.id;
console.log('E2E customer profile found (id truncated):', custId.slice(0, 8) + '...');

const { data: prod } = await admin.from('products').select('id, name, slug, price, stock, rating, review_count, is_active, featured').eq('slug', 'e2etestproduct').maybeSingle();
console.log('PRODUCT state:', JSON.stringify(prod));

const { data: revs } = await admin.from('reviews').select('id, user_id, product_id, rating, review').eq('user_id', custId);
console.log('REVIEWS (customer):', JSON.stringify(revs));

const { data: orders } = await admin.from('orders').select('id, order_number, user_id, subtotal, shipping_cost, total, status').eq('user_id', custId).order('created_at', { ascending: false });
console.log('ORDERS (customer):', JSON.stringify(orders));

if (orders?.length) {
  const { data: items } = await admin.from('order_items').select('order_id, product_id, product_name, price, quantity').eq('order_id', orders[0].id);
  console.log('ORDER_ITEMS (snapshot):', JSON.stringify(items));
}

const { data: cart } = await admin.from('cart_items').select('id, product_id, quantity').eq('user_id', custId);
console.log('CART_ITEMS after checkout (expect 0):', JSON.stringify(cart));

// ---- customer login + RLS checks ----
// find the customer's email: profiles don't store email; but we know full_name. Use auth list? Not available.
// The customer email was generated as e2e-<ts>-cust@senjamart.test; discover it via orders->profile join? Not stored.
// Instead: login with the known password for ANY account matching full_name — we need the email.
// The driver created it; fetch from auth via admin is not possible (no admin API without service role).
// Use the signIn trick: try nothing — instead verify customer-side via a NEW signup? Simpler: verify order visibility
// by creating a second throwaway customer via API and trying to read the E2E customer's order.
const { data: reg } = await base.auth.signUp({
  email: `e2e-sec-${Date.now()}@senjamart.test`,
  password: process.env.E2E_CUST_PASSWORD,
  options: { data: { full_name: 'E2E Security Probe' } },
});
if (reg.session) {
  const sec = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
  await sec.auth.setSession({ access_token: reg.session.access_token, refresh_token: reg.session.refresh_token });
  const otherOrder = orders?.[0];
  if (otherOrder) {
    const probe = await sec.from('orders').select('id').eq('id', otherOrder.id).maybeSingle();
    console.log('CROSS-CUSTOMER ORDER READ (expect empty):', JSON.stringify(probe.data), probe.error ? probe.error.message.split('\n')[0] : '');
  }
  // role escalation
  const esc = await sec.from('profiles').update({ role: 'admin' }).eq('id', reg.user.id);
  const role = await sec.from('profiles').select('role').eq('id', reg.user.id).maybeSingle();
  console.log('ROLE ESCALATION (expect blocked):', esc.error ? `blocked (${esc.error.code})` : 'NOT BLOCKED', '| role now:', role.data?.role);
}

// ---- inactive product invisible to public ----
if (prod) {
  await admin.from('products').update({ is_active: false }).eq('id', prod.id);
  const anon = createClient(U, K, { auth: { persistSession: false } });
  const { data: vis } = await anon.from('products').select('id').eq('id', prod.id).maybeSingle();
  console.log('INACTIVE PRODUCT visible to anon (expect empty):', JSON.stringify(vis));
  await admin.from('products').update({ is_active: true }).eq('id', prod.id);
  const { data: vis2 } = await anon.from('products').select('id').eq('id', prod.id).maybeSingle();
  console.log('REACTIVATED visible to anon (expect row):', JSON.stringify(vis2));
}
