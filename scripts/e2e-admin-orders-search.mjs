#!/usr/bin/env node
/**
 * SENJA MART — ADMIN ORDERS SEARCH + FILTER E2E (credential-safe)
 * Run (dev server on :3000): node --env-file=.env.local scripts/e2e-admin-orders-search.mjs
 * Verifies:
 *   1. Search input + both filter selects are present, no "+ Tambah Pesanan" button
 *   2. All real orders load from Supabase orders table
 *   3. Search by customer name
 *   4. Search by Order ID / order number
 *   5. No-match query shows "Tidak ditemukan pesanan yang cocok"
 *   6. Filter Status Pesanan (Menunggu)
 *   7. Filter Pembayaran (Lunas) + payment badge visible
 *   8. Search + Filter combined
 *   9. Order detail expands (items visible)
 *  10. New order (as if from website checkout) appears in the dashboard
 *  11. Admin can update order_status (order test row, cleaned up after)
 * Prints NO credentials.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:3000';
const PORT = 9234;
const PROFILE = '/tmp/chrome-order-search';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const record = (name, status, evidence = '') => {
  const st = status === true || status === 'PASS' ? 'PASS' : status === false || status === 'FAIL' ? 'FAIL' : String(status);
  results.push({ name, status: st, evidence });
  console.log(`[${st}] ${name}${evidence ? ' | ' + evidence : ''}`);
};
const fail = (name, err) => record(name, 'FAIL', String(err).slice(0, 260));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map(); this.handlers = new Map();
    this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej); });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
      else if (msg.method) { (this.handlers.get(msg.method) || []).forEach((h) => h(msg.params)); }
    });
  }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej })); }
  on(method, h) { const hs = this.handlers.get(method) || []; hs.push(h); this.handlers.set(method, hs); }
}
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) { const cdp = new CDP(page.webSocketDebuggerUrl); await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); return cdp; }
    } catch {}
    await sleep(500);
  }
  throw new Error('no cdp');
}
const ev = async (cdp, e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result?.value; };
const txt = async (cdp) => (await ev(cdp, 'document.body ? document.body.innerText : ""')) || '';
const wait = async (cdp, expr, t = 30000) => { const s = Date.now(); while (Date.now() - s < t) { try { if (await ev(cdp, `!!(${expr})`)) return true; } catch {} await sleep(600); } throw new Error('timeout: ' + expr); };
const type = async (cdp, sel, val) => { await ev(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(350); };
const setSelect = async (cdp, sel, val) => { const ok = await ev(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); if (!ok) throw new Error('no select: ' + sel); await sleep(600); };
const clickText = async (cdp, text, tag = 'button,a') => { const ok = await ev(cdp, `(() => { const el=[...document.querySelectorAll('${tag}')].find(e=>(e.textContent||'').trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true; })()`); if (!ok) throw new Error('no click target: ' + text); await sleep(900); };
const submit = async (cdp, label) => { const ok = await ev(cdp, `(() => { const b=[...document.querySelectorAll('button[type=submit]')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`); if (!ok) throw new Error('no submit: ' + label); await sleep(1000); };
const shot = async (cdp, n) => { try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/order-search-' + n + '.png', Buffer.from(data, 'base64')); } catch {} };
const cardCount = (cdp) => ev(cdp, `document.querySelectorAll('div.rounded-xl.border').length`);
const cardTexts = (cdp) => ev(cdp, `[...document.querySelectorAll('div.rounded-xl.border')].map(c => c.innerText)`);

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const ts = Date.now();
const TEST_NUM = 'SJ-E2E-' + ts.toString(36).toUpperCase();
const TEST_NAME = 'E2E Order Test ' + ts;
const chrome = spawn('google-chrome', [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let cdp;
try {
  cdp = await connect();
  // ---- admin login ----
  await cdp.send('Page.navigate', { url: `${BASE}/senjamart/login?redirect=/admin/senjamart` }); await sleep(2500);
  await wait(cdp, `document.querySelector('#loginEmail')`, 60000, 'login form');
  await type(cdp, '#loginEmail', process.env.IT_ADMIN_EMAIL || '');
  await type(cdp, '#loginPassword', process.env.IT_PASSWORD || 'SenjaMart-IT-2026!x');
  await submit(cdp, 'Masuk');
  await wait(cdp, `location.pathname.includes('/admin/senjamart')`, 45000, 'admin redirect');

  await cdp.send('Page.navigate', { url: `${BASE}/admin/senjamart/orders` }); await sleep(2500);
  await wait(cdp, `document.querySelector('#adminOrderSearch')`, 45000, 'search input');
  const hasSearch = await ev(cdp, `document.querySelector('#adminOrderSearch').placeholder`);
  record('Search input present', hasSearch === 'Cari Order ID / Customer...', `placeholder="${hasSearch}"`);
  const hasStatusFilter = await ev(cdp, `document.querySelector('#adminOrderStatusFilter') !== null`);
  const hasPayFilter = await ev(cdp, `document.querySelector('#adminOrderPaymentFilter') !== null`);
  record('Status + Payment filters present', hasStatusFilter && hasPayFilter, 'two selects rendered');
  const noAddBtn = !(await txt(cdp)).includes('Tambah Pesanan');
  record('No "+ Tambah Pesanan" button', noAddBtn, 'admin cannot create orders');

  // ---- real orders load from Supabase ----
  await wait(cdp, `document.querySelectorAll('div.rounded-xl.border').length > 0`, 30000, 'orders loaded');
  const { data: dbOrders } = await admin.from('orders').select('order_number').order('created_at');
  const expected = dbOrders ? dbOrders.length : 0;
  const loaded = await cardCount(cdp);
  record('All orders loaded from Supabase', loaded === expected, `cards=${loaded} db=${expected}`);

  // ---- search by customer name ----
  await type(cdp, '#adminOrderSearch', 'winda');
  await sleep(700);
  const windaCards = await cardTexts(cdp);
  const { data: windaDb } = await admin
    .from('orders')
    .select('order_number')
    .ilike('shipping_address->>name', '%winda%');
  const windaExpected = windaDb ? windaDb.length : 0;
  const windaOk = windaCards.length === windaExpected && windaCards.length > 0;
  record('Search by customer name (winda)', windaOk, `shown=${windaCards.length} db=${windaExpected}`);
  await shot(cdp, 'search-winda');

  // ---- search by order id ----
  const firstNum = dbOrders[0].order_number;
  await type(cdp, '#adminOrderSearch', firstNum);
  await sleep(700);
  const idCards = await cardTexts(cdp);
  record('Search by Order ID', idCards.length === 1 && idCards[0].includes(firstNum), `order=${firstNum}`);
  await shot(cdp, 'search-orderid');

  // ---- no match -> Tidak ditemukan ----
  await type(cdp, '#adminOrderSearch', 'zzzqqqnonexistent');
  await sleep(700);
  const noMatch = await ev(cdp, `document.querySelectorAll('div.rounded-xl.border').length === 0 && document.body.innerText.includes('Tidak ditemukan pesanan yang cocok')`);
  record('No-match shows "Tidak ditemukan pesanan yang cocok"', noMatch, 'empty cards + message');
  await shot(cdp, 'search-notfound');

  // ---- filter status: Menunggu (pending) ----
  await type(cdp, '#adminOrderSearch', '');
  await sleep(500);
  await setSelect(cdp, '#adminOrderStatusFilter', 'pending');
  const pendingCards = await cardTexts(cdp);
  const pendingOk = pendingCards.length > 0 && pendingCards.every((c) => c.includes('Menunggu'));
  record('Filter Status Pesanan = Menunggu', pendingOk, `shown=${pendingCards.length}`);
  await shot(cdp, 'filter-pending');

  // ---- filter payment: Lunas (paid) ----
  await setSelect(cdp, '#adminOrderStatusFilter', '');
  await setSelect(cdp, '#adminOrderPaymentFilter', 'paid');
  const paidCards = await cardTexts(cdp);
  const paidOk = paidCards.length > 0 && paidCards.every((c) => c.includes('Lunas'));
  record('Filter Pembayaran = Lunas', paidOk, `shown=${paidCards.length}; badge Lunas present`);
  await shot(cdp, 'filter-paid');

  // ---- combined search + filter ----
  await setSelect(cdp, '#adminOrderPaymentFilter', '');
  await setSelect(cdp, '#adminOrderStatusFilter', 'delivered');
  await type(cdp, '#adminOrderSearch', 'winda');
  await sleep(700);
  const comboCards = await cardTexts(cdp);
  const { data: comboDb } = await admin
    .from('orders')
    .select('order_number')
    .eq('status', 'delivered')
    .ilike('shipping_address->>name', '%winda%');
  const comboExpected = comboDb ? comboDb.length : 0;
  const comboOk =
    comboCards.length === comboExpected &&
    comboCards.length > 0 &&
    comboCards.every((c) => c.includes('Selesai'));
  record('Search + Filter combined', comboOk, `shown=${comboCards.length} db=${comboExpected} (winda + Selesai)`);
  await shot(cdp, 'combo');

  // ---- detail expands ----
  await type(cdp, '#adminOrderSearch', '');
  await setSelect(cdp, '#adminOrderStatusFilter', '');
  await sleep(700);
  await clickText(cdp, 'Detail');
  const detailOk = await ev(cdp, `document.body.innerText.includes('Sembunyikan')`);
  record('Order detail expands', detailOk, 'Detail -> Sembunyikan with items');
  await shot(cdp, 'detail');
  await clickText(cdp, 'Sembunyikan');

  // ---- new order (as if from website checkout) appears in dashboard ----
  const { error: insErr } = await admin.from('orders').insert({
    order_number: TEST_NUM,
    status: 'pending',
    payment_status: 'unpaid',
    subtotal: 12000,
    shipping_cost: 5000,
    total: 17000,
    shipping_address: { name: TEST_NAME, phone: '081234567890', address: 'Jl. Test E2E 1', city: 'Jakarta', postalCode: '12345' },
  });
  if (insErr) throw new Error('insert test order: ' + insErr.message);
  await cdp.send('Page.reload'); await sleep(2200);
  await wait(cdp, `[...document.querySelectorAll('div.rounded-xl.border')].some(c => c.innerText.includes(${JSON.stringify(TEST_NUM)}))`, 30000, 'test order visible');
  const afterIns = await cardCount(cdp);
  record('New order from website appears in dashboard', afterIns === expected + 1, `cards=${afterIns} (was ${expected})`);
  await shot(cdp, 'new-order');

  // ---- admin updates order_status (test row) ----
  const statusChanged = await ev(cdp, `(() => {
    const card = [...document.querySelectorAll('div.rounded-xl.border')].find(c => c.innerText.includes(${JSON.stringify(TEST_NUM)}));
    if (!card) return false;
    const sel = card.querySelector('select');
    if (!sel) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel, 'processing');
    sel.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  if (!statusChanged) throw new Error('could not change status select on test order');
  await wait(cdp, `document.body.innerText.includes('${TEST_NUM} → processing')`, 20000, 'status notice');
  await sleep(1000);
  const { data: updRow } = await admin.from('orders').select('status, payment_status').eq('order_number', TEST_NUM).single();
  record('Admin updates order_status (not payment_status)', updRow && updRow.status === 'processing' && updRow.payment_status === 'unpaid', `db status=${updRow?.status} pay=${updRow?.payment_status}`);
  await shot(cdp, 'status-updated');
} catch (e) {
  fail('ORDERS E2E', e);
} finally {
  try { cdp?.close(); } catch {}
  chrome.kill('SIGKILL');
  // cleanup: remove the test order row (data we created for this test)
  try {
    await admin.from('orders').delete().eq('order_number', TEST_NUM);
    const { data: leftover } = await admin.from('orders').select('order_number').eq('order_number', TEST_NUM);
    if (leftover && leftover.length) console.log('[warn] test order still present after cleanup');
  } catch (e) { console.log('[warn] cleanup failed:', String(e).slice(0, 120)); }
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.evidence ? ' | ' + r.evidence : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const failn = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
process.exit(failn ? 1 : 0);
