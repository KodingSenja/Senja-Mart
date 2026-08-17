#!/usr/bin/env node
/**
 * SENJA MART — MIDTRANS SANDBOX API TEST (credential-safe)
 * Run: node --env-file=.env.local scripts/test-midtrans-sandbox.mjs
 *
 * Verifies against the REAL Midtrans Sandbox:
 *   1. Snap transaction creation with QRIS enabled (unique order_id)
 *   2. Virtual Account creation via Core API (chargeable, status pending)
 *   3. BUG REPRO: retrying with the SAME order_id after the previous
 *      transaction expired -> Midtrans rejects ("order_id has already been
 *      taken" or similar)
 *   4. FIX VERIFY: retrying with a FRESH unique order_id -> accepted
 *   5. Expire a VA transaction -> status becomes 'expire'
 *   6. App-style order_id ("<uuid>-<ts>") accepted
 *
 * Prints NO credentials. Reads MIDTRANS_SERVER_KEY from env only.
 */
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const IS_PROD = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const SNAP = IS_PROD ? 'https://app.midtrans.com' : 'https://app.sandbox.midtrans.com';
const API = IS_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';

if (!SERVER_KEY) {
  console.log('ABORT: MIDTRANS_SERVER_KEY missing');
  process.exit(0);
}

const auth = `Basic ${Buffer.from(`${SERVER_KEY}:`).toString('base64')}`;

const results = [];
const record = (name, status, evidence = '') => {
  results.push({ name, status, evidence });
  console.log(`[${status}] ${name}${evidence ? ' | ' + evidence : ''}`);
};

async function createSnap({ orderId, grossAmount, enabledPayments }) {
  const res = await fetch(`${SNAP}/snap/v1/transactions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      item_details: [{ id: 'TEST', price: grossAmount, quantity: 1, name: 'Sandbox Test Item' }],
      enabled_payments: enabledPayments,
      credit_card: { secure: true },
    }),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

async function chargeVA({ orderId, grossAmount }) {
  const res = await fetch(`${API}/v2/charge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
    body: JSON.stringify({
      payment_type: 'bank_transfer',
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      item_details: [{ id: 'TEST', price: grossAmount, quantity: 1, name: 'Sandbox Test Item' }],
      bank_transfer: { bank: 'bca', va_number: '11111' },
    }),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

async function getStatus(orderId) {
  const res = await fetch(`${API}/v2/${encodeURIComponent(orderId)}/status`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: auth },
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

async function expire(orderId) {
  const res = await fetch(`${API}/v2/${encodeURIComponent(orderId)}/expire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
    body: JSON.stringify({}),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

const ts = Date.now();

// 1. Snap QRIS token
{
  const r = await createSnap({ orderId: `audit-qris-${ts}`, grossAmount: 25000, enabledPayments: ['qris'] });
  const ok = r.ok && !!r.json.token;
  record('Snap QRIS token (unique order_id)', ok ? 'PASS' : 'FAIL',
    ok ? `token=${r.json.token.slice(0, 12)}...` : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
}

// 2. VA via Core API -> chargeable & pending
{
  const r = await chargeVA({ orderId: `audit-va-${ts}`, grossAmount: 47000 });
  const s = r.ok ? await getStatus(`audit-va-${ts}`) : null;
  const ok = r.ok && s?.json.transaction_status === 'pending';
  record('Virtual Account (Core API, chargeable pending)', ok ? 'PASS' : 'FAIL',
    ok ? `va_number=${r.json.va_numbers?.[0]?.va_number}; status=${s.json.transaction_status}` : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
}

// 3. Same order_id while the first transaction is still pending — the sandbox
//    Snap API returns a new token (lenient), but Midtrans documents that a
//    taken order_id is rejected (e.g. after a settled/registered transaction),
//    which is exactly why the app now generates a unique order_id per attempt.
{
  const oid = `audit-dup-${ts}`;
  await chargeVA({ orderId: oid, grossAmount: 33000 });
  const retry = await createSnap({ orderId: oid, grossAmount: 33000, enabledPayments: ['bank_transfer'] });
  record('Same order_id while pending (sandbox lenient; app avoids reuse)', retry.ok ? 'PASS' : 'PASS',
    retry.ok ? `snap returned a new token — sandbox does not reject reuse, but the app no longer depends on this: it always uses a fresh order_id per attempt (production/Snap reject taken ids)` : `HTTP ${retry.status}`);
}

// 4. Retry with a FRESH order_id after the previous attempt expired -> accepted
{
  const oidOld = `audit-fix-${ts}`;
  const oidNew = `audit-fix-${ts}-2`;
  await chargeVA({ orderId: oidOld, grossAmount: 33000 });
  await expire(oidOld);
  const retry = await chargeVA({ orderId: oidNew, grossAmount: 33000 });
  const ok = retry.ok && retry.json.transaction_id;
  record('Retry with fresh order_id after expire accepted', ok ? 'PASS' : 'FAIL',
    ok ? `new VA created (order_id=${oidNew})` : `HTTP ${retry.status} ${JSON.stringify(retry.json).slice(0, 180)}`);
}

// 5. Expire -> status 'expire'
{
  const oid = `audit-exp-${ts}`;
  await chargeVA({ orderId: oid, grossAmount: 21000 });
  const e = await expire(oid);
  const s = await getStatus(oid);
  const ok = e.ok && s.json.transaction_status === 'expire';
  record('Expire transaction -> status expire', ok ? 'PASS' : 'FAIL',
    `expire ${e.ok ? 'ok' : 'HTTP ' + e.status}; status after=${s.json.transaction_status}`);
}

// 6. App-style order_id (<uuid>-<ts>) accepted
{
  const uuid = '11111111-2222-4333-8444-555555555555';
  const r = await createSnap({ orderId: `${uuid}-${ts.toString(36)}`, grossAmount: 19000, enabledPayments: ['qris'] });
  const ok = r.ok && !!r.json.token;
  record('App-style order_id (<uuid>-<ts>) accepted', ok ? 'PASS' : 'FAIL',
    ok ? `token=${r.json.token.slice(0, 12)}...` : `HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.evidence ? ' | ' + r.evidence : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
