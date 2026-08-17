#!/usr/bin/env node
/**
 * SENJA MART — RLS ORDERS & ORDER_ITEMS SECURITY TEST
 *
 * Verifies migration 20260816110000_secure_orders_order_items_rls.sql:
 *   * customers CANNOT direct-insert orders (fake paid / fake total)
 *   * customers CANNOT direct-insert order_items (fake unit price)
 *   * customers CANNOT create orders/items for another user
 *   * customers CAN still checkout through place_order RPC
 *   * customers can read their own orders; cannot read others'
 *   * admins can still read orders
 *   * checkout + payment stock lifecycle still works
 *
 * Run (after applying the migration): node --env-file=.env.local scripts/rls-order-security-test.mjs
 * Prints NO credentials. Creates test users + one test product, cleans up.
 */
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASS = process.env.IT_PASSWORD || '';

const results = [];
const record = (name, ok, ev = '') => {
  const st = ok ? 'PASS' : 'FAIL';
  results.push({ name, status: st, ev });
  console.log(`[${st}] ${name}${ev ? ' | ' + ev : ''}`);
};
const fail = (name, err) => {
  results.push({ name, status: 'FAIL', ev: String(err).slice(0, 300) });
  console.log(`[FAIL] ${name} | ${String(err).slice(0, 300)}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(U, SK, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function makeCustomer(tag) {
  const email = `rls-test-${tag}-${Date.now()}@senjamart.test`;
  const pass = process.env.E2E_CUST_PASSWORD;
  const anon = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error: signUpErr } = await anon.auth.signUp({ email, password: pass });
  if (signUpErr) throw new Error('signUp: ' + signUpErr.message);
  let sess = null;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await anon.auth.signInWithPassword({ email, password: pass });
    if (!error && data.session) { sess = data.session; break; }
    await sleep(1000);
  }
  if (!sess) throw new Error('customer sign-in gagal');
  const { data: profile } = await anon.from('profiles').select('id').eq('id', sess.user.id).maybeSingle();
  return { client: anon, id: sess.user.id, email };
}

async function adminSession() {
  const c = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (error || !data.session) throw new Error('admin sign-in gagal: ' + (error?.message ?? 'no session'));
  return c;
}

async function main() {
  console.log('--- RLS ORDERS SECURITY TEST ---');
  if (!U || !K || !SK) throw new Error('env Supabase belum lengkap');
  if (!ADMIN_EMAIL) throw new Error('IT_ADMIN_EMAIL wajib diisi (admin test account)');

  // Setup: satu produk test + dua customer (A dan B)
  const tag = Date.now().toString(36);
  const { data: product, error: prodErr } = await admin.from('products').insert({
    name: `RLS_TEST_${tag}`,
    slug: `rls-test-${tag}`,
    description: 'produk test RLS',
    price: 27000,
    stock: 50,
    low_stock_threshold: 5,
    is_active: true,
  }).select('id, price, stock').single();
  if (prodErr || !product) throw new Error('gagal membuat produk test: ' + (prodErr?.message ?? ''));
  const pid = product.id;

  const custA = await makeCustomer('a');
  const custB = await makeCustomer('b');
  const adminC = await adminSession();
  const a = custA.client;
  const b = custB.client;
  const createdOrderIds = [];

  try {
    // ============ TEST 1 — checkout normal lewat place_order ============
    const { data: oid, error: coErr } = await a.rpc('place_order', {
      p_items: [{ productId: pid, quantity: 1, price: 1 }], // client price=1, diabaikan server
      p_subtotal: 1,
      p_shipping_cost: 0,
      p_total: 1,
      p_shipping_address: { name: 'RLS Tester A', phone: '081234567890', address: 'Jl. Test 1', city: 'Jakarta', postalCode: '12345' },
    });
    if (coErr || !oid) {
      record('TEST 1 Customer normal checkout (place_order)', false, coErr?.message?.slice(0, 120) ?? 'no order id');
    } else {
      createdOrderIds.push(oid);
      const { data: ord } = await admin.from('orders').select('user_id, status, payment_status, subtotal, total, shipping_cost').eq('id', oid).single();
      const { data: items } = await admin.from('order_items').select('price, quantity, product_id').eq('order_id', oid);
      const ok =
        ord?.user_id === custA.id &&
        ord?.status === 'pending' &&
        ord?.payment_status === 'unpaid' &&
        ord?.subtotal === 27000 &&
        ord?.shipping_cost === 12000 &&
        ord?.total === 39000 &&
        items?.length === 1 &&
        items[0].price === 27000 &&
        items[0].quantity === 1 &&
        items[0].product_id === pid;
      record('TEST 1 Customer normal checkout (place_order)', ok,
        ok ? `order ${oid.slice(0, 8)} pending/unpaid, subtotal=27000, total=39000, item price=27000 (DB, bukan client)` : JSON.stringify({ ord, items }));
    }

    // ============ TEST 2 — direct insert order payment_status='paid' ============
    {
      const { data, error } = await a.from('orders').insert({
        user_id: custA.id,
        status: 'pending',
        payment_status: 'paid',
        subtotal: 1000,
        shipping_cost: 0,
        total: 1000,
        shipping_address: { name: 'RLS Tester A', address: 'Jl. Test', city: 'Jakarta', postalCode: '12345' },
      }).select('id').maybeSingle();
      record('TEST 2 Direct insert order paid diblokir', !!error && !data,
        error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
    }

    // ============ TEST 3 — direct insert order dengan total palsu ============
    {
      const { data, error } = await a.from('orders').insert({
        user_id: custA.id,
        status: 'pending',
        payment_status: 'unpaid',
        subtotal: 999999,
        shipping_cost: 0,
        total: 999999,
        shipping_address: { name: 'RLS Tester A', address: 'Jl. Test', city: 'Jakarta', postalCode: '12345' },
      }).select('id').maybeSingle();
      record('TEST 3 Direct insert order total palsu diblokir', !!error && !data,
        error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
    }

    // ============ TEST 3b — direct insert order dengan status palsu ============
    {
      const { data, error } = await a.from('orders').insert({
        user_id: custA.id,
        status: 'delivered',
        payment_status: 'unpaid',
        subtotal: 1000,
        shipping_cost: 0,
        total: 1000,
        shipping_address: { name: 'RLS Tester A', address: 'Jl. Test', city: 'Jakarta', postalCode: '12345' },
      }).select('id').maybeSingle();
      record('TEST 3b Direct insert order status palsu diblokir', !!error && !data,
        error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
    }

    // ============ TEST 4 — direct insert order_items harga palsu ============
    {
      // butuh order milik A sebagai target item
      const { data: ownOrder } = await a.from('orders').select('id').limit(1).maybeSingle();
      const targetOrder = ownOrder?.id ?? createdOrderIds[0];
      const { data, error } = await a.from('order_items').insert({
        order_id: targetOrder,
        product_id: pid,
        product_name: 'RLS Test',
        price: 1,
        quantity: 5,
      }).select('id').maybeSingle();
      record('TEST 4 Direct insert order_items harga palsu diblokir', !!error && !data,
        error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
    }

    // ============ TEST 5 — order untuk user lain ============
    {
      const { data, error } = await a.from('orders').insert({
        user_id: custB.id,
        status: 'pending',
        payment_status: 'unpaid',
        subtotal: 1000,
        shipping_cost: 0,
        total: 1000,
        shipping_address: { name: 'RLS Tester B', address: 'Jl. Test', city: 'Jakarta', postalCode: '12345' },
      }).select('id').maybeSingle();
      record('TEST 5 Order untuk user lain diblokir', !!error && !data,
        error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
    }

    // ============ TEST 6 — item ke order user lain ============
    {
      // buat order milik B dulu lewat place_order
      const { data: bOid, error: bErr } = await b.rpc('place_order', {
        p_items: [{ productId: pid, quantity: 1, price: 27000 }],
        p_subtotal: 27000,
        p_shipping_cost: 12000,
        p_total: 39000,
        p_shipping_address: { name: 'RLS Tester B', phone: '081234567890', address: 'Jl. Test 2', city: 'Jakarta', postalCode: '12345' },
      });
      if (bErr || !bOid) {
        record('TEST 6 Item ke order user lain diblokir', false, 'setup order B gagal: ' + (bErr?.message ?? ''));
      } else {
        createdOrderIds.push(bOid);
        const { data, error } = await a.from('order_items').insert({
          order_id: bOid,
          product_id: pid,
          product_name: 'RLS Test',
          price: 27000,
          quantity: 1,
        }).select('id').maybeSingle();
        record('TEST 6 Item ke order user lain diblokir', !!error && !data,
          error ? error.message.split('\n')[0].slice(0, 120) : 'INSERT SUKSES (BAD!)');
      }
    }

    // ============ TEST 7 — customer baca order sendiri ============
    {
      const own = createdOrderIds[0];
      const { data, error } = await a.from('orders').select('id').eq('id', own).maybeSingle();
      record('TEST 7 Customer baca order sendiri', !error && data?.id === own,
        error ? error.message.split('\n')[0].slice(0, 120) : `order ${own.slice(0, 8)} terlihat`);
    }

    // ============ TEST 8 — customer baca order user lain ============
    {
      const bOrder = createdOrderIds.find((id) => id !== createdOrderIds[0]);
      if (!bOrder) {
        record('TEST 8 Customer baca order user lain', false, 'tidak ada order B untuk dicek');
      } else {
        const { data, error } = await a.from('orders').select('id').eq('id', bOrder).maybeSingle();
        record('TEST 8 Customer baca order user lain', !error && !data,
          data ? 'order B terlihat oleh A (BAD!)' : 'order B tidak terlihat (RLS)');
      }
    }

    // ============ TEST 9 — admin baca orders ============
    {
      const { data, error } = await adminC.from('orders').select('id').limit(5);
      record('TEST 9 Admin baca orders', !error && Array.isArray(data),
        error ? error.message.split('\n')[0].slice(0, 120) : `${data?.length ?? 0} order terlihat`);
    }

    // ============ TEST 10 — checkout + payment tetap bekerja ============
    {
      const o = createdOrderIds[0];
      const before = (await admin.from('products').select('stock, reserved_stock').eq('id', pid).single()).data;
      const { error: fulfillErr } = await admin.rpc('fulfill_order_stock', { p_order_id: o });
      const after = (await admin.from('products').select('stock, reserved_stock').eq('id', pid).single()).data;
      const ord = (await admin.from('orders').select('payment_status, stock_fulfilled').eq('id', o).single()).data;
      const ok = !fulfillErr && after?.stock === before.stock - 1 && after?.reserved_stock === before.reserved_stock - 1 && ord?.stock_fulfilled === true;
      record('TEST 10 Checkout + payment stock lifecycle tetap jalan', ok,
        fulfillErr ? fulfillErr.message.slice(0, 120) : `stock ${before?.stock}->${after?.stock}, reserved ${before?.reserved_stock}->${after?.reserved_stock}, stock_fulfilled=${ord?.stock_fulfilled}`);
    }
  } catch (e) {
    fail('RLS ORDERS SECURITY TEST', e);
  } finally {
    // Cleanup: hapus order test (service role), produk test, stock movements
    const del = async (fn) => { try { await fn(); } catch {} };
    for (const oid of createdOrderIds.filter(Boolean)) {
      await del(() => admin.from('order_items').delete().eq('order_id', oid));
      await del(() => admin.from('midtrans_transactions').delete().eq('order_id', oid));
      await del(() => admin.from('orders').delete().eq('id', oid));
    }
    await del(() => admin.from('stock_movements').delete().eq('product_id', pid));
    await del(() => admin.from('product_images').delete().eq('product_id', pid));
    await del(() => admin.from('products').delete().eq('id', pid));
    console.log('(cleanup selesai)');
  }
}

main().catch((e) => {
  fail('DRIVER', e);
  process.exit(1);
}).finally(() => {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const failn = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n--- SUMMARY ---`);
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
  console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
  process.exit(failn ? 1 : 0);
});
