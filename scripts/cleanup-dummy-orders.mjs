#!/usr/bin/env node
/**
 * TEMPORARY CLEANUP SCRIPT — deletes ONLY the identified dummy/test orders
 * created during AI testing (orders whose user is a known test account:
 * IT a/b/c, E2E Test Customer, E2E Security Probe, HD customer,
 * midtrans-e2e, Name Fix Test, Register Audit Test).
 *
 * Safety:
 *   * every order is verified to belong to a known test user before delete
 *   * the real store account (winda widodo) and admin account orders are
 *     NEVER touched
 *   * order_items + midtrans_transactions are removed via ON DELETE CASCADE
 *
 * A full backup was taken first via scripts/backup-orders.mjs
 * (scripts/backups/orders-backup-*.json).
 *
 * Run: node --env-file=.env.local scripts/cleanup-dummy-orders.mjs
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPA_URL || !SERVICE_KEY) {
  console.log('ABORT: Supabase env not configured');
  process.exit(0);
}

const admin = createClient(SUPA_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Known test accounts created by the AI test tooling (from profiles audit).
const TEST_USER_IDS = new Set([
  '20c05e3f-7958-40b7-81c3-2e086e4ac2a4', // IT b
  'bbfb2de1-4f79-4c94-acf6-52d66b3216b0', // IT a
  'f239d7b1-9a84-4f1c-8e1f-dd95709393ab', // IT a
  '147e9520-9f75-44a7-9715-db66ee7a7336', // IT a
  'e885d891-d87a-434e-8c8a-cb27a98233f7', // IT a
  '242b67d3-4deb-42a8-8abe-8fd4c4d37956', // E2E Test Customer
  'c245f144-b1e1-44d5-872c-4b9e777888da', // E2E Test Customer
  'daa74d6f-4f43-482e-86d9-8a738d331a1e', // E2E Test Customer
  '9fafdcd1-c06b-4791-9d97-919090556268', // HD customer
  '6c1d5117-6d02-47a2-aa33-151907bff17d', // HD customer
  'ebdb9bdc-5750-4dcf-9c22-f5f9f6197b10', // midtrans-e2e
  'eff9da73-a9a4-40cf-a0d4-322c72c82d79', // Name Fix Test
  '78eb848f-a362-4d2a-a618-b3b4d2231d2d', // Name Fix Test
  '24ca6fb6-9077-4754-bc77-18e945290491', // Name Fix Test
]);

// Candidate order ids (from audit). Each is re-verified against the owner
// before deletion — a mismatch aborts that row.
const CANDIDATE_ORDER_IDS = [
  '9e050469-5fea-42eb-b9b1-0d73ec0e21da',
  'ef0033ef-1f62-4c7c-aaa4-55d493a9811c',
  'ef5cc48d-a5aa-4ed6-86c7-922b7fa7fc2c',
  'd67d030b-46a0-49ad-99e8-5cee27eea330',
  '7ac7b386-5b5d-4a61-988e-7e79f66a1f9e',
  'd1900f93-0d4d-4401-a46c-64200361fcae',
  '1e95f56d-929e-47ab-927c-24fae89a59a7',
  '7e83c3aa-759b-4f83-9f5b-567fc49e999e',
  '3201e972-bb0c-47b8-82fc-1318333ae386',
  'a0af3173-1ada-463c-af66-f68eff7579d8',
  '64443646-2b49-4688-b253-2ea59c159a79',
  'b96d2174-d6a2-4fb2-b026-abb2dd0687cf',
  'de2dd161-ba66-4215-b573-ab11913c63ab',
  '58d0e99a-b834-4df8-a961-3f5c4e0d5b27',
  '1590bb10-f140-42c8-8419-b330c4465ddb',
  '5042348f-5392-4d28-8318-b1dd667bdc7e',
  '51fd530e-3811-4832-94fc-db4ad9ebd922',
  '456c4084-c433-4e5f-b4fe-a2cc5c748d5d',
  '58e4326d-5be8-415b-972f-2da699413bd9',
  'c344c391-a73e-4465-ad5c-6c241dd42efa',
  '1a03818a-8cd0-403f-87c7-2ab781721768',
  'b802fe66-4e80-4e99-a1ab-0bd7b867cdca',
  '7d3614fa-b336-4859-add5-f36c6a8a3a48',
  '58768167-f52c-4e4f-981b-9baa88d307c7',
  'f657511f-9a23-4ce9-8b36-38ef5638d1c0',
  'a0eaf66b-fadf-48d2-9781-3b9faeda412d',
  'd66e8e82-7d57-4cec-9ec7-3c5ea21a3ca8',
];

let deleted = 0;
let skipped = 0;
const failures = [];

for (const oid of CANDIDATE_ORDER_IDS) {
  const { data: order } = await admin
    .from('orders')
    .select('id, user_id, order_number, payment_status')
    .eq('id', oid)
    .maybeSingle();

  if (!order) {
    console.log(`SKIP (not found): ${oid}`);
    skipped++;
    continue;
  }

  if (!TEST_USER_IDS.has(order.user_id)) {
    console.log(`SKIP (owner not a test account — kept): ${oid} user=${order.user_id}`);
    skipped++;
    continue;
  }

  const { error } = await admin.from('orders').delete().eq('id', oid);
  if (error) {
    failures.push(oid);
    console.log(`FAIL: ${oid} | ${error.message.split('\n')[0]}`);
  } else {
    deleted++;
    console.log(`DELETED: ${oid} (${order.order_number}) pay=${order.payment_status}`);
  }
}

console.log(`\nSUMMARY: deleted=${deleted} kept/skipped=${skipped} failures=${failures.length}`);
if (failures.length) process.exit(1);
