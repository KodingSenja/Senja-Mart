#!/usr/bin/env node
/**
 * TEMPORARY AUDIT SCRIPT — reads orders + midtrans_transactions + profiles
 * from Supabase using the service role. Prints NO credentials.
 * Run: node --env-file=.env.local scripts/audit-orders.mjs
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

const show = async (title, q) => {
  console.log(`\n=== ${title} ===`);
  const { data, error } = await q;
  if (error) {
    console.log('ERROR:', error.message);
    return null;
  }
  return data;
};

const orders = await show('ORDERS (all)', admin
  .from('orders')
  .select('id, order_number, user_id, status, payment_status, subtotal, shipping_cost, total, shipping_address, created_at')
  .order('created_at', { ascending: false })
  .limit(200));

if (orders) {
  for (const o of orders) {
    const addr = o.shipping_address ? JSON.stringify(o.shipping_address) : 'null';
    console.log(
      `${o.created_at} | ${o.id} | user=${o.user_id} | num=${o.order_number} | st=${o.status} | pay=${o.payment_status} | total=${o.total} | addr=${addr.slice(0, 200)}`
    );
  }
  console.log(`\nTOTAL orders: ${orders.length}`);
  const byPay = {};
  const byStatus = {};
  for (const o of orders) {
    byPay[o.payment_status] = (byPay[o.payment_status] || 0) + 1;
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  }
  console.log('BY payment_status:', JSON.stringify(byPay));
  console.log('BY status:', JSON.stringify(byStatus));
}

const txns = await show('MIDTRANS_TRANSACTIONS (all)', admin
  .from('midtrans_transactions')
  .select('id, order_id, transaction_id, snap_token, status, amount, created_at, updated_at')
  .order('created_at', { ascending: false })
  .limit(200));

if (txns) {
  for (const t of txns) {
    console.log(
      `${t.created_at} | ${t.id} | order=${t.order_id} | midtrans_id=${t.transaction_id ?? 'null'} | status=${t.status} | amount=${t.amount} | has_token=${t.snap_token ? 'yes' : 'no'}`
    );
  }
  console.log(`\nTOTAL txns: ${txns.length}`);
}

const profiles = await show('PROFILES (all)', admin
  .from('profiles')
  .select('id, full_name, role, created_at')
  .order('created_at', { ascending: true })
  .limit(200));

if (profiles) {
  for (const p of profiles) {
    console.log(`${p.created_at} | ${p.id} | ${p.role} | ${p.full_name ?? ''}`);
  }
  console.log(`\nTOTAL profiles: ${profiles.length}`);
}
