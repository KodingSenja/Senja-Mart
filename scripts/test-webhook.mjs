#!/usr/bin/env node
/**
 * SENJA MART — MIDTRANS NOTIFICATION WEBHOOK TEST (credential-safe)
 * Run (dev server on :3000): node --env-file=.env.local scripts/test-webhook.mjs
 *
 * POSTs signed Midtrans HTTP notifications to /api/midtrans/notification and
 * verifies orders.payment_status mapping:
 *   settlement -> paid, pending -> pending, expire -> expired,
 *   cancel/deny -> failed
 * plus signature validation, amount-mismatch rejection, unknown order, and
 * the stale-attempt guard. Uses throwaway test rows created via the service
 * role (cleaned up at the end). Prints NO credentials.
 */
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const U = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const WEBHOOK = 'http://localhost:3000/api/midtrans/notification';

const results = [];
const record = (name, status, evidence = '') => {
  const st = status === true || status === 'PASS' ? 'PASS' : status === false || status === 'FAIL' ? 'FAIL' : String(status);
  results.push({ name, status: st, evidence });
  console.log(`[${st}] ${name}${evidence ? ' | ' + evidence : ''}`);
};

const admin = createClient(U, SK, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

const sign = (orderId, statusCode, gross, key = SERVER_KEY) =>
  createHash('sha512').update(`${orderId}${statusCode}${gross}${key}`).digest('hex');

async function notify(payload) {
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, json: { status: 'network-error: ' + String(e).slice(0, 60) } };
  }
}

// ---- fixture: order + txn row ----
async function makeFixture() {
  const { data: order, error } = await admin
    .from('orders')
    .insert({
      user_id: null,
      status: 'pending',
      payment_status: 'unpaid',
      subtotal: 50000,
      shipping_cost: 0,
      total: 50000,
      shipping_address: { name: 'Webhook Test', city: 'Jakarta' },
    })
    .select('id')
    .single();
  if (error) throw new Error('fixture order: ' + error.message);
  const { error: e2 } = await admin.from('midtrans_transactions').insert({
    order_id: order.id,
    midtrans_order_id: `webhook-test-${Date.now()}`,
    status: 'pending',
    amount: 50000,
  });
  if (e2) throw new Error('fixture txn: ' + e2.message);
  return order.id;
}
async function getPay(orderId) {
  const { data } = await admin.from('orders').select('payment_status').eq('id', orderId).maybeSingle();
  return data?.payment_status;
}
async function cleanup(orderId) {
  await admin.from('orders').delete().eq('id', orderId);
}

// ---- 1. signature validation ----
{
  const oid = await makeFixture();
  const txn = (await admin.from('midtrans_transactions').select('midtrans_order_id').eq('order_id', oid).single()).data;
  const mid = txn.midtrans_order_id;
  // bad signature
  const bad = await notify({ order_id: mid, status_code: '200', gross_amount: '50000.00', transaction_status: 'settlement', signature_key: '0'.repeat(128) });
  record('Invalid signature rejected (403)', bad.status === 403, `HTTP ${bad.status} ${JSON.stringify(bad.json)}`);
  // missing signature
  const miss = await notify({ order_id: mid, status_code: '200', gross_amount: '50000.00', transaction_status: 'settlement' });
  record('Missing signature rejected (403)', miss.status === 403, `HTTP ${miss.status}`);
  await cleanup(oid);
}

// ---- 2. status mapping ----
const CASES = [
  { status: 'settlement', statusCode: '200', expect: 'paid' },
  { status: 'pending', statusCode: '201', expect: 'pending' },
  { status: 'expire', statusCode: '407', expect: 'expired' },
  { status: 'cancel', statusCode: '202', expect: 'failed' },
  { status: 'deny', statusCode: '202', expect: 'failed' },
];
for (const c of CASES) {
  const oid = await makeFixture();
  const txn = (await admin.from('midtrans_transactions').select('midtrans_order_id').eq('order_id', oid).single()).data;
  const mid = txn.midtrans_order_id;
  const payload = {
    order_id: mid,
    status_code: c.statusCode,
    gross_amount: '50000.00',
    transaction_status: c.status,
    transaction_id: `txn-${c.status}-${Date.now()}`,
    payment_type: 'bank_transfer',
    signature_key: sign(mid, c.statusCode, '50000.00'),
  };
  const r = await notify(payload);
  const after = await getPay(oid);
  record(`Webhook ${c.status} -> ${c.expect}`, r.status === 200 && after === c.expect, `HTTP ${r.status} (${r.json?.status}); orders.payment_status=${after}`);
  await cleanup(oid);
}

// ---- 3. amount mismatch rejected ----
{
  const oid = await makeFixture();
  const txn = (await admin.from('midtrans_transactions').select('midtrans_order_id').eq('order_id', oid).single()).data;
  const mid = txn.midtrans_order_id;
  const payload = {
    order_id: mid,
    status_code: '200',
    gross_amount: '99999.00',
    transaction_status: 'settlement',
    signature_key: sign(mid, '200', '99999.00'),
  };
  const r = await notify(payload);
  const after = await getPay(oid);
  record('Amount mismatch rejected (400, no status change)', r.status === 400 && after === 'unpaid', `HTTP ${r.status} (${r.json?.status}); orders.payment_status=${after}`);
  await cleanup(oid);
}

// ---- 4. unknown order -> 404 ----
{
  const unknown = `unknown-${Date.now()}`;
  const payload = {
    order_id: unknown,
    status_code: '200',
    gross_amount: '10000.00',
    transaction_status: 'settlement',
    signature_key: sign(unknown, '200', '10000.00'),
  };
  const r = await notify(payload);
  record('Unknown order_id -> 404', r.status === 404, `HTTP ${r.status} (${r.json?.status})`);
}

// ---- 5. stale attempt guard ----
{
  const oid = await makeFixture();
  // row currently points at attempt "A"
  await admin.from('midtrans_transactions').update({ midtrans_order_id: `stale-A-${Date.now()}` }).eq('order_id', oid);
  const txn = (await admin.from('midtrans_transactions').select('midtrans_order_id').eq('order_id', oid).single()).data;
  // notification arrives for OLD attempt "B" (different) with the same uuid prefix
  const uuid = oid;
  const oldMid = `${uuid}-zzzz`;
  const payload = {
    order_id: oldMid,
    status_code: '200',
    gross_amount: '50000.00',
    transaction_status: 'settlement',
    signature_key: sign(oldMid, '200', '50000.00'),
  };
  const r = await notify(payload);
  const after = await getPay(oid);
  const rowAfter = (await admin.from('midtrans_transactions').select('status, midtrans_order_id').eq('order_id', oid).single()).data;
  record('Stale attempt acknowledged without status change', r.status === 200 && after === 'unpaid' && rowAfter.status === 'pending',
    `HTTP ${r.status} (${r.json?.status}); pay=${after}; txn status=${rowAfter.status}`);
  await cleanup(oid);
}

console.log('\n--- SUMMARY ---');
for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.evidence ? ' | ' + r.evidence : ''}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
console.log(`TOTAL: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
