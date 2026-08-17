#!/usr/bin/env node
/**
 * SENJA MART — INACTIVE-PRODUCT CHECKOUT EDGE CASE TEST (credential-safe)
 * Run: IT_ADMIN_EMAIL=... IT_PASSWORD=... node --env-file=.env.local scripts/supabase-inactive-checkout-test.mjs
 *
 * Verifies the place_order hardening (migration 20260810210000):
 *   1. customer has an ACTIVE product in cart
 *   2. admin deactivates the product
 *   3. customer checkout -> MUST FAIL with product_inactive_<id>
 *   4. no new order is created
 *   5. product stock is NOT decremented
 *   6. cart row is preserved (checkout did not "succeed" client-side)
 *   7. admin reactivates the product
 *   8. customer checkout -> MUST SUCCEED, order created, stock decremented
 *
 * Prints NO credentials. Uses anon/authenticated clients only
 * (no service role key).
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const results = [];
const record = (name, status, evidence = '') => {
  results.push({ name, status, evidence });
  console.log(`[${status}] ${name}${evidence ? ' | ' + evidence : ''}`);
};

const configured = Boolean(SUPA_URL && ANON);
console.log('SUPABASE CONFIGURED:', configured ? 'YES' : 'NO');
if (!configured) {
  console.log('ABORT: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(0);
}

const makeClient = () =>
  createClient(SUPA_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const anon = makeClient();
const PASSWORD = process.env.IT_PASSWORD || '';
const ts = Date.now();
const rand = Math.random().toString(36).slice(2, 8);

const adminEmail = process.env.IT_ADMIN_EMAIL || '';
const adminPw = PASSWORD;

if (!adminEmail) {
  console.log('ABORT: IT_ADMIN_EMAIL env required (existing test admin account).');
  process.exit(0);
}

// ---------- admin session ----------
const adminC = makeClient();
const { data: ad, error: adErr } = await adminC.auth.signInWithPassword({ email: adminEmail, password: adminPw });
if (adErr) {
  record('Admin login', 'FAIL', adErr.message.split('\n')[0]);
  console.log('ABORT: cannot continue without admin.');
  process.exit(0);
}
record('Admin login', 'PASS', 'existing test admin session (no credentials printed)');

// ---------- register a fresh customer ----------
const custEmail = `e2e-inactive-${ts}-${rand}@senjamart.test`;
const { data: su, error: suErr } = await anon.auth.signUp({
  email: custEmail,
  password: PASSWORD,
  options: { data: { full_name: `HD customer ${ts}` } },
});
if (suErr || !su.session) {
  record('Customer registration', 'FAIL', suErr?.message?.split('\n')[0] || 'no session');
  process.exit(0);
}
const custC = makeClient();
const { error: se } = await custC.auth.setSession({
  access_token: su.session.access_token,
  refresh_token: su.session.refresh_token,
});
if (se) {
  record('Customer registration', 'FAIL', se.message.split('\n')[0]);
  process.exit(0);
}
record('Customer registration', 'PASS', `${custEmail} (fresh customer, no credentials printed)`);

// ---------- fixtures: category + active product ----------
const catSlug = `e2e-test-inactive-cat-${ts}`;
const { data: cat, error: catErr } = await adminC
  .from('categories')
  .insert({ name: `E2E_TEST_INACTIVE_CATEGORY ${ts}`, slug: catSlug, is_active: true })
  .select('id')
  .single();
if (catErr) { record('Fixture category', 'FAIL', catErr.message.split('\n')[0]); process.exit(0); }

const prodSlug = `e2e-test-inactive-prod-${ts}`;
const STOCK = 10;
const PRICE = 25000;
const { data: prod, error: prodErr } = await adminC
  .from('products')
  .insert({ name: `E2E_TEST_INACTIVE_PRODUCT ${ts}`, slug: prodSlug, price: PRICE, stock: STOCK, unit: 'pcs', is_active: true, category_id: cat.id })
  .select('id, stock')
  .single();
if (prodErr) { record('Fixture product', 'FAIL', prodErr.message.split('\n')[0]); process.exit(0); }
record('Fixture product (active)', 'PASS', `stock=${prod.stock}, price=${PRICE}`);

// ---------- customer adds to cart ----------
const ci = await custC.from('cart_items').upsert(
  { user_id: su.user.id, product_id: prod.id, quantity: 2 },
  { onConflict: 'user_id,product_id' }
).select('quantity').single();
if (ci.error) {
  record('Add to cart', 'FAIL', ci.error.message.split('\n')[0]);
  process.exit(0);
}
record('Add to cart (active product)', 'PASS', `qty=${ci.data.quantity} in cart_items`);

// ---------- admin deactivates the product ----------
const ordersBefore = await custC.from('orders').select('id', { count: 'exact', head: true });
const { error: deactErr } = await adminC.from('products').update({ is_active: false }).eq('id', prod.id);
if (deactErr) { record('Admin deactivate product', 'FAIL', deactErr.message.split('\n')[0]); process.exit(0); }
record('Admin deactivate product', 'PASS', 'is_active -> false');

// ---------- customer checkout MUST FAIL ----------
const checkout = async (client) => {
  const { data, error } = await client.rpc('place_order', {
    p_items: [{ productId: prod.id, quantity: 2, price: 1 }],
    p_subtotal: 0,
    p_shipping_cost: 0,
    p_total: 0,
    p_shipping_address: { name: 'HD Test', address: 'Jl. Test 2', city: 'Bandung', postal_code: '40111', phone: '081234567890' },
  });
  return { data, error };
};

const failRes = await checkout(custC);
const rejected = failRes.error && /product_inactive/.test(failRes.error.message);
record('Checkout inactive product rejected', rejected ? 'PASS' : 'FAIL',
  rejected ? `error=${failRes.error.message.split('\n')[0]}` : `expected product_inactive, got error=${failRes.error?.message?.split('\n')[0] || 'NONE (order created!)'}`);

// ---------- no new order, stock unchanged, cart preserved ----------
const ordersAfter = await custC.from('orders').select('id', { count: 'exact', head: true });
const prodAfter = await adminC.from('products').select('stock, is_active').eq('id', prod.id).single();
const cartAfter = await custC.from('cart_items').select('quantity').eq('user_id', su.user.id).eq('product_id', prod.id).maybeSingle();

const noNewOrder = (ordersAfter.count ?? 0) === (ordersBefore.count ?? 0);
const stockUnchanged = prodAfter.data?.stock === STOCK && prodAfter.data?.is_active === false;
const cartPreserved = cartAfter.data?.quantity === 2;

record('No order created (rollback)', noNewOrder ? 'PASS' : 'FAIL', `orders before=${ordersBefore.count} after=${ordersAfter.count}`);
record('Stock not decremented', stockUnchanged ? 'PASS' : 'FAIL', `stock=${prodAfter.data?.stock} (expected ${STOCK})`);
record('Cart preserved after failed checkout', cartPreserved ? 'PASS' : 'FAIL', `cart qty=${cartAfter.data?.quantity} (expected 2)`);

// ---------- admin reactivates ----------
const { error: reactErr } = await adminC.from('products').update({ is_active: true }).eq('id', prod.id);
if (reactErr) { record('Admin reactivate product', 'FAIL', reactErr.message.split('\n')[0]); process.exit(0); }
record('Admin reactivate product', 'PASS', 'is_active -> true');

// ---------- customer checkout MUST SUCCEED ----------
const okRes = await checkout(custC);
if (okRes.error) {
  record('Checkout after reactivation', 'FAIL', okRes.error.message.split('\n')[0]);
} else {
  const { data: ord } = await custC.from('orders').select('subtotal, shipping_cost, total').eq('id', okRes.data).single();
  const { data: item } = await custC.from('order_items').select('price, quantity').eq('order_id', okRes.data).single();
  const { data: prodFinal } = await adminC.from('products').select('stock').eq('id', prod.id).single();
  const totalsOk = ord.subtotal === PRICE * 2 && ord.shipping_cost === 12000 && ord.total === PRICE * 2 + 12000;
  const snapshotOk = item.price === PRICE && item.quantity === 2;
  const stockOk = prodFinal.stock === STOCK - 2;
  record('Checkout after reactivation', totalsOk && snapshotOk && stockOk ? 'PASS' : 'FAIL',
    `order subtotal=${ord.subtotal} shipping=${ord.shipping_cost} total=${ord.total}; item price=${item.price} x${item.quantity}; stock ${STOCK}->${prodFinal.stock}`);
}

// ---------- cleanup ----------
await custC.from('cart_items').delete().eq('user_id', su.user.id).eq('product_id', prod.id);
const delProd = await adminC.from('products').delete().eq('id', prod.id);
const delCat = await adminC.from('categories').delete().eq('id', cat.id);
console.log('---\n[INFO] Cleanup: cart row removed;', delProd.error ? `product delete: ${delProd.error.message.split('\n')[0]}` : 'product deleted;', delCat.error ? `category delete: ${delCat.error.message.split('\n')[0]}` : 'category deleted.');
console.log('[INFO] Test order & auth user intentionally left (no delete policy via anon/authenticated; see report).');

console.log('---\nSUMMARY');
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.name}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${fail}`);
