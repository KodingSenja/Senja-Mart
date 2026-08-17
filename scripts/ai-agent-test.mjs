#!/usr/bin/env node
/**
 * SENJA MART — AI BUSINESS ASSISTANT TEST
 *
 * Two modes (run from project root after `npx tsc -p tsconfig.ai-test.json`):
 *   node --env-file=.env.local scripts/ai-agent-test.mjs core   (deterministic, no server)
 *   node --env-file=.env.local scripts/ai-agent-test.mjs http   (needs dev server on :3000)
 *
 * Core mode imports the compiled `src/lib/ai` (CJS in .ai-test-dist) and
 * injects a deterministic fake planner — so the tool routing, confirmation
 * security, action execution and audit path are tested WITHOUT depending on
 * the LLM. HTTP mode drives the real /api/ai/chat endpoint: unauthenticated
 * → 401, customer → 403, admin → 200.
 *
 * Prints NO credentials. Creates test data (an order status change on an
 * EXISTING order + audit rows) and cleans up the audit rows it created.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const K = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SK = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const REF = URL.replace(/^https?:\/\//, '').split('.')[0] || '';

const results = [];
const record = (name, ok, ev = '') => {
  const st = ok ? 'PASS' : 'FAIL';
  results.push({ name, status: st, ev });
  console.log(`[${st}] ${name}${ev ? ' | ' + ev : ''}`);
};
const fail = (name, err) => {
  results.push({ name, status: 'FAIL', ev: String(err).slice(0, 260) });
  console.log(`[FAIL] ${name} | ${String(err).slice(0, 260)}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminClient() {
  const c = createClient(URL, K, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await c.auth.signInWithPassword({
    email: process.env.IT_ADMIN_EMAIL,
    password: process.env.IT_PASSWORD,
  });
  if (error || !data.session) throw new Error('admin sign-in: ' + (error?.message ?? 'no session'));
  const user = data.session.user;
  const bound = createClient(URL, K, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { bound, user, session: data.session };
}

async function coreTests() {
  console.log('--- AI AGENT CORE TESTS (deterministic, fake planner) ---');
  const mod = (p) => import(`../.ai-test-dist/${p}.js`);
  const agentMod = await mod('agent');
  const confirmationMod = await mod('confirmation');
  const actionsMod = await mod('tools/actions');
  const readMod = await mod('tools/read');
  const { runAgent } = agentMod;
  const {
    createPendingConfirmation,
    consumePendingConfirmation,
    ConfirmationError,
  } = confirmationMod;
  const {
    preflightUpdateOrderStatus,
    preflightUpdateProduct,
    preflightUpdateMarketingContent,
  } = actionsMod;
  const { getDashboardSummary, getOrderDetail } = readMod;

  const { bound, user } = await adminClient();
  const ctx = { supabase: bound, userId: user.id };
  const dummyProvider = { chat: async () => { throw new Error('provider should not be called'); } };

  // ---- 1. READ tool: real dashboard data ----
  try {
    const r = await getDashboardSummary(ctx);
    const ok1 = r.ok === true && r.data && typeof r.data.totalProducts === 'number';
    record('READ get_dashboard_summary returns real data', ok1,
      r.data ? `products=${r.data.totalProducts} orders=${r.data.totalOrders}` : JSON.stringify(r).slice(0, 120));
  } catch (e) { fail('READ get_dashboard_summary', e); }

  // ---- 2. READ tool: unknown order → honest error (no fabricated data) ----
  try {
    const r = await getOrderDetail(ctx, { order_id: '00000000-0000-4000-8000-000000000000' });
    record('READ get_order_detail unknown id → error, not fake data', r.ok === false && /tidak ditemukan/i.test(r.error ?? ''),
      r.error ?? '');
  } catch (e) { fail('READ get_order_detail unknown id', e); }

  // ---- 3. Preflight validation (async, resolves references) ----
  try {
    const { data: ord } = await bound.from('orders').select('id, order_number').limit(1).single();
    const { data: prod } = await bound.from('products').select('id, name').limit(1).single();
    const { data: mkt } = await bound.from('marketing_content').select('id, type').limit(1).maybeSingle();

    const bad1 = await preflightUpdateOrderStatus(ctx, { order_id: 'nope', status: 'processing' });
    const bad2 = await preflightUpdateOrderStatus(ctx, { order_id: ord.id, status: 'cancelled' });
    const goodUuid = await preflightUpdateOrderStatus(ctx, { order_id: ord.id, status: 'processing' });
    const goodNumber = await preflightUpdateOrderStatus(ctx, { order_id: ord.order_number, status: 'shipped' });

    const pbad = await preflightUpdateProduct(ctx, { product_id: prod.name, price: 1000 });
    const pgood = await preflightUpdateProduct(ctx, { product_id: prod.name, is_active: true });

    const mbad = await preflightUpdateMarketingContent(ctx, { id: 'x', sort_order: 'a' });
    const mgood = mkt
      ? await preflightUpdateMarketingContent(ctx, { id: mkt.id, is_active: true })
      : { error: 'skip (no marketing content)' };

    const ok1 =
      !!bad1.error && !!bad2.error && !goodUuid.error && !goodNumber.error &&
      goodUuid.params?.order_id === ord.id && goodNumber.params?.order_id === ord.id;
    const ok2 = !!pbad.error && !pgood.error && !!mbad.error && !mgood.error;
    record('ACTION preflight: rejects bad/cancelled/financial, resolves order no/name', ok1 && ok2,
      `order-number→uuid=${goodNumber.params?.order_id === ord.id} cancelled blocked=${!!bad2.error} product financial blocked=${!!pbad.error}`);
  } catch (e) { fail('ACTION preflight', e); }

  // ---- 4. Confirmation store: session binding + single-use ----
  try {
    const makeToken = () =>
      createPendingConfirmation(
        user.id, 'update_order_status', 'Pesanan #TEST',
        { order_id: '00000000-0000-4000-8000-000000000000', status: 'processing' },
        { role: 'assistant', content: '' }, { id: 'c1', name: 'update_order_status', arguments: {} }
      );

    // Wrong user: rejected, and the token is burned (no existence leak).
    const tokenA = makeToken();
    let wrongUserRejected = false;
    try { consumePendingConfirmation(tokenA, 'other-user-id'); } catch (e) { wrongUserRejected = e instanceof ConfirmationError; }
    let burnedAfterWrongUser = false;
    try { consumePendingConfirmation(tokenA, user.id); } catch (e) { burnedAfterWrongUser = e instanceof ConfirmationError; }

    // Correct user: consumes once; replay rejected.
    const tokenB = makeToken();
    const first = consumePendingConfirmation(tokenB, user.id);
    let replayRejected = false;
    try { consumePendingConfirmation(tokenB, user.id); } catch (e) { replayRejected = e instanceof ConfirmationError; }

    const ok1 =
      wrongUserRejected && burnedAfterWrongUser &&
      first?.action === 'update_order_status' && replayRejected;
    record('CONFIRM: token bound to user, single-use, replay rejected', ok1,
      `wrong-user rejected=${wrongUserRejected} token burned=${burnedAfterWrongUser} replay rejected=${replayRejected}`);
  } catch (e) { fail('CONFIRM store', e); }

  // ---- 5. Agent: action request → confirmation (NOT executed), then confirm → executed + audit ----
  const { data: orders } = await bound.from('orders').select('id, order_number, status').limit(1);
  const order = orders && orders[0];
  if (!order) { record('AGENT action flow', false, 'no order to test with'); }
  else {
    try {
      let calls = 0;
      const fakePlanner = async ({ messages }) => {
        calls += 1;
        if (calls === 1) {
          return {
            content: 'saya akan ubah status',
            toolCalls: [{ id: 'tc1', name: 'update_order_status', arguments: { order_id: order.id, status: 'processing' } }],
          };
        }
        return { content: 'Status berhasil diubah.', toolCalls: [] };
      };

      const first = await runAgent(ctx, {
        messages: [{ role: 'user', content: 'ubah status pesanan menjadi diproses' }],
        planner: fakePlanner,
      }, dummyProvider);

      const afterFirst = (await bound.from('orders').select('status').eq('id', order.id).single()).data;
      const notExecuted = first.confirmation !== null && afterFirst.status === order.status;

      const second = await runAgent(ctx, {
        messages: [{ role: 'user', content: 'ubah status pesanan menjadi diproses' }],
        confirmation: { token: first.confirmation.token },
        planner: fakePlanner,
      }, dummyProvider);

      const afterSecond = (await bound.from('orders').select('status').eq('id', order.id).single()).data;
      const executed = second.confirmation === null && afterSecond.status === 'processing';

      // Audit row recorded — the agent's preflight labels the target with the
      // order_number when present (mirrors src/lib/ai/tools/actions.ts).
      const auditTarget = order.order_number
        ? `Pesanan ${order.order_number}`
        : `Pesanan #${order.id.slice(0, 8).toUpperCase()}`;
      const { data: auditRows } = await bound
        .from('ai_audit_log')
        .select('action, target, result')
        .eq('action', 'update_order_status')
        .eq('target', auditTarget)
        .order('created_at', { ascending: false })
        .limit(1);
      const audited = auditRows && auditRows.length === 1 && auditRows[0].result === 'ok';

      record('AGENT action: confirmation first, execute after confirm + audit', notExecuted && executed && audited,
        `before=${order.status} afterConfirm=${afterSecond.status} confirmation=${!!first.confirmation} audit=${audited}`);

      // Restore order status + clean audit rows we created.
      await bound.from('orders').update({ status: order.status }).eq('id', order.id);
      await bound.from('ai_audit_log').delete().eq('action', 'update_order_status').eq('target', auditTarget);
    } catch (e) { fail('AGENT action flow', e); }
  }

  // ---- 6. Agent: cancelled status → blocked by preflight, no confirmation ----
  try {
    const { data: ord } = await bound.from('orders').select('id').limit(1).single();
    let calls = 0;
    const fakePlanner = async () => {
      calls += 1;
      if (calls === 1) {
        return { content: '', toolCalls: [{ id: 'tc2', name: 'update_order_status', arguments: { order_id: ord.id, status: 'cancelled' } }] };
      }
      return { content: 'tidak bisa', toolCalls: [] };
    };
    const r = await runAgent(ctx, {
      messages: [{ role: 'user', content: 'batalkan order' }],
      planner: fakePlanner,
    }, dummyProvider);
    const blocked = r.confirmation === null;
    const hasErrorActivity = (r.toolActivity ?? []).some((t) => t.tool === 'update_order_status' && t.status === 'error');
    record('AGENT action: cancelled status blocked (no confirmation)', blocked && hasErrorActivity,
      `confirmation=${!!r.confirmation} errorActivity=${hasErrorActivity}`);
  } catch (e) { fail('AGENT action cancelled', e); }

  // ---- 7. Agent: read tool round-trip ----
  try {
    let calls = 0;
    const fakePlanner = async ({ messages }) => {
      calls += 1;
      if (calls === 1) {
        return { content: '', toolCalls: [{ id: 'tc3', name: 'get_dashboard_summary', arguments: {} }] };
      }
      const last = messages[messages.length - 1];
      const parsed = last && last.role === 'tool' ? JSON.parse(last.content) : null;
      const sawData = parsed && parsed.ok === true && parsed.data && typeof parsed.data.totalProducts === 'number';
      return { content: sawData ? 'ringkasan tersedia' : 'tidak ada data', toolCalls: [] };
    };
    const r = await runAgent(ctx, {
      messages: [{ role: 'user', content: 'ringkasan' }],
      planner: fakePlanner,
    }, dummyProvider);
    record('AGENT read tool round-trip feeds real data', r.reply === 'ringkasan tersedia',
      `reply=${r.reply} toolActivity=${(r.toolActivity ?? []).length}`);
  } catch (e) { fail('AGENT read round-trip', e); }
}

async function httpTests() {
  console.log('--- AI AGENT HTTP TESTS (dev server on :3000) ---');
  const BASE = 'http://localhost:3000';

  // 401 unauthenticated
  {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'berapa omzet?' }] }),
    });
    record('HTTP unauthenticated → 401', res.status === 401, `status=${res.status}`);
  }

  // Customer → 403
  let customerId = null;
  {
    const email = `ai-http-${Date.now()}@senjamart.test`;
    const pass = 'SenjaMart-AI-2026!x';
    const anon = createClient(URL, K, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { error: su } = await anon.auth.signUp({ email, password: pass });
    if (su) { fail('HTTP customer signup', su.message); }
    else {
      let sess = null;
      for (let i = 0; i < 20; i++) {
        const { data, error } = await anon.auth.signInWithPassword({ email, password: pass });
        if (!error && data.session) { sess = data.session; break; }
        await sleep(1000);
      }
      if (!sess) { fail('HTTP customer sign-in', 'no session'); }
      else {
        customerId = sess.user.id;
        const cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify(sess))}`;
        const res = await fetch(`${BASE}/api/ai/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'berapa omzet?' }] }),
        });
        const json = await res.json().catch(() => null);
        record('HTTP customer → 403 (admin tools denied)', res.status === 403,
          `status=${res.status} ${json?.error?.slice(0, 60) ?? ''}`);
      }
    }
  }

  // Admin → 200 with reply (uses the real OpenRouter key)
  {
    const { session } = await adminClient();
    const cookie = `sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify(session))}`;
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Berapa omzet 30 hari terakhir? Jawab singkat.' }] }),
    });
    const json = await res.json().catch(() => null);
    const ok = res.status === 200 && json && typeof json.reply === 'string' && json.reply.length > 0;
    record('HTTP admin → 200 with reply', ok,
      `status=${res.status} replyLen=${json?.reply?.length ?? 0} toolCalls=${(json?.toolActivity ?? []).length}`);
    if (!ok) console.log('    body:', JSON.stringify(json).slice(0, 300));
  }

  // Page smoke
  {
    const res = await fetch(`${BASE}/admin/senjamart/ai`);
    record('HTTP /admin/senjamart/ai renders (200)', res.status === 200, `status=${res.status}`);
  }

  // Cleanup customer
  if (customerId) {
    try {
      const admin = createClient(URL, SK);
      await admin.auth.admin.deleteUser(customerId);
      await admin.from('profiles').delete().eq('id', customerId);
      console.log('(test customer cleaned up)');
    } catch {}
  }
}

const mode = process.argv[2] || 'core';
const run = mode === 'http' ? httpTests : coreTests;

run()
  .catch((e) => { fail('DRIVER', e); })
  .finally(() => {
    const pass = results.filter((r) => r.status === 'PASS').length;
    const failn = results.filter((r) => r.status === 'FAIL').length;
    console.log(`\n--- SUMMARY (${mode}) ---`);
    for (const r of results) console.log(`${r.status.padEnd(5)} ${r.name}${r.ev ? ' | ' + r.ev : ''}`);
    console.log(`TOTAL: PASS=${pass} FAIL=${failn}`);
    process.exit(failn ? 1 : 0);
  });
