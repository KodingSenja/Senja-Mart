#!/usr/bin/env node
/**
 * TEMPORARY BACKUP SCRIPT — exports orders, order_items and
 * midtrans_transactions from Supabase (service role) into
 * scripts/backups/orders-backup-<ts>.json BEFORE dummy-data cleanup.
 * Run: node --env-file=.env.local scripts/backup-orders.mjs
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPA_URL || !SERVICE_KEY) {
  console.log('ABORT: Supabase env not configured');
  process.exit(0);
}

const admin = createClient(SUPA_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const grab = async (table, select) => {
  const { data, error } = await admin.from(table).select(select);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
};

const backup = {
  exported_at: new Date().toISOString(),
  orders: await grab('orders', '*'),
  order_items: await grab('order_items', '*'),
  midtrans_transactions: await grab('midtrans_transactions', '*'),
};

const dir = path.resolve('scripts/backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `orders-backup-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(backup, null, 2));

console.log(`BACKUP WRITTEN: ${file}`);
console.log(`  orders: ${backup.orders.length}`);
console.log(`  order_items: ${backup.order_items.length}`);
console.log(`  midtrans_transactions: ${backup.midtrans_transactions.length}`);
