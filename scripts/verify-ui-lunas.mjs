#!/usr/bin/env node
/**
 * SENJA MART — UI "LUNAS" VERIFICATION (credential-safe)
 * Logs in as the E2E customer whose order was REALLY paid via the Midtrans
 * sandbox (settlement -> orders.payment_status=paid) and verifies the
 * /senjamart/orders page shows the "✓ Lunas" badge from Supabase data.
 * Run: node --env-file=.env.local scripts/verify-ui-lunas.mjs
 */
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:3000';
const PORT = 9232;
const PROFILE = '/tmp/chrome-lunas';
const PASS = 'SenjaMart-E2E-2026!x';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const ev = async (cdp, e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; };
const txt = async (cdp) => (await ev(cdp, 'document.body ? document.body.innerText : ""')) || '';
const type = async (cdp, sel, val) => { await ev(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(200); };

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// Find the most recent E2E test customer with a REAL paid order
const { data: profs } = await admin.from('profiles').select('id, full_name, created_at').ilike('full_name', 'Midtrans E2E%').order('created_at', { ascending: false }).limit(5);
let target = null;
for (const p of profs ?? []) {
  const { data: ords } = await admin.from('orders').select('id, payment_status').eq('user_id', p.id);
  const paidOrder = (ords || []).find((o) => o.payment_status === 'paid');
  if (paidOrder) { target = { ...p, orderId: paidOrder.id, pay: paidOrder.payment_status }; break; }
}
if (!target) { console.log('SKIP: no E2E customer with a really-paid order found'); process.exit(0); }
const tsFromName = (target.full_name.match(/(\d{10,})/) || [])[1];
const emailPart = / VA$/.test(target.full_name) ? 'e2e-mid-va' : / RT$/.test(target.full_name) ? 'e2e-mid-rt' : 'e2e-mid';
const email = `${emailPart}-${tsFromName}@senjamart.test`;
console.log(`Order ${target.orderId.slice(0, 8)} pay=${target.pay} (real sandbox settlement) | user: ${target.full_name} | email: ${email}`);

const chrome = spawn('google-chrome', [`--remote-debugging-port=${PORT}`, '--headless=new', '--no-sandbox', '--no-proxy-server', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', `--user-data-dir=${PROFILE}`, 'about:blank'], { stdio: 'ignore' });
let cdp;
let ok = false;
try {
  cdp = await connect();
  await cdp.send('Page.navigate', { url: `${BASE}/senjamart/login` }); await sleep(2500);
  await type(cdp, '#loginEmail', email);
  await type(cdp, '#loginPassword', PASS);
  await ev(cdp, `(() => { const b=[...document.querySelectorAll('button[type=submit]')].find(x=>(x.textContent||'').trim()==='Masuk'); if(b) b.click(); return !!b; })()`);
  await sleep(4000);
  console.log('after login pathname:', await ev(cdp, 'location.pathname'));
  await cdp.send('Page.navigate', { url: `${BASE}/senjamart/orders` }); await sleep(3500);
  const t = await txt(cdp);
  const sawLunas = t.includes('✓ Lunas');
  const snippet = t.split('\n').filter((l) => /Lunas|Belum|Pesanan|Menunggu|Gagal|Kedaluwarsa/.test(l)).join(' | ');
  console.log('orders page shows Lunas badge:', sawLunas);
  console.log('snippet:', snippet.slice(0, 400));
  ok = sawLunas;
} catch (e) {
  console.log('ERROR:', e.message);
  try { console.log('text:', ((await txt(cdp)).slice(0, 300)).replace(/\n+/g, ' | ')); } catch {}
} finally {
  try { cdp?.close(); } catch {}
  chrome.kill('SIGKILL');
}
console.log(ok ? 'UI CHECK PASS' : 'UI CHECK FAIL');
process.exit(ok ? 0 : 1);
