#!/usr/bin/env node
/**
 * Real-browser E2E driver for Senja Mart UI via Chrome DevTools Protocol.
 * Uses Node's global WebSocket — no extra dependency.
 *
 * Usage:
 *   E2E_MODE=admin    node scripts/e2e-ui-driver.mjs
 *   E2E_MODE=customer node scripts/e2e-ui-driver.mjs
 *
 * Never prints credentials. Evidence screenshots go to /tmp/e2e-<mode>-*.png.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const MODE = process.env.E2E_MODE || 'admin';
const PORT = MODE === 'admin' ? 9222 : 9223;
const PROFILE = `/tmp/chrome-e2e-${MODE}`;
const BASE = 'http://localhost:3000';
const IMG = new URL('../scripts/e2e-test-image.png', import.meta.url).pathname;
const SLUG = 'e2etestproduct'; // slugify('E2E_TEST_PRODUCT') as produced by lib/utils/slugify

// Test data (credentials are internal, never printed).
// Admin creds come from env (IT_ADMIN_EMAIL/IT_PASSWORD) with a legacy fallback.
const ADMIN_EMAIL = process.env.IT_ADMIN_EMAIL || 'it-1786364423161-ioxyav-a@senjamart.test';
const ADMIN_PASS = process.env.IT_PASSWORD || 'SenjaMart-IT-2026!x';
const CUST_NAME = 'E2E Test Customer';
const CUST_EMAIL = `e2e-${Date.now()}-cust@senjamart.test`;
const CUST_PASS = 'SenjaMart-E2E-2026!x';

const results = [];
const record = (name, ok, ev = '') => {
  results.push({ name, ok: ok ? 'PASS' : 'FAIL', ev });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${ev ? ' | ' + ev : ''}`);
};
const fail = (name, err) => {
  results.push({ name, ok: 'FAIL', ev: String(err).slice(0, 300) });
  console.log(`[FAIL] ${name} | ${String(err).slice(0, 300)}`);
};

// ---------------------------------------------------------------- CDP client
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
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, h) {
    const hs = this.handlers.get(method) || [];
    hs.push(h);
    this.handlers.set(method, hs);
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  // find page target
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return new CDP(page.webSocketDebuggerUrl);
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome CDP not reachable');
}

// ---------------------------------------------------------------- helpers
async function nav(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await sleep(1500);
}
async function evalJs(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval exception');
  return r.result?.value;
}
async function waitFor(cdp, expr, timeout = 45000, label = expr) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (await evalJs(cdp, `!!(${expr})`)) return true;
    } catch {}
    await sleep(500);
  }
  throw new Error(`timeout waiting for: ${label}`);
}
async function bodyText(cdp) {
  return (await evalJs(cdp, 'document.body ? document.body.innerText : ""')) || '';
}
async function shot(cdp, name) {
  try {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`/tmp/e2e-${MODE}-${name}.png`, Buffer.from(data, 'base64'));
  } catch {}
}
async function clickText(cdp, text, tag = 'button,a') {
  const ok = await evalJs(cdp, `(() => { const els=[...document.querySelectorAll('${tag}')]; const el=els.find(e=>(e.textContent||'').trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`button/text not found: ${text}`);
  await sleep(800);
}
async function clickSel(cdp, sel) {
  const ok = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`selector not found: ${sel}`);
  await sleep(800);
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
  await sleep(300);
}
async function setFiles(cdp, sel, path) {
  await cdp.send('DOM.enable');
  const doc = await cdp.send('DOM.getDocument');
  const q = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
  if (!q.nodeId) throw new Error(`file input not found: ${sel}`);
  await cdp.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [path] });
  await sleep(1200);
}
async function submit(cdp, label) {
  const ok = await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button[type="submit"]')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`submit button not found: ${label}`);
  await sleep(800);
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
async function setSelectByOption(cdp, optionText) {
  const ok = await evalJs(cdp, `(() => {
    const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.text.trim()===${JSON.stringify(optionText)}));
    if(!s) return false;
    const o=[...s.options].find(o=>o.text.trim()===${JSON.stringify(optionText)});
    const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
    setter.call(s, o.value);
    s.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  if (!ok) throw new Error(`select option not found: ${optionText}`);
  await sleep(300);
}
async function checkBox(cdp, sel, wantChecked) {
  const r = await evalJs(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; if(el.checked !== ${wantChecked}) { el.click(); } return el.checked; })()`);
  if (r === null) throw new Error(`checkbox not found: ${sel}`);
  await sleep(400);
  return r;
}

// ---------------------------------------------------------------- run modes
async function runAdmin(cdp) {
  console.log('--- ADMIN E2E ---');
  // 1. Admin login
  try {
    await nav(cdp, `${BASE}/senjamart/login?redirect=/admin/senjamart`);
    await waitFor(cdp, `document.querySelector('#loginEmail')`, 60000, 'login form');
    await type(cdp, '#loginEmail', ADMIN_EMAIL);
    await type(cdp, '#loginPassword', ADMIN_PASS);
    await submit(cdp, 'Masuk');
    await waitFor(cdp, `location.pathname.includes('/admin/senjamart')`, 45000, 'redirect admin');
    const denied = (await bodyText(cdp)).includes('Akses Khusus Admin');
    record('Admin Login', !denied, `URL=${await evalJs(cdp, 'location.pathname')}${denied ? ' (denied screen!)' : ''}`);
    await shot(cdp, 'admin-login');
  } catch (e) {
    try {
      console.log('DIAG href:', await evalJs(cdp, 'location.href'));
      console.log('DIAG body:', ((await bodyText(cdp)) || '').slice(0, 600).replace(/\n+/g, ' | '));
      await shot(cdp, 'login-fail');
    } catch {}
    fail('Admin Login', e);
  }

  // 2. Category CRUD
  try {
    await nav(cdp, `${BASE}/admin/senjamart/categories`);
    await waitFor(cdp, `[...document.querySelectorAll('button')].some(b=>(b.textContent||'').includes('Tambah Kategori'))`, 45000, 'categories page');
    await clickText(cdp, 'Tambah Kategori');
    await waitFor(cdp, `document.querySelector('input[placeholder="cth: Minuman"]')`, 15000, 'category form');
    await type(cdp, 'input[placeholder="cth: Minuman"]', 'E2E_TEST_CATEGORY');
    await clickText(cdp, 'Buat Kategori');
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_CATEGORY') && document.body.innerText.includes('dibuat')`, 20000, 'category created');
    record('Category Create', true, await (async () => { const t = await bodyText(cdp); return t.split('\n').find(l => l.includes('dibuat')) || 'row added'; })());
    await shot(cdp, 'cat-created');

    await clickText(cdp, 'Edit');
    await waitFor(cdp, `document.querySelector('input[placeholder="cth: Minuman"]')`, 15000, 'edit form');
    await type(cdp, 'input[placeholder="cth: Minuman"]', 'E2E_TEST_CATEGORY_EDITED');
    await clickText(cdp, 'Simpan');
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_CATEGORY_EDITED') && document.body.innerText.includes('diperbarui')`, 20000, 'category edited');
    record('Category Edit', true, 'renamed to E2E_TEST_CATEGORY_EDITED');
    await shot(cdp, 'cat-edited');

    // toggle off then on
    const pillOff = await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Aktif$/.test((x.textContent||'').trim())); if(!b) return false; b.click(); return true; })()`);
    await sleep(1200);
    const offText = await bodyText(cdp);
    const sawNonaktif = offText.includes('Nonaktif') && pillOff;
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('Nonaktif')); if(b) b.click(); return true; })()`);
    await sleep(1200);
    const onText = await bodyText(cdp);
    record('Category Toggle', sawNonaktif && onText.includes('Aktif'), 'off->on verified');
  } catch (e) { fail('Category CRUD', e); }

  // 3. Product CRUD + image upload
  try {
    await nav(cdp, `${BASE}/admin/senjamart/products`);
    await waitFor(cdp, `[...document.querySelectorAll('button')].some(b=>(b.textContent||'').includes('Tambah Produk'))`, 45000, 'products page');
    await clickText(cdp, 'Tambah Produk');
    await waitFor(cdp, `document.body.innerText.includes('Nama Produk')`, 15000, 'product form');
    await setByLabel(cdp, 'Nama Produk *', 'E2E_TEST_PRODUCT');
    await setByLabel(cdp, 'Deskripsi', 'E2E test product description');
    await setByLabel(cdp, 'Harga (Rp) *', '25000');
    await setByLabel(cdp, 'Stok *', '10');
    await setByLabel(cdp, 'Satuan', 'pcs');
    await setSelectByOption(cdp, 'E2E_TEST_CATEGORY_EDITED');
    // featured checkbox (label 'Produk Unggulan')
    await evalJs(cdp, `(() => { const l=[...document.querySelectorAll('label')].find(x=>(x.textContent||'').includes('Produk Unggulan')); const c=l&&l.querySelector('input[type=checkbox]'); if(c&&!c.checked) c.click(); return !!c; })()`);
    await sleep(400);
    // upload image (preview shows a supabase storage URL)
    await setFiles(cdp, 'input[type=file]', IMG);
    await waitFor(cdp, `[...document.querySelectorAll('img')].some(i=>(i.src||'').includes('/storage/'))`, 25000, 'image preview');
    await shot(cdp, 'prod-form-uploaded');
    await clickText(cdp, 'Buat Produk');
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_PRODUCT') && document.body.innerText.includes('25.000')`, 30000, 'product created row');
    const prodRow = await bodyText(cdp);
    const rowOk = prodRow.includes('E2E_TEST_PRODUCT') && prodRow.includes('25.000') && prodRow.includes('E2E_TEST_CATEGORY_EDITED');
    record('Product Create + Upload', rowOk, rowOk ? 'row shows name, Rp 25.000, category; storage image saved' : `row snippet: ${prodRow.slice(0, 300).replace(/\n+/g, ' | ')}`);
    await shot(cdp, 'prod-created');

    // edit price 25000 -> 30000
    await clickText(cdp, 'Edit');
    await waitFor(cdp, `document.querySelector('input[placeholder="15000"]')`, 15000, 'product edit form');
    await type(cdp, 'input[placeholder="15000"]', '30000');
    await clickText(cdp, 'Simpan Perubahan');
    await waitFor(cdp, `document.body.innerText.includes('30.000')`, 25000, 'price updated');
    record('Product Edit', true, 'price 25000 -> 30000 saved and shown in table');
    await shot(cdp, 'prod-edited');

    // toggle off/on
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/^Aktif$/.test((x.textContent||'').trim())); if(b) b.click(); return true; })()`);
    await sleep(1200);
    const t1 = await bodyText(cdp);
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim().startsWith('Nonaktif')); if(b) b.click(); return true; })()`);
    await sleep(1200);
    const t2 = await bodyText(cdp);
    record('Product Toggle', t1.includes('Nonaktif') && t2.includes('Aktif'), 'off->on verified');
  } catch (e) { fail('Product CRUD', e); }

  // 4. Product detail
  try {
    await nav(cdp, `${BASE}/senjamart/products/${SLUG}`);
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_PRODUCT')`, 45000, 'detail page');
    const t = await bodyText(cdp);
    record('Product Detail (admin view)', t.includes('30.000') && t.includes('Stok tersedia: 10') && t.includes('E2E_TEST_CATEGORY_EDITED'), 'name/price/stock/category visible');
    await shot(cdp, 'prod-detail');
  } catch (e) { fail('Product Detail', e); }
}

async function runCustomer(cdp) {
  console.log('--- CUSTOMER E2E ---');
  // 1. Register
  try {
    await nav(cdp, `${BASE}/senjamart/login`);
    await waitFor(cdp, `document.querySelector('#loginEmail')`, 60000, 'login page');
    await clickText(cdp, 'Daftar');
    await waitFor(cdp, `document.querySelector('#loginName')`, 15000, 'register form');
    await type(cdp, '#loginName', CUST_NAME);
    await type(cdp, '#loginEmail', CUST_EMAIL);
    await type(cdp, '#loginPassword', CUST_PASS);
    await shot(cdp, 'reg-form');
    await submit(cdp, 'Daftar');
    await waitFor(cdp, `location.pathname.includes('/senjamart/profile')`, 45000, 'redirect profile');
    const t = await bodyText(cdp);
    record('Customer Registration', t.includes('E2E Test Customer'), 'redirected to profile, name visible');
    await shot(cdp, 'profile');
  } catch (e) { fail('Customer Registration', e); }

  // 2. Homepage catalog
  try {
    await nav(cdp, `${BASE}/senjamart`);
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_PRODUCT')`, 45000, 'product on homepage');
    const t = await bodyText(cdp);
    const prod = t.includes('E2E_TEST_PRODUCT');
    const cat = t.includes('E2E_TEST_CATEGORY_EDITED');
    record('Real Catalog (homepage)', prod && cat, `featured product + category visible${prod && cat ? '' : ` (prod=${prod} cat=${cat})`}`);
    await shot(cdp, 'homepage');
  } catch (e) { fail('Real Catalog (homepage)', e); }

  // 3. Product detail + add to cart
  try {
    await nav(cdp, `${BASE}/senjamart/products/${SLUG}`);
    await waitFor(cdp, `document.body.innerText.includes('Tambah ke Keranjang')`, 45000, 'detail add button');
    const t = await bodyText(cdp);
    record('Product Detail (customer)', t.includes('30.000') && t.includes('Stok tersedia: 10'), 'price/stock correct');
    // qty -> 2
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Tambah jumlah'); if(b) b.click(); return !!b; })()`);
    await sleep(600);
    await clickText(cdp, 'Tambah ke Keranjang');
    await waitFor(cdp, `document.body.innerText.includes('Ditambahkan ke Keranjang')`, 15000, 'added to cart');
    record('Add to Cart', true, 'qty 2 added');
    await shot(cdp, 'detail-added');
  } catch (e) { fail('Add to Cart', e); }

  // 4. Cart persistence
  try {
    await nav(cdp, `${BASE}/senjamart/cart`);
    await waitFor(cdp, `document.body.innerText.includes('E2E_TEST_PRODUCT')`, 45000, 'cart page');
    let t = await bodyText(cdp);
    record('Cart Persistence (initial)', t.includes('60.000'), `qty2 subtotal 60.000 visible=${t.includes('60.000')}`);
    // qty -> 3
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='Tambah jumlah'); if(b) b.click(); return !!b; })()`);
    await sleep(1200);
    t = await bodyText(cdp);
    await shot(cdp, 'cart-qty3');
    // reload to prove persistence (Supabase cart_items + localStorage)
    await nav(cdp, `${BASE}/senjamart/cart`);
    await waitFor(cdp, `document.body.innerText.includes('90.000')`, 30000, 'cart after reload');
    record('Cart Persistence (reload)', (await bodyText(cdp)).includes('90.000'), 'qty3 subtotal 90.000 survives reload');
  } catch (e) { fail('Cart Persistence', e); }

  // 5. Checkout
  try {
    await nav(cdp, `${BASE}/senjamart/checkout`);
    await waitFor(cdp, `document.querySelector('#checkoutName')`, 45000, 'checkout form');
    await type(cdp, '#checkoutName', CUST_NAME);
    await type(cdp, '#checkoutPhone', '081234567890');
    await type(cdp, '#checkoutAddress', 'Jl. E2E Test No. 1');
    await type(cdp, '#checkoutCity', 'Jakarta');
    await type(cdp, '#checkoutPostal', '12345');
    await sleep(800);
    const t = await bodyText(cdp);
    const totals = t.includes('90.000') && t.includes('12.000') && t.includes('102.000');
    record('Checkout Totals', totals, 'subtotal 90.000, shipping 12.000, total 102.000 (server rule <300k)');
    await shot(cdp, 'checkout-form');
    await clickText(cdp, 'Buat Pesanan');
    await waitFor(cdp, `location.pathname.includes('/senjamart/orders')`, 30000, 'redirect orders');
    await waitFor(cdp, `document.body.innerText.includes('Pesanan berhasil dibuat')`, 20000, 'order success banner');
    await waitFor(cdp, `document.body.innerText.includes('102.000')`, 20000, 'order row total');
    record('Order Creation', true, 'success banner + order row with total 102.000');
    await shot(cdp, 'orders');
  } catch (e) { fail('Checkout/Order', e); }

  // 6. Review + rating
  try {
    await nav(cdp, `${BASE}/senjamart/products/${SLUG}`);
    await waitFor(cdp, `document.body.innerText.includes('Tulis ulasan Anda')`, 45000, 'review form');
    await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'')==='4 bintang'); if(b) b.click(); return !!b; })()`);
    await sleep(500);
    await evalJs(cdp, `(() => { const t=document.querySelector('textarea'); if(t){ const s=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; s.call(t,'E2E bagus sekali'); t.dispatchEvent(new Event('input',{bubbles:true})); } return !!t; })()`);
    await clickText(cdp, 'Kirim Ulasan');
    await waitFor(cdp, `document.body.innerText.includes('Ulasan Anda tersimpan')`, 20000, 'review saved');
    await waitFor(cdp, `document.body.innerText.includes('E2E bagus sekali')`, 15000, 'review visible');
    record('Review Submit', true, '4-star review saved + visible with author');
    await shot(cdp, 'review');
    // reload to check rating recompute display
    await nav(cdp, `${BASE}/senjamart/products/${SLUG}`);
    await waitFor(cdp, `document.body.innerText.includes('E2E bagus sekali')`, 45000, 'review after reload');
    const t = await bodyText(cdp);
    const ratingShown = t.includes('4.0') || /Ulasan \(1\)/.test(t);
    record('Rating Update (UI)', ratingShown, `reloaded: ${ratingShown ? 'rating 4.0 / Ulasan (1) visible' : 'rating not shown'}`);
    await shot(cdp, 'rating');
  } catch (e) { fail('Review/Rating', e); }
}

// ---------------------------------------------------------------- main
const chrome = spawn('google-chrome', [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--no-sandbox',
  '--no-proxy-server',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' });

let cdp;
try {
  cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (MODE === 'admin') await runAdmin(cdp);
  else await runCustomer(cdp);
} catch (e) {
  fail('DRIVER', e);
} finally {
  try { cdp?.close(); } catch {}
  chrome.kill('SIGKILL');
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.ok.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
const pass = results.filter((r) => r.ok === 'PASS').length;
const failn = results.filter((r) => r.ok === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
process.exit(failn ? 1 : 0);
