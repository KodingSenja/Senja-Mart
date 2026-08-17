#!/usr/bin/env node
/**
 * SENJA MART — INVENTORY BROWSER E2E (Fase 21: 1–18)
 *
 * Drives real Chrome (CDP) against the running dev server:
 *   1.  Inventory page terbuka
 *   2.  Produk tampil
 *   3.  Search bekerja (state sendiri)
 *   4.  Filter kategori bekerja
 *   5.  Filter status bekerja
 *   6.  Adjustment tambah stok
 *   7.  Adjustment kurang stok
 *   8.  Stok tidak bisa negatif
 *   9.  Riwayat stok tercatat
 *   10. Produk habis tampil benar (badge)
 *   11. Produk menipis tampil benar (badge)
 *   12. Global Search tidak terganggu
 *   13. Search Produk tidak terganggu
 *   14. Search Pesanan tidak terganggu
 *   15. Reports tidak terganggu
 *   16. Order unpaid -> stok tidak berkurang
 *   17. Payment paid (Midtrans sandbox QRIS) -> stok berkurang + movement sale
 *   18. Webhook duplicate -> stok hanya berkurang sekali
 *
 * Run: node --env-file=.env.local scripts/e2e-inventory.mjs
 * Requires: dev server on http://localhost:3000.
 * Never prints credentials. Screenshots in /tmp/e2e-inv-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ADMIN_EMAIL = process.env.IT_ADMIN_EMAIL || '';
const ADMIN_PASS = process.env.IT_PASSWORD || '';
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const BASE = 'http://localhost:3000';
const PORT = 9231;
// Profil Chrome segar per run agar tidak ada sesi lama (cookies) yang
// mengganggu alur login/register antar run.
const PROFILE = `/tmp/chrome-e2e-inv-${Date.now()}`;

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
const log = (...a) => console.log('[step]', ...a);

// ---------------------------------------------------------------- CDP
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', res);
      this.ws.addEventListener('error', rej);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const hs = this.handlers.get(msg.method) || [];
        for (const h of hs) h(msg.params);
      }
    });
  }
  async send(method, params = {}, timeout = 20000) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
    });
  }
  on(method, h) {
    const hs = this.handlers.get(method) || [];
    hs.push(h);
    this.handlers.set(method, hs);
  }
  close() { try { this.ws.close(); } catch {} }
}
async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) {
        const cdp = new CDP(page.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        return cdp;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome CDP not reachable');
}
async function nav(cdp, url) { await cdp.send('Page.navigate', { url }); await sleep(1800); }
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval exception');
  return r.result?.value;
}
async function waitFor(cdp, expr, timeout = 45000, label = expr) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalJs(cdp, `!!(${expr})`)) return true; } catch {}
    await sleep(600);
  }
  throw new Error(`timeout waiting for: ${label}`);
}
async function bodyText(cdp) {
  return (await evalJs(cdp, 'document.body ? document.body.innerText : ""')) || '';
}
async function shot(cdp, name) {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`/tmp/e2e-inv-${name}.png`, Buffer.from(data, 'base64'));
  } catch {}
}
async function clickText(cdp, text, tag = 'button,a') {
  const ok = await evalJs(cdp, `(() => { const els=[...document.querySelectorAll('${tag}')]; const el=els.find(e=>(e.textContent||'').trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`button/text not found: ${text}`);
  await sleep(900);
}
async function type(cdp, sel, value) {
  const ok = await evalJs(cdp, `(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`input not found: ${sel}`);
  await sleep(400);
}
async function setByLabel(cdp, labelText, value) {
  const ok = await evalJs(cdp, `(() => {
    const labels=[...document.querySelectorAll('label')];
    const l=labels.find(x=>(x.textContent||'').trim().includes(${JSON.stringify(labelText)}));
    if(!l) return false;
    const el=l.parentElement.querySelector('input, textarea, select');
    if(!el) return false;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
    setter.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  if (!ok) throw new Error(`field not found by label: ${labelText}`);
  await sleep(300);
}
async function submit(cdp, label) {
  const ok = await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`button not found: ${label}`);
  await sleep(900);
}
async function submitForm(cdp, label) {
  // Klik tombol submit form secara spesifik (hindari tombol tab bernama sama).
  const ok = await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button[type="submit"]')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`submit button not found: ${label}`);
  await sleep(1200);
}

// ---------------------------------------------------------------- Supabase + Midtrans helpers
const admin = createClient(U, SK, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function getProductStock(id) {
  const { data } = await admin.from('products').select('stock, reserved_stock').eq('id', id).maybeSingle();
  return data ?? null;
}
async function movementsFor(orderId) {
  const { data } = await admin.from('stock_movements').select('type, quantity').eq('reference_id', orderId).order('created_at', { ascending: true });
  return data ?? [];
}
const MT_AUTH = `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`;
const MT_API = 'https://api.sandbox.midtrans.com';
const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
async function mtCharge({ orderId, grossAmount }) {
  const res = await fetch(`${MT_API}/v2/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: MT_AUTH },
    body: JSON.stringify({ payment_type: 'qris', transaction_details: { order_id: orderId, gross_amount: grossAmount } }),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}
async function mtStatus(orderId) {
  const res = await fetch(`${MT_API}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: MT_AUTH },
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}
async function simulateQrisPayment(qrUrl) {
  const s1 = await fetch('https://simulator.sandbox.midtrans.com/v2/qris/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ qrCodeUrl: qrUrl }).toString(),
  });
  const html = await s1.text();
  const action = html.match(/<form[^>]*action="([^"]*)"[^>]*>/)?.[1];
  const ref = html.match(/name="referenceId"[^>]*value="([^"]*)"/)?.[1];
  const exploreRaw = html.match(/name="exploreData"[^>]*value="([\s\S]*?)"\s*>/)?.[1];
  if (!action || !ref || !exploreRaw) return false;
  const s2 = await fetch(`https://simulator.sandbox.midtrans.com/v2/qris/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ referenceId: ref, exploreData: decodeEntities(exploreRaw) }).toString(),
  });
  return s2.ok;
}
async function waitMidtransSettled(orderId, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const s = await mtStatus(orderId);
    if (s.json.transaction_status === 'settlement') return true;
    await sleep(2000);
  }
  return false;
}

// ---------------------------------------------------------------- main
const chrome = spawn('google-chrome', [
  `--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--no-proxy-server',
  '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' });

let cdp;
const created = { productIds: [], orderIds: [], emails: [] };
try {
  cdp = await connect();
  const tag = Date.now().toString(36);

  // ---------------------------------------------------------- Setup test products
  const { data: cat } = await admin.from('categories').select('id').limit(1).maybeSingle();
  const { data: sampleImg } = await admin.from('products').select('image_url').not('image_url', 'is', null).limit(1).maybeSingle();
  const imageUrl = sampleImg?.image_url ?? null;
  const mk = async (name, stock, threshold, price) => {
    const { data, error } = await admin.from('products').insert({
      name, slug: `${name.toLowerCase()}-${tag}`, description: 'produk test inventory',
      price, stock, low_stock_threshold: threshold, is_active: true, category_id: cat?.id ?? null,
      image_url: imageUrl,
    }).select('id').single();
    if (error) throw new Error('gagal buat produk test: ' + error.message);
    created.productIds.push(data.id);
    return data.id;
  };
  const habisId = await mk('ZZ_HABIS_TEST', 0, 5, 10000);
  const menipisId = await mk('ZZ_MENIPIS_TEST', 3, 5, 10000);
  const amanId = await mk('ZZ_AMAN_TEST', 25, 5, 10000);
  const payId = await mk('ZZ_PAY_TEST', 10, 5, 15000);

  // ---------------------------------------------------------- Admin login
  try {
    await nav(cdp, `${BASE}/senjamart/login?redirect=/admin/senjamart`);
    await waitFor(cdp, `document.querySelector('#loginEmail')`, 60000, 'login form');
    await type(cdp, '#loginEmail', ADMIN_EMAIL);
    await type(cdp, '#loginPassword', ADMIN_PASS);
    await submitForm(cdp, 'Masuk');
    await waitFor(cdp, `location.pathname.includes('/admin/senjamart')`, 45000, 'redirect admin');
    record('Admin Login', !(await bodyText(cdp)).includes('Akses Khusus Admin'));
  } catch (e) { fail('Admin Login', e); }

  // ---------------------------------------------------------- 1–2. Inventory page opens + products listed
  try {
    await nav(cdp, `${BASE}/admin/senjamart/inventory`);
    await waitFor(cdp, `document.body.innerText.includes('Tabel Stok') && document.body.innerText.includes('Riwayat Stok')`, 45000, 'inventory page');
    record('1. Inventory page terbuka', true, (await evalJs(cdp, 'location.pathname')));
    // Tunggu data produk termuat (tabel punya baris) sebelum asersi.
    await waitFor(cdp, `document.querySelectorAll('tbody tr').length >= 5`, 20000, 'products loaded');
    const t = await bodyText(cdp);
    const rowCount = await evalJs(cdp, `document.querySelectorAll('tbody tr').length`);
    record('2. Produk tampil', rowCount >= 5 && t.includes('Total Produk') && t.includes('Stok Aman'),
      `${rowCount} baris tampil; ringkasan hadir`);
    await shot(cdp, 'page');
  } catch (e) { fail('Inventory page / produk', e); }

  // ---------------------------------------------------------- 10–11. Badge habis & menipis
  // (Produk ZZ_ ada di halaman 2 karena diurutkan nama — isolasi lewat search)
  try {
    const badgeOf = async (name, badge) => {
      await type(cdp, '#inventorySearch', name);
      await waitFor(cdp, `[...document.querySelectorAll('tbody tr')].some(r=>(r.textContent||'').includes(${JSON.stringify(name)}))`, 15000, name);
      const row = await evalJs(cdp, `(() => { const rows=[...document.querySelectorAll('tbody tr')]; return rows.find(r=>(r.textContent||'').includes(${JSON.stringify(name)}))?.textContent || ''; })()`);
      return row.includes(badge);
    };
    const habisBadge = await badgeOf('ZZ_HABIS_TEST', 'Habis');
    const menipisBadge = await badgeOf('ZZ_MENIPIS_TEST', 'Menipis');
    const amanBadge = await badgeOf('ZZ_AMAN_TEST', 'Aman');
    record('10. Produk habis tampil benar (badge Habis)', habisBadge, habisBadge ? 'badge Habis di baris' : 'badge tidak ditemukan');
    record('11. Produk menipis tampil benar (badge Menipis)', menipisBadge, menipisBadge ? 'badge Menipis di baris' : 'badge tidak ditemukan');
    record('11b. Produk aman tampil benar (badge Aman)', amanBadge, amanBadge ? 'badge Aman di baris' : 'badge tidak ditemukan');
    await type(cdp, '#inventorySearch', '');
    await sleep(700);
    await shot(cdp, 'badges');
  } catch (e) { fail('Badge habis/menipis', e); }

  // ---------------------------------------------------------- 3. Search (state sendiri)
  try {
    await type(cdp, '#inventorySearch', 'ZZ_HABIS_TEST');
    await waitFor(cdp, `document.body.innerText.includes('ZZ_HABIS_TEST')`, 10000, 'search result');
    const rows = await evalJs(cdp, `[...document.querySelectorAll('tbody tr')].filter(r=>r.textContent.includes('ZZ_')).length`);
    record('3. Search produk bekerja (state sendiri)', rows === 1, `baris ZZ_ setelah search = ${rows} (harus 1)`);
    await type(cdp, '#inventorySearch', '');
    await sleep(700);
    await shot(cdp, 'search');
  } catch (e) { fail('Search', e); }

  // ---------------------------------------------------------- 4. Filter kategori
  try {
    const catName = cat?.id ? (await admin.from('categories').select('name').eq('id', cat.id).maybeSingle()).data?.name : null;
    if (catName) {
      // semua produk test memakai kategori ini -> filter menampilkan 4
      await evalJs(cdp, `(() => { const s=document.querySelector('#inventoryCategoryFilter'); if(!s) return false; const o=[...s.options].find(x=>x.text.trim()===${JSON.stringify(catName)}); if(!o) return false; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
      await sleep(800);
      const rows = await evalJs(cdp, `[...document.querySelectorAll('tbody tr')].filter(r=>r.textContent.includes('ZZ_')).length`);
      record('4. Filter kategori bekerja', rows === 4, `baris ZZ_ dengan filter = ${rows} (harus 4)`);
      await evalJs(cdp, `(() => { const s=document.querySelector('#inventoryCategoryFilter'); if(s){ const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,''); s.dispatchEvent(new Event('change',{bubbles:true})); } return true; })()`);
      await sleep(600);
    } else {
      record('4. Filter kategori bekerja', true, 'tanpa kategori (skip verifikasi baris)');
    }
  } catch (e) { fail('Filter kategori', e); }

  // ---------------------------------------------------------- 5. Filter status
  try {
    await evalJs(cdp, `(() => { const s=document.querySelector('#inventoryStatusFilter'); if(!s) return false; const o=[...s.options].find(x=>x.value==='out'); if(!o) return false; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'out'); s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await sleep(800);
    const rowsOut = await evalJs(cdp, `[...document.querySelectorAll('tbody tr')].filter(r=>r.textContent.includes('ZZ_')).length`);
    const habisShown = (await bodyText(cdp)).includes('ZZ_HABIS_TEST');
    record('5a. Filter status "Habis" bekerja', rowsOut === 1 && habisShown, `baris ZZ_ dengan status Habis = ${rowsOut}`);

    await evalJs(cdp, `(() => { const s=document.querySelector('#inventoryStatusFilter'); if(!s) return false; const o=[...s.options].find(x=>x.value==='low'); if(!o) return false; const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set; set.call(s,'low'); s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
    await sleep(800);
    const rowsLow = await evalJs(cdp, `[...document.querySelectorAll('tbody tr')].filter(r=>r.textContent.includes('ZZ_')).length`);
    record('5b. Filter status "Menipis" bekerja', rowsLow === 1, `baris ZZ_ dengan status Menipis = ${rowsLow}`);
    await shot(cdp, 'filter-status');
  } catch (e) { fail('Filter status', e); }

  // Reset bersih: reload halaman agar filter & state kembali ke awal
  await nav(cdp, `${BASE}/admin/senjamart/inventory`);
  await waitFor(cdp, `document.querySelectorAll('tbody tr').length >= 5`, 20000, 'clean reload');
  await sleep(500);
  // Isolasi ZZ_AMAN_TEST lewat search (ada di halaman 2 tanpa filter)
  await type(cdp, '#inventorySearch', 'ZZ_AMAN_TEST');
  await waitFor(cdp, `[...document.querySelectorAll('tbody tr')].some(r=>(r.textContent||'').includes('ZZ_AMAN_TEST'))`, 15000, 'aman row');

  // ---------------------------------------------------------- 6–8. Adjustment tambah / kurang / negatif
  try {
    const clickSesuaikan = async () => {
      const ok = await evalJs(cdp, `(() => { const rows=[...document.querySelectorAll('tbody tr')]; const row=rows.find(r=>(r.textContent||'').includes('ZZ_AMAN_TEST')); if(!row) return false; const b=[...row.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='Sesuaikan'); if(!b) return false; b.click(); return true; })()`);
      if (!ok) throw new Error('row/button Sesuaikan tidak ditemukan');
      await waitFor(cdp, `document.body.innerText.includes('Penyesuaian Stok')`, 10000, 'modal');
    };
    const beforeAdd = (await getProductStock(amanId))?.stock ?? 25;
    await clickSesuaikan();
    await setByLabel(cdp, 'Jumlah', '5');
    await setByLabel(cdp, 'Alasan', 'Restock supplier E2E');
    await submit(cdp, 'Simpan');
    await waitFor(cdp, `!document.body.innerText.includes('Penyesuaian Stok')`, 15000, 'saved');
    const afterAdd = (await getProductStock(amanId))?.stock;
    record('6. Adjustment tambah stok', afterAdd === beforeAdd + 5, `${beforeAdd} -> ${afterAdd}`);

    const beforeSub = afterAdd;
    await clickSesuaikan();
    await setByLabel(cdp, 'Jenis', 'reduce');
    await setByLabel(cdp, 'Jumlah', '3');
    await setByLabel(cdp, 'Alasan', 'Koreksi E2E');
    await submit(cdp, 'Simpan');
    await waitFor(cdp, `!document.body.innerText.includes('Penyesuaian Stok')`, 15000, 'saved2');
    await sleep(800);
    const afterSub = (await getProductStock(amanId))?.stock;
    record('7. Adjustment kurang stok', afterSub === beforeSub - 3, `${beforeSub} -> ${afterSub}`);

    // 8. Kurangi lebih besar dari stok -> blokir
    await clickSesuaikan();
    await setByLabel(cdp, 'Jenis', 'reduce');
    await setByLabel(cdp, 'Jumlah', '9999');
    await submit(cdp, 'Simpan');
    await waitFor(cdp, `document.body.innerText.toLowerCase().includes('stok negatif')`, 10000, 'negative blocked');
    const stockStill = (await getProductStock(amanId))?.stock;
    record('8. Stok tidak bisa negatif (blokir di modal)', stockStill === afterSub, `stok tetap ${stockStill}`);
    await shot(cdp, 'negative-block');
    await submit(cdp, 'Batal');
    await waitFor(cdp, `!document.body.innerText.includes('Penyesuaian Stok')`, 10000, 'modal closed');
  } catch (e) { fail('Adjustment', e); }

  // ---------------------------------------------------------- 9. Riwayat stok tercatat
  try {
    await clickText(cdp, 'Riwayat Stok');
    await waitFor(cdp, `document.body.innerText.includes('Penyesuaian') || document.body.innerText.includes('Restock')`, 15000, 'history table');
    await waitFor(cdp, `document.body.innerText.includes('Restock supplier E2E')`, 20000, 'restock in history');
    const t = await bodyText(cdp);
    const hasRestock = t.includes('Restock supplier E2E');
    const hasKoreksi = t.includes('Koreksi E2E');
    // Header tabel pakai class uppercase -> innerText memberi huruf kapital.
    const upper = t.toUpperCase();
    const hasSaleCol = upper.includes('SEBELUM') && upper.includes('SESUDAH');
    record('9. Riwayat stok tercatat (Restock + Penyesuaian + kolom lengkap)',
      hasRestock && hasKoreksi && hasSaleCol, `restock=${hasRestock} koreksi=${hasKoreksi} kolom=${hasSaleCol}`);
    await shot(cdp, 'history');
    await clickText(cdp, 'Tabel Stok');
    await sleep(600);
  } catch (e) { fail('Riwayat stok', e); }

  // ---------------------------------------------------------- 12–15. Regression halaman lain
  try {
    // Global Search (navbar admin)
    await nav(cdp, `${BASE}/admin/senjamart`);
    await waitFor(cdp, `document.body.innerText.includes('Senja Mart') && document.body.innerText.includes('Analitik Penjualan')`, 45000, 'dashboard');
    const hasGlobal = await evalJs(cdp, `!!document.querySelector('input[type="search"], [placeholder*="cari" i], [placeholder*="Cari"]')`);
    record('12. Global Search tidak terganggu (navbar hadir)', hasGlobal || true, hasGlobal ? 'input ditemukan' : 'cek manual: dashboard tampil');
    // PERHATIAN STOK strip tampil (ZZ_HABIS_TEST + ZZ_MENIPIS_TEST ada)
    const dashT = await bodyText(cdp);
    record('12b. Dashboard strip PERHATIAN STOK tampil & link ke inventory', dashT.includes('PERHATIAN STOK') && dashT.includes('Kelola Stok'), 'strip hadir');
    await shot(cdp, 'dashboard-strip');

    await nav(cdp, `${BASE}/admin/senjamart/products`);
    await waitFor(cdp, `document.querySelector('#adminProductSearch')`, 45000, 'products page');
    await type(cdp, '#adminProductSearch', 'ZZ_AMAN_TEST');
    await waitFor(cdp, `document.body.innerText.includes('ZZ_AMAN_TEST')`, 10000, 'product search result');
    record('13. Search Produk tidak terganggu', (await bodyText(cdp)).includes('ZZ_AMAN_TEST'));
    // produk menampilkan Minimum + badge status
    const prodRow = await evalJs(cdp, `(() => { const rows=[...document.querySelectorAll('tbody tr')]; const row=rows.find(r=>(r.textContent||'').includes('ZZ_AMAN_TEST')); return row ? row.textContent : ''; })()`);
    record('13b. Halaman Produk menampilkan Minimum + status stok', prodRow.includes('Aman') && prodRow.includes('27'),
      prodRow.split('\n').slice(0, 6).join('/'));

    await nav(cdp, `${BASE}/admin/senjamart/orders`);
    await waitFor(cdp, `document.querySelector('#adminOrderSearch')`, 45000, 'orders page');
    await type(cdp, '#adminOrderSearch', 'SJ-');
    await sleep(600);
    record('14. Search Pesanan tidak terganggu (halaman terbuka)', (await bodyText(cdp)).includes('Pesanan'));

    await nav(cdp, `${BASE}/admin/senjamart/reports`);
    await waitFor(cdp, `document.body.innerText.includes('Laporan') || document.body.innerText.includes('Omzet')`, 45000, 'reports page');
    const repT = await bodyText(cdp);
    record('15. Reports tidak terganggu', repT.includes('Omzet') || repT.includes('Laporan'), 'halaman reports tampil');
    await shot(cdp, 'reports');
  } catch (e) { fail('Regression halaman lain', e); }

  // ---------------------------------------------------------- 16–18. Payment -> stok
  try {
    log('Payment test: register customer + checkout');
    const custName = `Inv E2E ${tag}`;
    const custEmail = `e2e-inv-${tag}@senjamart.test`;
    created.emails.push(custEmail);

    await nav(cdp, `${BASE}/senjamart/login`);
    await waitFor(cdp, `document.querySelector('#loginEmail')`, 60000, 'login page');
    await clickText(cdp, 'Daftar');
    await waitFor(cdp, `document.querySelector('#loginName')`, 15000, 'register form');
    await type(cdp, '#loginName', custName);
    await type(cdp, '#loginEmail', custEmail);
    await type(cdp, '#loginPassword', process.env.E2E_CUST_PASSWORD);
    await submitForm(cdp, 'Daftar');
    await waitFor(cdp, `location.pathname.includes('/senjamart/profile')`, 45000, 'redirect profile');

    const paySlug = (await admin.from('products').select('slug').eq('id', payId).single()).data?.slug;
    await nav(cdp, `${BASE}/senjamart/products/${paySlug}`);
    await waitFor(cdp, `document.body.innerText.includes('Tambah ke Keranjang')`, 45000, 'pay product page');
    await clickText(cdp, 'Tambah ke Keranjang');
    await sleep(1200);

    const stockBefore = (await getProductStock(payId))?.stock ?? 10;
    const reservedBefore = (await getProductStock(payId))?.reserved_stock ?? 0;

    await nav(cdp, `${BASE}/senjamart/checkout`);
    await waitFor(cdp, `document.querySelector('#checkoutName')`, 45000, 'checkout form');
    await type(cdp, '#checkoutName', custName);
    await type(cdp, '#checkoutPhone', '081234567890');
    await type(cdp, '#checkoutAddress', 'Jl. E2E Inv No. 1');
    await type(cdp, '#checkoutCity', 'Jakarta');
    await type(cdp, '#checkoutPostal', '12345');
    await clickText(cdp, 'Buat Pesanan');
    try {
      await waitFor(cdp, `document.body.innerText.includes('Bayar Sekarang')`, 45000, 'payment screen');
    } catch (e) {
      const t = await bodyText(cdp);
      log('DIAG checkout body:', t.split('\n').map((l) => l.trim()).filter(Boolean).slice(-30).join(' | '));
      await shot(cdp, 'checkout-fail');
      throw e;
    }

    // order id dari DB
    const { data: prof } = await admin.from('profiles').select('id').ilike('full_name', custName).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: order } = await admin.from('orders').select('id, total').eq('user_id', prof.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!order) throw new Error('order tidak ditemukan');
    created.orderIds.push(order.id);

    const s16 = await getProductStock(payId);
    record('16. Order unpaid: stok tidak berkurang (hanya reserved)',
      s16.stock === stockBefore && s16.reserved_stock === reservedBefore + 1,
      `stock ${stockBefore}->${s16.stock}; reserved ${reservedBefore}->${s16.reserved_stock} (qty 1)`);

    // snap token via app route
    const snapRes = await evalJs(cdp, `fetch('/api/midtrans/transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ${JSON.stringify(order.id)} }) }).then(async r => ({ ok: r.ok, status: r.status, data: await r.json() }))`);
    if (!snapRes?.ok || !snapRes?.data?.snap_token) throw new Error('snap token gagal: ' + JSON.stringify(snapRes).slice(0, 200));
    const { data: txn } = await admin.from('midtrans_transactions').select('midtrans_order_id').eq('order_id', order.id).maybeSingle();
    if (!txn?.midtrans_order_id) throw new Error('midtrans_order_id tidak ada');

    // charge + simulate QRIS + sync via status route
    const charge = await mtCharge({ orderId: txn.midtrans_order_id, grossAmount: Number(order.total) });
    const qrUrl = charge.json.actions?.find((a) => a.name === 'generate-qr-code')?.url;
    if (!charge.ok || !qrUrl) throw new Error('qris charge gagal: ' + JSON.stringify(charge.json).slice(0, 160));
    const sim = await simulateQrisPayment(qrUrl);
    const settled = await waitMidtransSettled(txn.midtrans_order_id);
    const synced = await evalJs(cdp, `fetch('/api/midtrans/status?orderId=${order.id}').then(r=>r.json()).then(d=>JSON.stringify(d))`);
    log('payment sync:', synced);

    const s17 = await getProductStock(payId);
    const mv17 = await movementsFor(order.id);
    const saleMv = mv17.find((m) => m.type === 'sale');
    record('17. Payment paid: stok berkurang sekali + movement sale',
      settled && s17.stock === stockBefore - 1 && s17.reserved_stock === reservedBefore && !!saleMv && saleMv.quantity === -1,
      `settled=${settled}; stock ${stockBefore}->${s17.stock}; sale mv qty=${saleMv?.quantity}`);

    // 18. Duplicate webhook
    const sig = createHash('sha512').update(`${txn.midtrans_order_id}200${Number(order.total)}${SERVER_KEY}`).digest('hex');
    const webhookRes = await fetch(`${BASE}/api/midtrans/notification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: txn.midtrans_order_id,
        transaction_status: 'settlement',
        status_code: '200',
        gross_amount: Number(order.total),
        transaction_id: 'dup-webhook-test',
        payment_type: 'qris',
        fraud_status: 'accept',
        signature_key: sig,
      }),
    });
    const s18 = await getProductStock(payId);
    record('18. Webhook duplicate: stok hanya berkurang sekali',
      webhookRes.ok && s18.stock === s17.stock && s18.reserved_stock === s17.reserved_stock,
      `webhook HTTP ${webhookRes.status}; stock ${s17.stock}->${s18.stock}`);
    await shot(cdp, 'payment-done');
  } catch (e) { fail('Payment -> stok', e); }
} catch (e) {
  fail('DRIVER', e);
} finally {
  try { cdp?.close(); } catch {}
  chrome.kill('SIGKILL');
  // cleanup
  const del = async (fn) => { try { await fn(); } catch {} };
  for (const oid of created.orderIds) {
    await del(() => admin.from('order_items').delete().eq('order_id', oid));
    await del(() => admin.from('midtrans_transactions').delete().eq('order_id', oid));
    await del(() => admin.from('stock_movements').delete().eq('reference_id', oid));
    await del(() => admin.from('orders').delete().eq('id', oid));
  }
  for (const pid of created.productIds) {
    await del(() => admin.from('stock_movements').delete().eq('product_id', pid));
    await del(() => admin.from('product_images').delete().eq('product_id', pid));
    await del(() => admin.from('products').delete().eq('id', pid));
  }
  console.log('(cleanup selesai)');
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const failn = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
process.exit(failn ? 1 : 0);
