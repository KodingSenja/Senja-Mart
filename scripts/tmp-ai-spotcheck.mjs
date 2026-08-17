import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REF = URL.replace(/^https?:\/\//, '').split('.')[0];

const c = createClient(URL, K, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data } = await c.auth.signInWithPassword({
  email: process.env.IT_ADMIN_EMAIL,
  password: process.env.IT_PASSWORD,
});
const cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify(data.session))}`;
const BASE = 'http://localhost:3000';

async function ask(messages) {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ messages }),
  });
  return res.json();
}

const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: ord } = await admin.from('orders').select('id, order_number, status').limit(1).single();
const before = ord.status;

// User references the order by NUMBER (natural language).
const r = await ask([{ role: 'user', content: `Ubah status order ${ord.order_number} menjadi diproses` }]);
console.log('reply:', r.reply);
console.log('confirmation:', r.confirmation ? JSON.stringify({ action: r.confirmation.action, target: r.confirmation.target }) : 'NULL');

const after = await admin.from('orders').select('status').eq('id', ord.id).single();
console.log('order status unchanged:', after.data.status === before ? 'YES ✓' : `NO — ${after.data.status}`);

if (r.confirmation) {
  // Confirm the action — should execute and return a confirmation prose.
  const c2 = await ask([
    { role: 'user', content: `Ubah status order ${ord.order_number} menjadi diproses` },
  ]);
  const res2 = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({
      messages: [{ role: 'user', content: `Ubah status order ${ord.order_number} menjadi diproses` }],
      confirmation: { token: r.confirmation.token },
    }),
  });
  const j2 = await res2.json();
  console.log('\nconfirm reply:', j2.reply);
  const after2 = await admin.from('orders').select('status').eq('id', ord.id).single();
  console.log('order status after confirm:', after2.data.status, after2.data.status === 'processing' ? '(berubah ✓)' : '(TIDAK berubah)');
  // Restore.
  await admin.from('orders').update({ status: before }).eq('id', ord.id);
  await admin.from('ai_audit_log').delete().eq('action', 'update_order_status').eq('target', `Pesanan ${ord.order_number}`);
  console.log('(restored + audit cleaned)');
}
process.exit(0);
