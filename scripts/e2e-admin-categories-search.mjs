#!/usr/bin/env node
/**
 * SENJA MART — ADMIN CATEGORIES SEARCH + CRUD E2E (credential-safe)
 * Run (dev server on :3000): node --env-file=.env.local scripts/e2e-admin-categories-search.mjs
 * Verifies:
 *   1. Search input exists and filters by name in real time
 *   2. No-match query shows "Tidak ditemukan"
 *   3. Clearing the query restores the full list
 *   4. Create / edit / delete category still work after search was added
 * Prints NO credentials.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const BASE = 'http://localhost:3000';
const PORT = 9233;
const PROFILE = '/tmp/chrome-cat-search';
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
const type = async (cdp, sel, val) => { await ev(cdp, `(() => { const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return false; const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(val)}); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`); await sleep(300); };
const clickText = async (cdp, text, tag = 'button,a') => { const ok = await ev(cdp, `(() => { const el=[...document.querySelectorAll('${tag}')].find(e=>(e.textContent||'').trim().includes(${JSON.stringify(text)})); if(!el) return false; el.click(); return true; })()`); if (!ok) throw new Error('no click target: ' + text); await sleep(900); };
// Click a row action (Edit/Hapus) inside the row that contains the category name.
async function clickRowAction(cdp, name, action) {
  const ok = await ev(cdp, `(() => {
    const tr = [...document.querySelectorAll('tbody tr')].find(r => (r.textContent||'').includes(${JSON.stringify(name)}));
    if (!tr) return false;
    const b = [...tr.querySelectorAll('button')].find(x => (x.textContent||'').trim() === ${JSON.stringify(action)});
    if (!b) return false;
    b.click();
    return true;
  })()`);
  if (!ok) throw new Error('no row action: ' + action + ' for ' + name);
  await sleep(900);
}
const submit = async (cdp, label) => { const ok = await ev(cdp, `(() => { const b=[...document.querySelectorAll('button[type=submit]')].find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return false; b.click(); return true; })()`); if (!ok) throw new Error('no submit: ' + label); await sleep(1000); };
const setByLabel = async (cdp, labelText, value) => { const ok = await ev(cdp, `(() => {
  const l=[...document.querySelectorAll('label')].find(x=>(x.textContent||'').trim().includes(${JSON.stringify(labelText)}));
  if(!l) return false;
  const el=l.parentElement.querySelector('input, textarea, select');
  if(!el) return false;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})()`); if (!ok) throw new Error('no field by label: ' + labelText); await sleep(250); };
const shot = async (cdp, n) => { try { const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/cat-search-' + n + '.png', Buffer.from(data, 'base64')); } catch {} };

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

async function categoryNames() {
  const { data } = await admin.from('categories').select('name').order('sort_order');
  return (data || []).map((c) => c.name);
}
async function rowNames(cdp) {
  // category names rendered in the table (name column)
  return ev(cdp, `[...document.querySelectorAll('tbody tr')].map(tr => { const s = tr.querySelector('td span'); return s ? s.textContent.trim() : null; }).filter(Boolean)`);
}

const ts = Date.now();
const testName = `E2E Search Cat ${ts}`;
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

  await cdp.send('Page.navigate', { url: `${BASE}/admin/senjamart/categories` }); await sleep(2500);
  await wait(cdp, `document.querySelector('#adminCategorySearch')`, 45000, 'search input');
  record('Search input present', true, 'id=adminCategorySearch, placeholder="Cari kategori..."');
  await wait(cdp, `document.querySelectorAll('tbody tr').length > 1`, 30000, 'categories loaded');

  const allNames = await categoryNames();
  const allRows = await rowNames(cdp);
  record('Categories loaded from Supabase', allRows.length >= 1 && allRows.length === allNames.length, `rows=${allRows.length} db=${allNames.length}`);

  // ---- 1. filter by name ----
  // Data-driven: search a real category name from the catalog instead of a
  // hardcoded fixture (the curated catalog has no 'Minuman' category).
  const probe = (allNames[0] || 'Makanan Instan').trim();
  const probeFragment = probe.split(/[\s&]+/).filter(Boolean)[0] || probe.slice(0, 6);
  await type(cdp, '#adminCategorySearch', probeFragment);
  await sleep(700);
  let rows = await rowNames(cdp);
  const lowerFragment = probeFragment.toLowerCase();
  const matchRows = rows.filter((r) => r.toLowerCase().includes(lowerFragment));
  const allMatch = rows.every((r) => r.toLowerCase().includes(lowerFragment));
  record(`Search "${probeFragment}" filters by name`, allMatch && matchRows.length === rows.length && rows.length > 0, `shown=${JSON.stringify(rows)}`);
  await shot(cdp, 'search-fragment');

  // ---- 2. no results -> Tidak ditemukan ----
  await type(cdp, '#adminCategorySearch', 'zzzqqqnonexistent');
  await sleep(700);
  const t2 = await txt(cdp);
  const noneVisible = await ev(cdp, `document.querySelectorAll('tbody tr').length === 1 && document.body.innerText.includes('Tidak ditemukan')`);
  record('No-match shows "Tidak ditemukan"', noneVisible, t2.split('\n').find((l) => l.includes('Tidak')) || '');
  await shot(cdp, 'search-notfound');

  // ---- 3. clear -> full list restored ----
  await type(cdp, '#adminCategorySearch', '');
  await sleep(700);
  rows = await rowNames(cdp);
  record('Clearing restores full list', rows.length === allRows.length, `rows=${rows.length} expected=${allRows.length}`);

  // ---- 4. create still works ----
  await clickText(cdp, '+ Tambah Kategori');
  await wait(cdp, `document.body.innerText.includes('Tambah Kategori Baru')`, 15000, 'create form');
  await setByLabel(cdp, 'Nama Kategori', testName);
  await submit(cdp, 'Buat Kategori');
  await wait(cdp, `document.body.innerText.includes('${testName}') && document.body.innerText.includes('dibuat')`, 25000, 'created row');
  const created = await ev(cdp, `document.body.innerText.includes('${testName}')`);
  const inDb = (await categoryNames()).includes(testName);
  record('Create category works', created && inDb, `row visible=${created}; in Supabase=${inDb}`);
  await shot(cdp, 'created');

  // ---- 5. edit still works ----
  await clickRowAction(cdp, testName, 'Edit');
  await wait(cdp, `document.body.innerText.includes('Edit: ${testName}')`, 15000, 'edit form');
  await setByLabel(cdp, 'Nama Kategori', `${testName} EDITED`);
  await submit(cdp, 'Simpan');
  await wait(cdp, `document.body.innerText.includes('${testName} EDITED') && document.body.innerText.includes('diperbarui')`, 25000, 'updated row');
  const edited = (await categoryNames()).includes(`${testName} EDITED`);
  record('Edit category works', edited, `in Supabase: ${testName} EDITED = ${edited}`);
  await shot(cdp, 'edited');

  // ---- 6. delete still works (accept confirm) ----
  cdp.on('Page.javascriptDialogOpening', async () => {
    await cdp.send('Page.handleJavaScriptDialog', { accept: true });
  });
  await clickRowAction(cdp, `${testName} EDITED`, 'Hapus');
  await wait(cdp, `![...document.querySelectorAll('tbody tr')].some(r => r.textContent.includes('${testName} EDITED'))`, 25000, 'row removed');
  await sleep(1200);
  const deleted = !(await categoryNames()).includes(`${testName} EDITED`);
  record('Delete category works', deleted, `still in Supabase = ${!deleted}`);
  await shot(cdp, 'deleted');

  // ---- 7. search + CRUD form still fine with active query ----
  await type(cdp, '#adminCategorySearch', 'Minuman');
  await sleep(600);
  await clickText(cdp, '+ Tambah Kategori');
  await wait(cdp, `document.body.innerText.includes('Tambah Kategori Baru')`, 15000, 'create form (with search)');
  record('Search + open create form works', true, 'form opens while query active');
  await clickText(cdp, 'Batal');
} catch (e) {
  fail('CATEGORIES E2E', e);
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
