#!/usr/bin/env node
/**
 * SENJA MART — DASHBOARD ANALYTICS E2E (real Supabase data)
 * Run (dev server on :3000): node --env-file=.env.local scripts/e2e-dashboard-analytics.mjs
 * Verifies the admin dashboard analytics against independently computed
 * values from Supabase (omzet, order counts, top products, recent orders,
 * low stock). No data is modified.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:3000';
const PORT = 9237;
const PROFILE = '/tmp/chrome-dash-analytics';
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
    this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.addEventListener('open', res); this.ws.addEventListener('error', rej); });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { const { resolve, reject } = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); }
    });
  }
  async send(method, params = {}) { await this.ready; const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej })); }
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
const type = async (cdp, sel, val) => { await ev(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(300); };
const submit = async (cdp, label) => { const ok = await ev(cdp, `(() => { const b=[...document.querySelectorAll('button[type=submit]')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`); if (!ok) throw new Error('no submit: ' + label); await sleep(1000); };
const shot = async (cdp, n) => { try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/dash-' + n + '.png', Buffer.from(data, 'base64')); } catch {} };

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

// ---- independent ground truth from Supabase (mirrors dashboard.ts logic) ----
const J = 7 * 3600 * 1000;
const jKey = (iso) => new Date(new Date(iso).getTime() + J).toISOString().slice(0, 10);
const startDay = (days) => {
  const jn = new Date(Date.now() + J);
  const s = Date.UTC(jn.getUTCFullYear(), jn.getUTCMonth(), jn.getUTCDate());
  return new Date(s - days * 86400000 - J).toISOString();
};

const { data: orders } = await admin.from('orders').select('id, order_number, total, status, payment_status, created_at, shipping_address');
let revToday = 0, rev7 = 0, rev30 = 0;
const counts = { pending: 0, processing: 0, shipped: 0, delivered: 0, cancelled: 0 };
const recent = [];
for (const o of orders || []) {
  if (counts[o.status] !== undefined) counts[o.status] += 1;
  if (o.status !== 'cancelled') {
    const t = Number(o.total);
    if (o.created_at >= startDay(0)) revToday += t;
    if (o.created_at >= startDay(6)) rev7 += t;
    if (o.created_at >= startDay(29)) rev30 += t;
  }
  if (recent.length < 8) recent.push(o);
}
const totalOrders = orders ? orders.length : 0;

const { data: items } = await admin.from('order_items').select('product_id, product_name, price, quantity');
const agg = {};
for (const it of items || []) {
  const id = it.product_id || it.product_name;
  const a = agg[id] || { name: it.product_name, q: 0, r: 0 };
  a.q += it.quantity;
  a.r += Number(it.price) * it.quantity;
  agg[id] = a;
}
const topProducts = Object.entries(agg)
  .map(([productId, v]) => ({ productId, name: v.name, q: v.q, r: v.r }))
  .sort((a, b) => b.q - a.q || b.r - a.r)
  .slice(0, 5);

const { data: prods } = await admin.from('products').select('id, name, stock').order('stock', { ascending: true });
const lowStock = (prods || []).filter((p) => p.stock <= 20).slice(0, 8);

const fmt = (n) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

const chrome = spawn('google-chrome', [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', `--user-data-dir=${PROFILE}`, '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
let cdp;
try {
  cdp = await connect();
  await cdp.send('Page.navigate', { url: `${BASE}/senjamart/login?redirect=/admin/senjamart` }); await sleep(2500);
  await wait(cdp, `document.querySelector('#loginEmail')`, 60000, 'login form');
  await type(cdp, '#loginEmail', process.env.IT_ADMIN_EMAIL || '');
  await type(cdp, '#loginPassword', process.env.IT_PASSWORD);
  await submit(cdp, 'Masuk');
  await wait(cdp, `location.pathname.includes('/admin/senjamart')`, 45000, 'admin redirect');

  await cdp.send('Page.navigate', { url: `${BASE}/admin/senjamart` }); await sleep(2500);
  await wait(cdp, `document.body.innerText.includes('Analitik Penjualan')`, 45000, 'analytics section');
  await wait(cdp, `!document.body.innerText.includes('Memuat analitik')`, 30000, 'analytics loaded');
  await shot(cdp, 'overview');

  const body = await txt(cdp);

  // 1. Omzet cards
  record('Omzet hari ini', body.includes(`Omzet — Hari ini`) && body.includes(fmt(revToday)), `expected ${fmt(revToday)}`);
  record('Omzet 7 hari', body.includes(`Omzet — 7 hari terakhir`) && body.includes(fmt(rev7)), `expected ${fmt(rev7)}`);
  record('Omzet 30 hari', body.includes(`Omzet — 30 hari terakhir`) && body.includes(fmt(rev30)), `expected ${fmt(rev30)}`);

  // 2. Order counts
  record('Total pesanan card', body.includes('Total Pesanan') && body.includes(String(totalOrders)), `expected ${totalOrders}`);
  for (const [s, label] of [['pending', 'Menunggu'], ['processing', 'Diproses'], ['shipped', 'Dikirim'], ['delivered', 'Selesai'], ['cancelled', 'Dibatalkan']]) {
    // count card shows the number near the status label
    const ok = body.includes(label) && body.includes(String(counts[s]));
    record(`Pesanan ${label}`, ok, `expected ${counts[s]}`);
  }

  // 3. Chart present
  const chartOk = await ev(cdp, `document.body.innerText.includes('Grafik Omzet') && document.body.innerText.includes('7 Hari') && document.body.innerText.includes('30 Hari')`);
  record('Grafik omzet + toggle 7/30', chartOk, 'chart rendered');
  // toggle to 30 hari
  await ev(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='30 Hari'); if(!b) return false; b.click(); return true; })()`);
  await sleep(600);
  record('Grafik toggle 30 hari aktif', await ev(cdp, `[...document.querySelectorAll('button')].some(b=>(b.textContent||'').trim()==='30 Hari' && b.className.includes('bg-brand-500'))`), 'active state');
  await shot(cdp, 'chart-30');

  // 4. Top products
  if (topProducts.length > 0) {
    const first = topProducts[0];
    const ok = body.includes('Produk Terlaris') && body.includes(first.name) && body.includes(String(first.q) + ' terjual');
    record('Produk terlaris #1', ok, `${first.name} (${first.q}x, ${fmt(first.r)})`);
    // every top product name present
    const all = topProducts.every((p) => body.includes(p.name));
    record('Semua top 5 tampil', all, `top=${topProducts.length}`);
  } else {
    record('Produk terlaris (empty)', body.includes('Belum ada penjualan'), 'no sales');
  }

  // 5. Recent orders
  if (recent.length > 0) {
    const first = recent[0];
    const orderNo = first.order_number ?? first.id.slice(0, 8).toUpperCase();
    const customer = first.shipping_address?.name ?? null;
    const ok = body.includes('Pesanan Terbaru') && body.includes(orderNo) && (customer ? body.includes(customer) : true);
    record('Recent order terbaru', ok, `${orderNo} · ${customer ?? '—'} · ${fmt(Number(first.total))}`);
    const payLabel = first.payment_status === 'paid' ? 'Lunas' : first.payment_status === 'pending' ? 'Menunggu' : 'Belum Bayar';
    record('Recent order status badge', body.includes(payLabel), `pay=${first.payment_status}`);
  } else {
    record('Recent orders (empty)', body.includes('Belum ada pesanan'), 'no orders');
  }

  // 6. Low stock
  if (lowStock.length > 0) {
    const ok = body.includes('Stok Menipis') && body.includes(lowStock[0].name) && body.includes('Stok ' + lowStock[0].stock);
    record('Stok menipis tampil', ok, `${lowStock[0].name} (${lowStock[0].stock})`);
    const all = lowStock.every((p) => body.includes(p.name));
    record('Semua stok menipis tampil', all, `low=${lowStock.length}`);
  } else {
    record('Stok menipis (empty)', body.includes('Semua stok aman'), 'no low stock');
  }

  // 7. Old dashboard cards still present
  record('Kartu lama tetap ada', body.includes('Produk') && body.includes('Kategori') && body.includes('Pesanan') && body.includes('Pendapatan') && body.includes('+ Tambah Produk'), '4 cards + shortcut');
  await shot(cdp, 'bottom');
} catch (e) {
  fail('DASHBOARD ANALYTICS E2E', e);
} finally {
  try { cdp?.close(); } catch {}
  chrome.kill('SIGKILL');
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.evidence ? ' | ' + r.evidence : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const failn = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
process.exit(failn ? 1 : 0);
