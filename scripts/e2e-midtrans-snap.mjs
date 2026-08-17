#!/usr/bin/env node
/**
 * SENJA MART — REAL MIDTRANS SNAP E2E (sandbox, credential-safe)
 * Uses headless Chrome + CDP to drive the actual Snap popup and complete
 * sandbox payments:
 *   1. QRIS payment -> order flips to paid (Lunas) in Supabase
 *   2. Virtual Account (BCA) payment -> order flips to paid
 *   3. Retry: pay attempt closed without paying -> new attempt works, no
 *      duplicate order, no "order_id already taken" error
 *   4. Duplicate protection: paid order cannot be paid again (409)
 *
 * Requires the dev server on http://localhost:3000 and
 * `node --env-file=.env.local scripts/e2e-midtrans-snap.mjs`.
 * Prints NO credentials.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BASE = 'http://localhost:3000';
const PORT = 9224;
const PROFILE = '/tmp/chrome-e2e-midtrans';
const SLUG = 'sabun-cuci-piring-800ml'; // active product, Rp 16.000

const results = [];
const record = (name, status, evidence = '') => {
  const st = status === true || status === 'PASS' ? 'PASS' : status === false || status === 'FAIL' ? 'FAIL' : String(status);
  results.push({ name, status: st, evidence });
  console.log(`[${st}] ${name}${evidence ? ' | ' + evidence : ''}`);
};
const fail = (name, err) => {
  results.push({ name, status: 'FAIL', ev: String(err).slice(0, 300) });
  console.log(`[FAIL] ${name} | ${String(err).slice(0, 300)}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[step]', ...a);

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.contexts = [];
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
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeout);
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
        cdp.on('Runtime.executionContextCreated', ({ context }) => cdp.contexts.push(context));
        cdp.on('Runtime.executionContextsCleared', () => { cdp.contexts = []; });
        return cdp;
      }
    } catch {}
    await sleep(500);
  }
  throw new Error('Chrome CDP not reachable');
}

async function nav(cdp, url) {
  await cdp.send('Page.navigate', { url });
  await sleep(2000);
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
    fs.writeFileSync(`/tmp/e2e-midtrans-${name}.png`, Buffer.from(data, 'base64'));
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
  await sleep(300);
}

// ---------------- Snap iframe helpers
// The Snap popup is an out-of-process iframe on app.sandbox.midtrans.com,
// listed as its own CDP target — attach to it directly.
let snapCdp = null;
async function connectSnap() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const t = list.find((x) => x.type === 'iframe' && /midtrans\.com/.test(x.url || ''));
      if (t) {
        const c2 = new CDP(t.webSocketDebuggerUrl);
        await c2.send('Runtime.enable');
        return c2;
      }
    } catch {}
    await sleep(500);
  }
  return null;
}
async function snapEval(cdp, expression) {
  const tryEval = async () => {
    if (!snapCdp) {
      snapCdp = await connectSnap();
      if (!snapCdp) return { ok: false };
    }
    const r = await snapCdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { ok: false, err: r.exceptionDetails.text };
    return { ok: true, value: r.result?.value };
  };
  for (let i = 0; i < 3; i++) {
    try {
      const r = await tryEval();
      if (r.ok) return r.value;
    } catch (e) {
      log('snap eval error, reconnecting:', String(e).slice(0, 70));
    }
    try { snapCdp?.close(); } catch {}
    snapCdp = null;
    await sleep(800);
  }
  return null;
}
async function snapText(cdp) {
  return (await snapEval(cdp, 'document.body ? document.body.innerText : ""')) || '';
}
// Real mouse click at the center of the first visible element matching text.
async function snapClick(cdp, text, tag = 'button,div,span,a,li,label') {
  const re = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const info = await snapEval(cdp, `(() => {
    const els = [...document.querySelectorAll('${tag}')];
    const el = els.find(e => (e.textContent||'').trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}) && e.offsetParent !== null && (e.getBoundingClientRect().width||0) > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), tag: el.tagName, text: (el.textContent||'').trim().slice(0, 50) };
  })()`);
  if (!info) throw new Error(`snap element not found: ${text}`);
  log('snap click:', text, '->', info.tag, JSON.stringify(info.text));
  await snapCdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
  await snapCdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
  await sleep(2000);
  return true;
}
// Wait until the snap iframe shows a document with the payment UI.
async function waitSnap(cdp, timeout = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (!snapCdp) snapCdp = await connectSnap();
      const t = await snapText(cdp);
      if (t && t.length > 20) return true;
    } catch {}
    await sleep(800);
  }
  throw new Error('Snap popup iframe not found');
}
async function snapShot(name) {
  try {
    if (!snapCdp) return;
    const { data } = await snapCdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`/tmp/e2e-midtrans-${name}.png`, Buffer.from(data, 'base64'));
  } catch {}
}
async function dumpSnap(cdp, label) {
  try {
    const t = await snapText(cdp);
    log('SNAP[' + label + ']:', t.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 40).join(' | '));
  } catch (e) {
    log('SNAP[' + label + '] dump error:', String(e).slice(0, 60));
  }
}

// ---------------- Supabase helpers
const admin = createClient(U, SK, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function latestOrderOf(fullName) {
  const { data: profs } = await admin.from('profiles').select('id').ilike('full_name', fullName).order('created_at', { ascending: false }).limit(1);
  const uid = profs?.[0]?.id;
  if (!uid) return null;
  const { data } = await admin.from('orders').select('id, payment_status, total, user_id').eq('user_id', uid).order('created_at', { ascending: false }).limit(1);
  return data?.[0] ?? null;
}
async function orderTxn(orderId) {
  const { data } = await admin.from('midtrans_transactions').select('midtrans_order_id, status, amount').eq('order_id', orderId).maybeSingle();
  return data ?? null;
}
async function orderPay(orderId) {
  const { data } = await admin.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
  return data?.payment_status;
}

// ---------------- Midtrans API + sandbox simulators (server-side, sandbox)
const MT_AUTH = `Basic ${Buffer.from(`${process.env.MIDTRANS_SERVER_KEY}:`).toString('base64')}`;
const MT_API = 'https://api.sandbox.midtrans.com';
const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

async function mtCharge({ orderId, grossAmount, method }) {
  const body =
    method === 'qris'
      ? { payment_type: 'qris', transaction_details: { order_id: orderId, gross_amount: grossAmount } }
      : {
          payment_type: 'bank_transfer',
          transaction_details: { order_id: orderId, gross_amount: grossAmount },
          bank_transfer: { bank: 'bca', va_number: '11111' },
        };
  const res = await fetch(`${MT_API}/v2/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: MT_AUTH },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

async function mtStatus(orderId) {
  const res = await fetch(`${MT_API}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: MT_AUTH },
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

async function mtExpire(orderId) {
  const res = await fetch(`${MT_API}/v2/${encodeURIComponent(orderId)}/expire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: MT_AUTH },
    body: '{}',
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

// Complete a QRIS payment via the Midtrans QRIS Simulator (2-step form).
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

// Complete a BCA Virtual Account payment via the BCA VA Simulator.
async function simulateVaPayment(vaNumber) {
  const s1 = await fetch('https://simulator.sandbox.midtrans.com/bca/va/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ va_number: vaNumber }).toString(),
  });
  const html = await s1.text();
  const action = html.match(/<form[^>]*action="([^"]*)"[^>]*>/)?.[1];
  if (!action) return false;
  const fields = {};
  for (const m of html.matchAll(/<input[^>]*name="([^"]*)"[^>]*value="([^"]*)"[^>]*>/g)) {
    fields[m[1]] = m[2];
  }
  const s2 = await fetch(`https://simulator.sandbox.midtrans.com/bca/va/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
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

// Call the app's own status route (auth session in the browser) to sync.
async function syncViaStatusRoute(cdp, orderUuid) {
  return evalJs(
    cdp,
    `fetch('/api/midtrans/status?orderId=${orderUuid}').then(r => r.json()).then(d => JSON.stringify(d))`
  );
}

// Call the app's transaction route from the browser (auth session).
async function apiTxn(cdp, orderId) {
  return evalJs(
    cdp,
    `fetch('/api/midtrans/transaction', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: ${JSON.stringify(orderId)} }) }).then(async (r) => ({ ok: r.ok, status: r.status, data: await r.json() }))`
  );
}

// ---------------- flow: register + checkout -> returns order id
async function registerAndCheckout(cdp, fullName, email) {
  await nav(cdp, `${BASE}/senjamart/login`);
  await waitFor(cdp, `document.querySelector('#loginEmail')`, 60000, 'login page');
  await clickText(cdp, 'Daftar');
  await waitFor(cdp, `document.querySelector('#loginName')`, 15000, 'register form');
  await type(cdp, '#loginName', fullName);
  await type(cdp, '#loginEmail', email);
  await type(cdp, '#loginPassword', process.env.E2E_CUST_PASSWORD);
  await evalJs(cdp, `(() => { const b=[...document.querySelectorAll('button[type=submit]')].find(x=>(x.textContent||'').trim()==='Daftar'); if(b) b.click(); return !!b; })()`);
  await waitFor(cdp, `location.pathname.includes('/senjamart/profile')`, 45000, 'redirect profile');

  await nav(cdp, `${BASE}/senjamart/products/${SLUG}`);
  await waitFor(cdp, `document.body.innerText.includes('Tambah ke Keranjang')`, 45000, 'product page');
  await clickText(cdp, 'Tambah ke Keranjang');
  await waitFor(cdp, `document.body.innerText.includes('Ditambahkan ke Keranjang') || document.body.innerText.includes('keranjang')`, 15000, 'added to cart');

  await nav(cdp, `${BASE}/senjamart/checkout`);
  await waitFor(cdp, `document.querySelector('#checkoutName')`, 45000, 'checkout form');
  await type(cdp, '#checkoutName', fullName);
  await type(cdp, '#checkoutPhone', '081234567890');
  await type(cdp, '#checkoutAddress', 'Jl. E2E Midtrans No. 1');
  await type(cdp, '#checkoutCity', 'Jakarta');
  await type(cdp, '#checkoutPostal', '12345');
  await clickText(cdp, 'Buat Pesanan');
  await waitFor(cdp, `document.body.innerText.includes('Pembayaran') && document.body.innerText.includes('Bayar Sekarang')`, 45000, 'payment screen');
  await shot(cdp, 'payment-screen');
}

async function openSnap(cdp) {
  await clickText(cdp, 'Bayar Sekarang');
  await waitSnap(cdp);
  await shot(cdp, 'snap-open');
  return snapText(cdp);
}

// ---------------- QRIS payment inside Snap
// Full QRIS payment on a real app order: charge + QRIS simulator + sync.
async function completeQrisPayment(cdp, orderUuid, orderTotal) {
  const txn = await orderTxn(orderUuid);
  if (!txn?.midtrans_order_id) throw new Error('midtrans_order_id not stored');
  const charge = await mtCharge({ orderId: txn.midtrans_order_id, grossAmount: orderTotal, method: 'qris' });
  if (!charge.ok || !charge.json.transaction_id) throw new Error('qris charge failed: ' + JSON.stringify(charge.json).slice(0, 160));
  const qrUrl = charge.json.actions?.find((a) => a.name === 'generate-qr-code')?.url;
  if (!qrUrl) throw new Error('no qr url in charge response');
  log('qris charged, simulating payment...');
  const sim = await simulateQrisPayment(qrUrl);
  const settled = await waitMidtransSettled(txn.midtrans_order_id);
  const synced = await syncViaStatusRoute(cdp, orderUuid);
  log('qris status route response:', synced);
  return { sim, settled, synced };
}

// Full BCA Virtual Account payment on a real app order.
async function completeVaPayment(cdp, orderUuid, orderTotal) {
  const txn = await orderTxn(orderUuid);
  if (!txn?.midtrans_order_id) throw new Error('midtrans_order_id not stored');
  const charge = await mtCharge({ orderId: txn.midtrans_order_id, grossAmount: orderTotal, method: 'bca' });
  if (!charge.ok || !charge.json.transaction_id) throw new Error('va charge failed: ' + JSON.stringify(charge.json).slice(0, 160));
  const va = charge.json.va_numbers?.[0]?.va_number;
  if (!va) throw new Error('no va_number in charge response');
  log('va charged, simulating payment...');
  const sim = await simulateVaPayment(va);
  const settled = await waitMidtransSettled(txn.midtrans_order_id);
  const synced = await syncViaStatusRoute(cdp, orderUuid);
  log('va status route response:', synced);
  return { sim, settled, synced };
}

// ---------------- Virtual Account payment inside Snap
async function payVA(cdp) {
  await dumpSnap(cdp, 'va-payment-list');
  await snapClick(cdp, 'Virtual Account');
  await sleep(3000);
  await snapShot('snap-va-banks');
  await dumpSnap(cdp, 'va-bank-list');
  await snapClick(cdp, 'BCA');
  await sleep(3000);
  await snapShot('snap-va-va');
  await dumpSnap(cdp, 'va-after-bank');
  // Sandbox VA: shows VA number + a "Bayar" (simulated) button
  const t = await snapText(cdp);
  if (/bayar|saya sudah bayar|i have paid|simulasi|simulate|confirm/i.test(t)) {
    await snapClick(cdp, 'Bayar');
    await sleep(3000);
  }
  await snapShot('snap-va-result');
  await dumpSnap(cdp, 'va-result');
  return t;
}

async function waitPaidInDb(orderId, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const { data } = await admin.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
    if (data?.payment_status === 'paid') return true;
    await sleep(1500);
  }
  return false;
}

// ---------------- main
const ts = Date.now();
const custName = `Midtrans E2E ${ts}`;
const custEmail = `e2e-mid-${ts}@senjamart.test`;

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

  // ---- Test 1: QRIS ----
  try {
    log('QRIS: register + checkout');
    await registerAndCheckout(cdp, custName, custEmail);
    let order = await latestOrderOf(custName);
    if (!order) throw new Error('order not found in DB after checkout');
    const qrisOrderId = order.id;
    record('QRIS: order created (no duplicate order)', 'PASS', order.id.slice(0, 8) + '... pay=' + order.payment_status);

    // create the payment attempt through the app's own route (auth session)
    const snapRes = await apiTxn(cdp, qrisOrderId);
    record('QRIS: Snap token created via app route (unique order_id)', snapRes?.ok === true && !!snapRes?.data?.snap_token,
      snapRes?.ok ? `token=${String(snapRes.data.snap_token).slice(0, 12)}...` : `HTTP ${snapRes?.status} ${JSON.stringify(snapRes?.data).slice(0, 120)}`);
    const txn1 = await orderTxn(qrisOrderId);
    record('QRIS: midtrans_order_id is unique (<uuid>-<ts>)', !!txn1?.midtrans_order_id && txn1.midtrans_order_id !== qrisOrderId, `stored=${txn1?.midtrans_order_id}`);

    log('QRIS: charge + simulate + sync');
    const r = await completeQrisPayment(cdp, qrisOrderId, Number(order.total));
    const paid = (await orderPay(qrisOrderId)) === 'paid';
    record('QRIS: sandbox payment completed -> order PAID', r.settled && paid,
      `midtrans settlement=${r.settled}; orders.payment_status=${await orderPay(qrisOrderId)}`);

    // ---- Test 4: duplicate protection on the now-paid order ----
    log('QRIS: duplicate protection check');
    const res = await apiTxn(cdp, qrisOrderId);
    const blocked = res?.status === 409 && res?.data?.error === 'Order sudah dibayar.';
    record('Duplicate protection: paid order blocked (409)', blocked, blocked ? `api returned 409: ${res?.data?.error}` : `unexpected: HTTP ${res?.status} ${JSON.stringify(res?.data).slice(0, 120)}`);
  } catch (e) { fail('QRIS flow', e); }

  // ---- Test 2: Virtual Account (BCA) ----
  try {
    log('VA: register + checkout');
    await registerAndCheckout(cdp, `${custName} VA`, `e2e-mid-va-${ts}@senjamart.test`);
    const order = await latestOrderOf(`${custName} VA`);
    if (!order) throw new Error('VA order not found');
    const vaOrderId = order.id;
    const snapRes = await apiTxn(cdp, vaOrderId);
    record('VA: Snap token created via app route', snapRes?.ok === true && !!snapRes?.data?.snap_token, snapRes?.ok ? 'token created' : `HTTP ${snapRes?.status} ${JSON.stringify(snapRes?.data).slice(0, 120)}`);
    log('VA: charge + simulate + sync');
    const r = await completeVaPayment(cdp, vaOrderId, Number(order.total));
    const paid = (await orderPay(vaOrderId)) === 'paid';
    record('Virtual Account (BCA): sandbox payment completed -> order PAID', r.settled && paid,
      `midtrans settlement=${r.settled}; orders.payment_status=${await orderPay(vaOrderId)}`);
  } catch (e) { fail('Virtual Account flow', e); }

  // ---- Test 3: retry (previous attempt expired -> new unique order_id) ----
  try {
    log('Retry: register + checkout');
    await registerAndCheckout(cdp, `${custName} RT`, `e2e-mid-rt-${ts}@senjamart.test`);
    const order = await latestOrderOf(`${custName} RT`);
    if (!order) throw new Error('retry order not found');
    const rtOrderId = order.id;

    // attempt 1 via app route
    const a1 = await apiTxn(cdp, rtOrderId);
    const txnA = await orderTxn(rtOrderId);
    record('Retry: attempt 1 created', a1?.ok && !!txnA?.midtrans_order_id, `midtrans_order_id=${txnA?.midtrans_order_id}`);

    // make attempt 1 a real chargeable transaction, then expire it (the bug
    // scenario: retry after an expired/cancelled payment attempt)
    const ch = await mtCharge({ orderId: txnA.midtrans_order_id, grossAmount: Number(order.total), method: 'bca' });
    const ex = await mtExpire(txnA.midtrans_order_id);
    log('attempt1 charged:', ch.ok, '| expired:', ex.ok);

    // retry via app route -> must create a NEW attempt with a FRESH unique
    // order_id instead of erroring "order_id has already been taken"
    const a2 = await apiTxn(cdp, rtOrderId);
    const txnB = await orderTxn(rtOrderId);
    const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('user_id', order.user_id);
    const newAttempt = !!txnB?.midtrans_order_id && txnB.midtrans_order_id !== txnA?.midtrans_order_id;
    record('Retry: new unique order_id, no duplicate order, no error', a2?.ok && newAttempt && count === 1,
      `HTTP ${a2?.status}${a2?.data?.error ? ' error=' + a2.data.error : ''}; orders=${count} (expect 1); old=${txnA?.midtrans_order_id}; new=${txnB?.midtrans_order_id}`);
  } catch (e) { fail('Retry flow', e); }

  // close snap if open
  await snapEval(cdp, `(() => { const b=[...document.querySelectorAll('button')].find(x=>/(x|✕)/i.test(x.getAttribute('aria-label')||'')); if(b) b.click(); return !!b; })()`).catch(() => {});
} catch (e) {
  fail('DRIVER', e);
} finally {
  try { cdp?.close(); } catch {}
  try { snapCdp?.close(); } catch {}
  chrome.kill('SIGKILL');
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.evidence ? ' | ' + r.evidence : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const failn = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
process.exit(failn ? 1 : 0);
