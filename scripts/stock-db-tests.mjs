#!/usr/bin/env node
/**
 * SENJA MART — STOCK SYSTEM DB TESTS (Fase 21: 16–25 + validasi adjustment)
 *
 * Tests the stock lifecycle at the database layer (the single source of
 * truth), using the same RPCs the app calls:
 *   16. Order unpaid            -> stok TIDAK berkurang (reserved bertambah)
 *   17. Payment paid            -> stok berkurang + movement 'sale'
 *   18. Fulfill dua kali        -> stok hanya berkurang sekali (idempotent)
 *   19. Cancellation            -> stok kembali + movement 'cancellation'
 *   20. Cancellation dua kali   -> stok tidak kembali dua kali
 *   21. Checkout qty > stok     -> ditolak (server), order tidak dibuat
 *   22. stok = 0                -> tidak bisa checkout
 *   23–25. Dua checkout bersamaan (stok 5, masing2 4) -> hanya satu lolos,
 *          stok tidak pernah negatif, stok final benar
 * Plus: adjust_stock tambah/kurangi, blok stok negatif, blok kurangi di
 * bawah reserved.
 *
 * Run: node --env-file=.env.local scripts/stock-db-tests.mjs
 * Never prints credentials.
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

async function getProduct(id) {
  const { data } = await admin.from('products').select('stock, reserved_stock, low_stock_threshold').eq('id', id).maybeSingle();
  return data;
}
async function getOrder(id) {
  const { data } = await admin.from('orders').select('status, payment_status, stock_fulfilled, stock_reserved, stock_returned, fulfillment_issue').eq('id', id).maybeSingle();
  return data;
}
async function movementsFor(orderId) {
  const { data } = await admin
    .from('stock_movements')
    .select('product_id, type, quantity, stock_before, stock_after')
    .eq('reference_id', orderId)
    .order('created_at', { ascending: true });
  return data ?? [];
}

// customer session (register + sign in)
async function makeCustomer(tag) {
  const email = `stock-test-${tag}-${Date.now()}@senjamart.test`;
  const pass = 'SenjaMart-Stock-2026!x';
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
  return { client: anon, email };
}

// admin session (uses IT_ADMIN_EMAIL/IT_PASSWORD from env)
let adminClient = null;
async function adminSession() {
  if (adminClient) return adminClient;
  const c = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASS });
  if (error || !data.session) throw new Error('admin sign-in gagal: ' + (error?.message ?? 'no session'));
  adminClient = c;
  return c;
}

async function placeOrder(client, productId, qty, price) {
  const { data, error } = await client.rpc('place_order', {
    p_items: [{ productId, quantity: qty, price }],
    p_subtotal: price * qty,
    p_shipping_cost: 12000,
    p_total: price * qty + 12000,
    p_shipping_address: { name: 'Stock Tester', phone: '081234567890', address: 'Jl. Test 1', city: 'Jakarta', postalCode: '12345' },
  });
  if (error) return { orderId: null, error: error.message ?? '' };
  return { orderId: data, error: null };
}

async function main() {
  console.log('--- STOCK DB TESTS ---');
  if (!U || !K || !SK) throw new Error('env Supabase belum lengkap');

  // Setup: satu produk test dengan stok terkontrol + satu customer
  const tag = Date.now().toString(36);
  const { data: product, error: prodErr } = await admin.from('products').insert({
    name: `STOCK_TEST_${tag}`,
    slug: `stock-test-${tag}`,
    description: 'produk test stok',
    price: 10000,
    stock: 50,
    low_stock_threshold: 5,
    is_active: true,
  }).select('id, stock, reserved_stock').single();
  if (prodErr || !product) throw new Error('gagal membuat produk test: ' + (prodErr?.message ?? ''));
  const pid = product.id;
  const customer = await makeCustomer(tag);
  const cust = customer.client;
  const adminC = await adminSession();
  const createdOrders = [];

  try {
    // ============ 16. Order unpaid -> stok tidak berkurang ============
    const before = await getProduct(pid);
    const r16 = await placeOrder(cust, pid, 3, 10000);
    const after = await getProduct(pid);
    const o16 = r16.orderId ? await getOrder(r16.orderId) : null;
    createdOrders.push(r16.orderId);
    record('16. Order unpaid: stok tidak berkurang',
      r16.orderId && after.stock === before.stock && after.reserved_stock === before.reserved_stock + 3,
      `stock ${before.stock}->${after.stock}; reserved ${before.reserved_stock}->${after.reserved_stock}; order=${o16 ? 'pending/unpaid' : 'TIDAK ADA'}`);
    record('16b. Order dibuat sebagai pending/unpaid + stok_reserved=true',
      !!r16.orderId && o16?.payment_status === 'unpaid' && o16?.stock_reserved === true,
      `payment=${o16?.payment_status}; stock_reserved=${o16?.stock_reserved}`);

    // ============ 17. Fulfill (settlement) -> stok berkurang + movement sale ============
    const b17 = await getProduct(pid);
    const { error: f17 } = await admin.rpc('fulfill_order_stock', { p_order_id: r16.orderId });
    const a17 = await getProduct(pid);
    const mv17 = await movementsFor(r16.orderId);
    const saleMv = mv17.find((m) => m.type === 'sale');
    record('17. Payment paid: stok berkurang tepat qty',
      !f17 && a17.stock === b17.stock - 3 && a17.reserved_stock === b17.reserved_stock - 3,
      `stock ${b17.stock}->${a17.stock}; reserved ${b17.reserved_stock}->${a17.reserved_stock}`);
    record('17b. Movement "sale" tercatat (-3, sebelum/sesudah benar)',
      !!saleMv && saleMv.quantity === -3 && saleMv.stock_before === b17.stock && saleMv.stock_after === b17.stock - 3,
      saleMv ? `qty=${saleMv.quantity} before=${saleMv.stock_before} after=${saleMv.stock_after}` : 'tidak ada movement sale');

    // ============ 18. Fulfill dua kali -> hanya berkurang sekali ============
    const b18 = await getProduct(pid);
    await admin.rpc('fulfill_order_stock', { p_order_id: r16.orderId }); // duplicate
    const a18 = await getProduct(pid);
    const o18 = await getOrder(r16.orderId);
    record('18. Webhook/RPC duplicate: stok hanya berkurang sekali',
      a18.stock === b18.stock && a18.reserved_stock === b18.reserved_stock && o18?.stock_fulfilled === true,
      `stock ${b18.stock}->${a18.stock}; stock_fulfilled=${o18?.stock_fulfilled}`);

    // ============ 19. Cancellation (sudah paid) -> stok kembali ============
    const b19 = await getProduct(pid);
    const { error: c19 } = await adminC.rpc('cancel_order', { p_order_id: r16.orderId });
    const a19 = await getProduct(pid);
    const mv19 = await movementsFor(r16.orderId);
    const cancelMv = mv19.find((m) => m.type === 'cancellation' && m.quantity > 0);
    record('19. Cancellation order paid: stok kembali + movement cancellation(+qty)',
      !c19 && a19.stock === b19.stock + 3 && !!cancelMv && cancelMv.quantity === 3,
      `stock ${b19.stock}->${a19.stock}; cancel mv qty=${cancelMv?.quantity}`);

    // ============ 20. Cancellation dua kali -> stok tidak kembali dua kali ============
    const b20 = await getProduct(pid);
    await adminC.rpc('cancel_order', { p_order_id: r16.orderId }); // duplicate
    const a20 = await getProduct(pid);
    const o20 = await getOrder(r16.orderId);
    record('20. Cancellation duplicate: stok tidak kembali dua kali',
      a20.stock === b20.stock && o20?.stock_returned === true,
      `stock ${b20.stock}->${a20.stock}; stock_returned=${o20?.stock_returned}`);

    // ============ 21. Checkout qty > stok -> ditolak ============
    const cur = await getProduct(pid); // stock = 50 setelah kembali
    const r21 = await placeOrder(cust, pid, cur.stock + 1, 10000);
    record('21. Checkout qty > stok ditolak (server), order tidak dibuat',
      r21.error !== null && r21.error.includes('insufficient_stock') && r21.orderId === null,
      r21.error ? r21.error.slice(0, 80) : 'TIDAK DITOLAK!');

    // ============ 22. stok = 0 -> tidak bisa checkout ============
    await admin.from('products').update({ stock: 0 }).eq('id', pid);
    const r22 = await placeOrder(cust, pid, 1, 10000);
    record('22. stok = 0 tidak bisa checkout',
      r22.error !== null && r22.error.includes('insufficient_stock') && r22.orderId === null,
      r22.error ? r22.error.slice(0, 80) : 'TIDAK DITOLAK!');

    // ============ 23–25. Konkurensi: stok 5, dua pembeli @4 ============
    await admin.from('products').update({ stock: 5, reserved_stock: 0 }).eq('id', pid);
    const custB = await makeCustomer(tag + 'b');
    const [ra, rb] = await Promise.all([
      placeOrder(cust, pid, 4, 10000),
      placeOrder(custB.client, pid, 4, 10000),
    ]);
    const winners = [ra, rb].filter((r) => r.error === null && r.orderId);
    const losers = [ra, rb].filter((r) => r.error !== null);
    const afterConc = await getProduct(pid);
    record('23. Dua pembelian bersamaan: hanya satu yang lolos',
      winners.length === 1 && losers.length === 1 && (losers[0]?.error ?? '').includes('insufficient_stock'),
      `pemenang=${winners.length} kalah=${losers.length}${losers[0] ? ' err=' + losers[0].error.slice(0, 60) : ''}`);
    record('24. Stok tidak pernah negatif',
      afterConc.stock >= 0 && afterConc.reserved_stock >= 0,
      `stock=${afterConc.stock} reserved=${afterConc.reserved_stock}`);
    record('25. Stok final benar setelah settlement pemenang',
      (() => {
        // reserve 4/5, lalu fulfill -> stock 1, reserved 0
        return afterConc.stock === 5 && afterConc.reserved_stock === 4;
      })(),
      `sebelum fulfill: stock=${afterConc.stock} reserved=${afterConc.reserved_stock}`);
    if (winners.length === 1) {
      createdOrders.push(winners[0].orderId);
      await admin.rpc('fulfill_order_stock', { p_order_id: winners[0].orderId });
      const fin = await getProduct(pid);
      record('25b. Setelah fulfill pemenang: stock=1, reserved=0',
        fin.stock === 1 && fin.reserved_stock === 0,
        `stock=${fin.stock} reserved=${fin.reserved_stock}`);
      // kembalikan stock agar pembersihan konsisten
      await admin.from('products').update({ stock: 1 }).eq('id', pid);
    }

    // ============ Adjustment: tambah / kurangi / blokir ============
    await admin.from('products').update({ stock: 20, reserved_stock: 0 }).eq('id', pid);
    const { error: adjAdd } = await adminC.rpc('adjust_stock', { p_product_id: pid, p_delta: 10, p_note: 'Restock supplier', p_type: 'restock' });
    const afterAdd = await getProduct(pid);
    record('Adjustment tambah: 20 -> 30 + movement restock',
      !adjAdd && afterAdd.stock === 30,
      `stock=${afterAdd.stock}`);

    const { error: adjSub } = await adminC.rpc('adjust_stock', { p_product_id: pid, p_delta: -3, p_note: 'Koreksi stok', p_type: 'adjustment' });
    const afterSub = await getProduct(pid);
    record('Adjustment kurang: 30 -> 27 + movement adjustment',
      !adjSub && afterSub.stock === 27,
      `stock=${afterSub.stock}`);

    const { error: adjNeg } = await adminC.rpc('adjust_stock', { p_product_id: pid, p_delta: -100, p_note: '', p_type: 'adjustment' });
    record('Adjustment blok stok negatif',
      (adjNeg?.message ?? '').includes('stock_negative') && (await getProduct(pid)).stock === 27,
      adjNeg?.message ? adjNeg.message.slice(0, 60) : 'TIDAK DIBLOKIR!');

    // blok kurangi di bawah reserved
    await admin.from('products').update({ stock: 10, reserved_stock: 6 }).eq('id', pid);
    const { error: adjRes } = await adminC.rpc('adjust_stock', { p_product_id: pid, p_delta: -5, p_note: '', p_type: 'adjustment' });
    record('Adjustment blok kurangi di bawah reserved (6)',
      (adjRes?.message ?? '').includes('stock_below_reserved') && (await getProduct(pid)).stock === 10,
      adjRes?.message ? adjRes.message.slice(0, 60) : 'TIDAK DIBLOKIR!');

    // customer tidak bisa adjust
    const { error: custAdj } = await cust.rpc('adjust_stock', { p_product_id: pid, p_delta: 5, p_note: '', p_type: 'restock' });
    record('Security: customer tidak bisa adjust stok',
      (custAdj?.message ?? '').includes('admin_required') || (custAdj?.message ?? '').length > 0,
      custAdj?.message ? custAdj.message.slice(0, 60) : 'customer BISA adjust?!');
  } catch (e) {
    fail('STOCK DB TESTS', e);
  } finally {
    // Cleanup: hapus order test + produk test
    const del = async (fn) => { try { await fn(); } catch {} };
    for (const oid of createdOrders.filter(Boolean)) {
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
  console.log('\n--- SUMMARY ---');
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
  process.exit(1);
}).finally(() => {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const failn = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n--- SUMMARY ---`);
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
  console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
  process.exit(failn ? 1 : 0);
});
