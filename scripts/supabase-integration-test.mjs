#!/usr/bin/env node
/**
 * SENJA MART — REAL SUPABASE INTEGRATION TEST (credential-safe)
 * Run: node --env-file=.env.local scripts/supabase-integration-test.mjs
 * Prints NO credentials. Reads env vars only.
 */
import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const results = [];
const record = (name, status, evidence = '') => {
  results.push({ name, status, evidence });
  console.log(`[${status}] ${name}${evidence ? ' | ' + evidence : ''}`);
};

const configured = Boolean(SUPA_URL && ANON);
console.log('SUPABASE CONFIGURED:', configured ? 'YES' : 'NO');
if (!configured) {
  console.log('ABORT: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(0);
}
console.log('HOST:', new URL(SUPA_URL).host);
console.log('---');

const makeClient = () =>
  createClient(SUPA_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const anon = makeClient();

const PASSWORD = process.env.IT_PASSWORD || '';
const ts = Date.now();
const rand = Math.random().toString(36).slice(2, 8);
const DOMAINS = ['senjamart.test', 'example.com', 'mailinator.com', 'gmail.com'];
let workingDomain = null;
const localPart = (role) => `it-${ts}-${rand}-${role}`;
const mkEmail = (role) => `${localPart(role)}@${workingDomain}`;

const SHIP_FREE = 300000;
const SHIP_FLAT = 12000;

async function register(role) {
  for (const d of DOMAINS) {
    const email = `${localPart(role)}@${d}`;
    const { data, error } = await anon.auth.signUp({
      email,
      password: PASSWORD,
      options: { data: { full_name: `IT ${role} ${ts}` } },
    });
    if (error) {
      if (/invalid/i.test(error.message)) continue; // try next domain
      return { ok: false, email, error: error.message };
    }
    if (!data.session) return { ok: false, email, error: 'no session (email confirmation likely enabled)' };
    workingDomain ||= d;
    const client = makeClient();
    const { error: se } = await client.auth.setSession({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
    if (se) return { ok: false, email, error: se.message };
    const { data: profile } = await client
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', data.user.id)
      .maybeSingle();
    return {
      ok: true, email, id: data.user.id,
      role: profile?.role || null, fullName: profile?.full_name || null,
      client,
    };
  }
  return { ok: false, email: `${localPart(role)}@<all domains failed>`, error: 'all email domains rejected' };
}

async function getRole(client, uid) {
  const { data } = await client.from('profiles').select('role').eq('id', uid).maybeSingle();
  return data?.role || null;
}

// ---------- T0 connectivity (anon, public) ----------
let catCount = null, prodCount = null, connErr = null;
{
  const c = await anon.from('categories').select('id', { count: 'exact', head: true });
  const p = await anon.from('products').select('id', { count: 'exact', head: true });
  if (c.error || p.error) connErr = (c.error?.message || '') + (p.error?.message || '');
  else { catCount = c.count; prodCount = p.count; }
}
if (connErr) record('T0 Remote connectivity', 'FAIL', connErr);
else record('T0 Remote connectivity', 'PASS', `categories=${catCount}, products=${prodCount} (public anon read)`);

// ---------- T1 registration / admin session ----------
let admin = null, customer = null, authOk = false;
{
  // Preferred: log in with an already-existing test admin (provided via env,
  // never printed). A fresh signup only becomes 'admin' when profiles is
  // empty, so re-runs against a populated DB need this to test admin paths.
  if (process.env.IT_ADMIN_EMAIL) {
    const c = makeClient();
    const { data: ad, error: adErr } = await c.auth.signInWithPassword({
      email: process.env.IT_ADMIN_EMAIL,
      password: PASSWORD,
    });
    if (adErr) {
      record('T1 Admin login (env)', 'FAIL', adErr.message.split('\n')[0]);
    } else {
      const { data: prof } = await c.from('profiles').select('id, role').eq('id', ad.user.id).maybeSingle();
      if (prof?.role === 'admin') {
        admin = { email: process.env.IT_ADMIN_EMAIL, id: ad.user.id, role: 'admin', client: c };
        record('T1 Admin login (env)', 'PASS', 'existing test admin session (no credentials printed)');
      } else {
        record('T1 Admin login (env)', 'FAIL', 'account exists but role is not admin');
      }
    }
  }

  const a = await register('a');
  if (!a.ok) {
    record('T1 Registration', 'FAIL/STOP', `${a.email} | ${a.error}`);
    console.log('---\nAUTH BLOCKED. Authenticated tests skipped.');
  } else if (!admin && a.role === 'admin') {
    admin = a;
    record('T1 Registration (first user)', 'PASS', `${a.email} -> role=${a.role} (trigger first-user-admin)`);
  } else {
    customer = a;
    record('T1 Registration (customer)', 'PASS', `${a.email} -> role=${a.role}`);
    authOk = true;
  }

  if (!customer) {
    const b = await register('b');
    if (!b.ok) { record('T1 Registration (customer)', 'FAIL', b.error); }
    else {
      customer = b;
      record('T1 Registration (customer)', 'PASS', `${b.email} -> role=${b.role}`);
      authOk = true;
    }
  }
}

if (authOk && customer) {
  // ---------- T2 role escalation ----------
  const before = customer.role;
  const r = await customer.client.from('profiles').update({ role: 'admin' }).eq('id', customer.id);
  const after = await getRole(customer.client, customer.id);
  if (r.error && after === 'customer' && before === 'customer') {
    record('T2 Role escalation blocked', 'PASS', `update role=admin rejected (${r.error.code} ${r.error.message.split('\n')[0]}); role stays "${after}"`);
  } else {
    record('T2 Role escalation blocked', 'FAIL', `error=${r.error ? r.error.message.split('\n')[0] : 'none'}; role ${before} -> ${after}`);
  }

  // ---------- catalog pick / test fixtures ----------
  let prodA = null, prodB = null, prodC = null; // admin-created fixtures
  const ensureAdminFixture = async (name, slug, price, stock) => {
    if (!admin) return null;
    const { data, error } = await admin.client
      .from('products')
      .insert({ name, slug, price, stock, unit: 'pcs', is_active: true, description: 'IT integration test fixture' })
      .select('id, name, price, stock, is_active')
      .single();
    if (error) { record(`Fixture ${name}`, 'FAIL', error.message.split('\n')[0]); return null; }
    return data;
  };

  if (admin) {
    // Admin catalog visibility tests (H1) with a dedicated inactive fixture
    const catSlug = `it-test-cat-${ts}`;
    const { data: cat, error: catErr } = await admin.client
      .from('categories')
      .insert({ name: `IT Test Cat ${ts}`, slug: catSlug, is_active: false })
      .select('id, name, is_active')
      .single();
    if (catErr) {
      record('T4 Admin inactive categories', 'FAIL', catErr.message.split('\n')[0]);
    } else {
      const aSel = await admin.client.from('categories').select('id, is_active').eq('id', cat.id).maybeSingle();
      const cSel = await customer.client.from('categories').select('id').eq('id', cat.id).maybeSingle();
      const adminSeeInactiveCat = aSel.data && aSel.data.is_active === false;
      const custBlockedCat = !cSel.data;
      if (adminSeeInactiveCat && custBlockedCat) {
        record('T4 Admin inactive categories', 'PASS', `admin sees is_active=false; customer sees nothing`);
      } else {
        record('T4 Admin inactive categories', 'FAIL', `admin=${JSON.stringify(aSel.data)} customer=${JSON.stringify(cSel.data)} err=${aSel.error?.message?.split('\n')[0]}`);
      }
    }

    const prodSlug = `it-test-prod-${ts}`;
    const { data: prod, error: prodErr } = await admin.client
      .from('products')
      .insert({ name: `IT Test Product ${ts}`, slug: prodSlug, price: 25000, stock: 50, unit: 'pcs', is_active: false })
      .select('id, name, is_active')
      .single();
    if (prodErr) {
      record('T3 Admin inactive products', 'FAIL', prodErr.message.split('\n')[0]);
    } else {
      const aSel = await admin.client.from('products').select('id, is_active').eq('id', prod.id).maybeSingle();
      const cSel = await customer.client.from('products').select('id').eq('id', prod.id).maybeSingle();
      if (aSel.data && aSel.data.is_active === false && !cSel.data) {
        record('T3 Admin inactive products', 'PASS', `admin sees is_active=false; customer sees nothing`);
      } else {
        record('T3 Admin inactive products', 'FAIL', `admin=${JSON.stringify(aSel.data)} customer=${JSON.stringify(cSel.data)}`);
      }
      // T5 product_images of inactive product
      const { data: img, error: imgErr } = await admin.client
        .from('product_images')
        .insert({ product_id: prod.id, image_url: `/it-test/${ts}/main.png`, sort_order: 0 })
        .select('id, product_id')
        .single();
      if (imgErr) {
        record('T5 Admin inactive product images', 'FAIL', imgErr.message.split('\n')[0]);
      } else {
        const aImg = await admin.client.from('product_images').select('id').eq('id', img.id).maybeSingle();
        const cImg = await customer.client.from('product_images').select('id').eq('id', img.id).maybeSingle();
        if (aImg.data && !cImg.data) record('T5 Admin inactive product images', 'PASS', `admin sees image of inactive product; customer sees nothing`);
        else record('T5 Admin inactive product images', 'FAIL', `admin=${JSON.stringify(aImg.data)} customer=${JSON.stringify(cImg.data)}`);
      }
    }

    // active fixtures for cart/checkout/stock/review flows
    prodA = await ensureAdminFixture(`IT Prod A ${ts}`, `it-prod-a-${ts}`, 25000, 50);
    prodB = await ensureAdminFixture(`IT Prod B ${ts}`, `it-prod-b-${ts}`, 100000, 50);
    prodC = await ensureAdminFixture(`IT Prod C ${ts}`, `it-prod-c-${ts}`, 50000, 5);
  } else {
    // no admin: use existing active catalog
    const { data: prods } = await anon.from('products').select('id, name, price, stock').eq('is_active', true).order('price', { ascending: false });
    const pick = (minPrice, maxPrice) =>
      (prods || []).find((p) => p.price >= minPrice && p.price <= maxPrice && p.stock >= 1) || null;
    prodA = pick(1, 299999) || prods?.[0] || null;
    prodB = pick(300000, 1e12) || null;
    prodC = prods?.find((p) => p.stock >= 1) || null;
  }

  const checkout = async (items, shippingCost, subtotal) => {
    const { data, error } = await customer.client.rpc('place_order', {
      p_items: items,
      p_subtotal: subtotal ?? 0,
      p_shipping_cost: shippingCost,
      p_total: 0,
      p_shipping_address: { name: 'IT Test', address: 'Jl. Test 1', city: 'Jakarta', postal_code: '12345', phone: '081234567890' },
    });
    return { data, error };
  };

  // ---------- T6 cart persistence ----------
  if (prodA) {
    const ci = await customer.client.from('cart_items').upsert(
      { user_id: customer.id, product_id: prodA.id, quantity: 2 },
      { onConflict: 'user_id,product_id' }
    ).select('quantity').single();
    const read1 = await customer.client.from('cart_items').select('quantity').eq('user_id', customer.id).eq('product_id', prodA.id).maybeSingle();
    const upd = await customer.client.from('cart_items').update({ quantity: 5 }).eq('user_id', customer.id).eq('product_id', prodA.id).select('quantity').single();
    const read2 = await customer.client.from('cart_items').select('quantity').eq('user_id', customer.id).eq('product_id', prodA.id).maybeSingle();
    if (!ci.error && !upd.error && read1.data?.quantity === 2 && read2.data?.quantity === 5) {
      record('T6 Cart persistence', 'PASS', `insert qty=2 -> read 2 -> update qty=5 -> read 5 (rows in Supabase cart_items)`);
    } else {
      record('T6 Cart persistence', 'FAIL', `ins=${ci.error?.message?.split('\n')[0]} upd=${upd.error?.message?.split('\n')[0]} read1=${read1.data?.quantity} read2=${read2.data?.quantity}`);
    }
  } else {
    record('T6 Cart persistence', 'SKIPPED', 'no usable product');
  }

  // ---------- T7 server-side shipping ----------
  if (prodA) {
    const subtotalA = prodA.price * 1;
    const o = await checkout([{ productId: prodA.id, quantity: 1, price: 1 }], 0, 0); // client lies: price=1, shipping=0
    if (o.error) {
      record('T7 Shipping (<300k)', 'FAIL', o.error.message.split('\n')[0]);
    } else {
      const { data: ord } = await customer.client.from('orders').select('subtotal, shipping_cost, total').eq('id', o.data).single();
      const { data: item } = await customer.client.from('order_items').select('price, quantity, product_id').eq('order_id', o.data).single();
      const okShip = ord.shipping_cost === SHIP_FLAT && ord.subtotal === subtotalA && ord.total === subtotalA + SHIP_FLAT;
      const okSnapshot = item.price === prodA.price && item.product_id === prodA.id;
      if (okShip && okSnapshot) {
        record('T7 Shipping (<300k)', 'PASS', `client sent shipping=0/price=1; DB stored subtotal=${ord.subtotal}, shipping=${ord.shipping_cost} (expected 12000), total=${ord.total}; item price=${item.price} (DB snapshot)`);
      } else {
        record('T7 Shipping (<300k)', 'FAIL', `stored subtotal=${ord.subtotal} shipping=${ord.shipping_cost} total=${ord.total} itemPrice=${item.price} expected shipping=${SHIP_FLAT} itemPrice=${prodA.price}`);
      }
    }
  } else {
    record('T7 Shipping (<300k)', 'SKIPPED', 'no product with price < 300k');
  }

  if (prodB && prodB.price * 4 >= SHIP_FREE) {
    const o = await checkout([{ productId: prodB.id, quantity: 4, price: 1 }], 99999, 0); // client sends shipping=99999
    if (o.error) {
      record('T7 Shipping (>=300k)', 'FAIL', o.error.message.split('\n')[0]);
    } else {
      const { data: ord } = await customer.client.from('orders').select('subtotal, shipping_cost, total').eq('id', o.data).single();
      const expSub = prodB.price * 4;
      if (ord.shipping_cost === 0 && ord.subtotal === expSub && ord.total === expSub) {
        record('T7 Shipping (>=300k)', 'PASS', `subtotal=${ord.subtotal}>=300k -> shipping=${ord.shipping_cost} (client sent 99999, ignored); total=${ord.total}`);
      } else {
        record('T7 Shipping (>=300k)', 'FAIL', `subtotal=${ord.subtotal} shipping=${ord.shipping_cost} total=${ord.total} expected shipping=0`);
      }
    }
  } else {
    record('T7 Shipping (>=300k)', 'SKIPPED', 'no product reaching 300k subtotal (or stock)');
  }

  // ---------- T8 stock validation ----------
  if (prodC) {
    const over = await checkout([{ productId: prodC.id, quantity: prodC.stock + 1 }], 0, 0);
    if (!over.error || !/insufficient_stock/.test(over.error.message)) {
      record('T8 Stock over-limit rejected', 'FAIL', `expected insufficient_stock, got error=${over.error ? over.error.message.split('\n')[0] : 'NONE (order created!)'}`);
    } else {
      record('T8 Stock over-limit rejected', 'PASS', `qty=${prodC.stock + 1} > stock=${prodC.stock} -> ${over.error.message.split('\n')[0]}`);
    }
    const ok = await checkout([{ productId: prodC.id, quantity: 1 }], 0, 0);
    if (ok.error) {
      record('T8 Stock decrement', 'FAIL', ok.error.message.split('\n')[0]);
    } else {
      const { data: cur } = await anon.from('products').select('stock').eq('id', prodC.id).single();
      if (cur.stock === prodC.stock - 1) {
        record('T8 Stock decrement', 'PASS', `stock ${prodC.stock} -> ${cur.stock}`);
      } else {
        record('T8 Stock decrement', 'FAIL', `stock ${prodC.stock} -> ${cur.stock} (expected ${prodC.stock - 1})`);
      }
    }
  } else {
    record('T8 Stock validation', 'SKIPPED', 'no usable product');
  }

  // ---------- T9 order creation + visibility ----------
  if (prodA) {
    const myOrders = await customer.client.from('orders').select('id').order('created_at', { ascending: false }).limit(5);
    const created = myOrders.data || [];
    const thirdUser = await register('c');
    let custCantSee = 'SKIPPED', adminCanSee = 'SKIPPED';
    if (thirdUser.ok && created.length > 0) {
      const oid = created[0].id;
      const asC = await thirdUser.client.from('orders').select('id').eq('id', oid).maybeSingle();
      custCantSee = asC.data ? 'FAIL (another customer saw the order)' : 'PASS';
      if (admin) {
        const asA = await admin.client.from('orders').select('id, user_id').eq('id', oid).maybeSingle();
        adminCanSee = asA.data ? 'PASS' : 'FAIL (admin cannot see order)';
      }
    }
    const ownVisible = created.length >= 1;
    record('T9 Order creation', ownVisible ? 'PASS' : 'FAIL', `customer sees ${created.length} own order(s)`);
    record('T9 Order visibility (cross-customer)', custCantSee === 'PASS' ? 'PASS' : custCantSee === 'FAIL (another customer saw the order)' ? 'FAIL' : 'SKIPPED', custCantSee === 'PASS' ? 'other customer cannot see it' : custCantSee);
    record('T9 Order visibility (admin)', adminCanSee === 'PASS' ? 'PASS' : adminCanSee === 'FAIL (admin cannot see order)' ? 'FAIL' : 'SKIPPED', adminCanSee === 'PASS' ? 'admin can see all orders' : adminCanSee);
  } else {
    record('T9 Order creation/visibility', 'SKIPPED', 'no usable product');
  }

  // ---------- T10 reviews ----------
  if (prodA) {
    const beforeProd = await anon.from('products').select('rating, review_count').eq('id', prodA.id).single();
    const ins = await customer.client.from('reviews').upsert(
      { user_id: customer.id, product_id: prodA.id, rating: 4, review: `IT review ${ts}` },
      { onConflict: 'user_id,product_id' }
    ).select('id, rating').single();
    if (ins.error) {
      record('T10 Review create/read', 'FAIL', ins.error.message.split('\n')[0]);
    } else {
      const read = await customer.client.from('reviews').select('rating, review').eq('id', ins.data.id).maybeSingle();
      const rpc = await anon.rpc('get_product_reviews', { p_product_id: prodA.id });
      const hasAuthor = (rpc.data || []).some((r) => r.id === ins.data.id && r.author_name);
      const afterProd = await anon.from('products').select('rating, review_count').eq('id', prodA.id).single();
      const ratingUpdated = JSON.stringify(beforeProd.data) !== JSON.stringify(afterProd.data);
      if (read.data && hasAuthor && ratingUpdated) {
        record('T10 Review create/read', 'PASS', `insert+read ok; get_product_reviews returns author_name; product rating ${beforeProd.data.rating}->${afterProd.data.rating}, count ${beforeProd.data.review_count}->${afterProd.data.review_count}`);
      } else {
        record('T10 Review create/read', 'FAIL', `read=${JSON.stringify(read.data)} hasAuthor=${hasAuthor} ratingUpdated=${ratingUpdated}`);
      }
    }
    // cleanup review
    await customer.client.from('reviews').delete().eq('user_id', customer.id).eq('product_id', prodA.id);
  } else {
    record('T10 Reviews', 'SKIPPED', 'no usable product');
  }

  // ---------- T11 storage ----------
  if (admin) {
    // The bucket row exists in storage.buckets (verified via DB diagnostic) and
    // object operations (upload/public-read/remove) work. The metadata API
    // (getBucket/listBuckets) can report a stale "not found" for buckets
    // created via SQL until the Storage service refreshes its cache, so the
    // functional path is tested directly instead of gating on getBucket.
    const b = await admin.client.storage.getBucket('product-images');
    const metaOk = !b.error;
    const fname = `it-test-${ts}.txt`;
    const up = await admin.client.storage.from('product-images').upload(fname, new Blob(['it-test-content']), { contentType: 'text/plain' });
    if (up.error) {
      record('T11 Storage', 'FAIL', `admin upload failed: ${up.error.message.split('\n')[0]}`);
    } else {
      record('T11 Storage (admin upload)', 'PASS', metaOk ? 'bucket visible via metadata API; upload OK' : `upload OK (bucket functional); metadata API stale: ${b.error.message.split('\n')[0]}`);
      const { data: pub } = admin.client.storage.from('product-images').getPublicUrl(fname);
      let pubOk = false;
      try { pubOk = (await fetch(pub.publicUrl)).ok; } catch { pubOk = false; }
      record('T11 Storage (public read)', pubOk ? 'PASS' : 'FAIL', `public URL fetch ${pubOk ? '200' : 'failed'}`);
      const cUp = await customer.client.storage.from('product-images').upload(fname, new Blob(['x']), { contentType: 'text/plain' });
      record('T11 Storage (customer write blocked)', cUp.error ? 'PASS' : 'FAIL', cUp.error ? `customer upload rejected (${cUp.error.message.split('\n')[0]})` : 'customer upload succeeded (BAD)');
      const rm = await admin.client.storage.from('product-images').remove([fname]);
      record('T11 Storage (cleanup)', rm.error ? 'FAIL' : 'PASS', rm.error ? `remove failed: ${rm.error.message.split('\n')[0]}` : 'test object removed');
    }
  } else {
    record('T11 Storage', 'SKIPPED', 'no admin credentials available');
  }

  // ---------- cleanup test fixtures ----------
  if (admin) {
    for (const p of [prodA, prodB, prodC]) {
      if (p) await admin.client.from('products').delete().eq('id', p.id);
    }
    const { data: cats } = await admin.client.from('categories').select('id').ilike('slug', `it-test-cat-${ts}`);
    for (const c of cats || []) await admin.client.from('categories').delete().eq('id', c.id);
    console.log('---\n[INFO] Admin test fixtures (products/categories) cleaned up. Test orders & test auth users intentionally left (see report).');
  }
  // remove test cart row
  if (prodA) await customer.client.from('cart_items').delete().eq('user_id', customer.id).eq('product_id', prodA.id);
}

console.log('---\nSUMMARY');
for (const r of results) console.log(`${r.status.padEnd(8)} ${r.name}`);
const pass = results.filter((r) => r.status === 'PASS').length;
const fail = results.filter((r) => r.status === 'FAIL').length;
const skip = results.filter((r) => r.status === 'SKIPPED').length;
console.log(`TOTAL: PASS=${pass} FAIL=${fail} SKIPPED=${skip}`);
