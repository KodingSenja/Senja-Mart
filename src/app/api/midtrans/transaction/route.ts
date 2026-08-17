import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from 'lib/supabase/server';
import {
  ACTIVE_TRANSACTION_STATUSES,
  buildMidtransOrderId,
  createSnapTransaction,
  getTransactionStatus,
  isMidtransConfigured,
  snapScriptUrl,
} from 'lib/midtrans/server';

interface OrderItemRow {
  id: string;
  product_id: string | null;
  product_name: string;
  price: number | string;
  quantity: number;
}

interface OrderRow {
  id: string;
  user_id: string | null;
  total: number | string;
  shipping_cost: number | string;
  shipping_address: Record<string, unknown> | null;
  payment_status?: string | null;
  order_items?: OrderItemRow[];
}

/**
 * POST /api/midtrans/transaction  { orderId }
 *
 * Creates (or reuses) a Midtrans Snap transaction for an order that already
 * exists — the order must belong to the logged-in user and the amount is
 * always taken from the database, never from the client.
 */
export async function POST(req: Request) {
  try {
    if (!isMidtransConfigured) {
      return NextResponse.json(
        {
          error:
            'Konfigurasi Midtrans belum lengkap. Hubungi admin (MIDTRANS_SERVER_KEY belum diisi).',
        },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as { orderId?: string } | null;
    const orderId = body?.orderId;
    if (!orderId || typeof orderId !== 'string') {
      return NextResponse.json({ error: 'orderId diperlukan.' }, { status: 400 });
    }

    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Silakan masuk terlebih dahulu.' },
        { status: 401 }
      );
    }

    const { data: order, error: orderError } = (await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .maybeSingle()) as { data: OrderRow | null; error: unknown };

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Pesanan tidak ditemukan.' },
        { status: 404 }
      );
    }
    if (order.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Anda tidak berhak membayar pesanan ini.' },
        { status: 403 }
      );
    }

    // Idempotency: a still-active Snap token is reused so a checkout refresh
    // never spawns a second Midtrans transaction for the same order.
    const { data: existing } = (await supabase
      .from('midtrans_transactions')
      .select('snap_token, status, midtrans_order_id')
      .eq('order_id', orderId)
      .maybeSingle()) as {
      data: {
        snap_token: string | null;
        status: string;
        midtrans_order_id: string | null;
      } | null;
      error: unknown;
    };

    // Already paid — never create a new Snap transaction (Midtrans would
    // reject the reused order_id and the payment could be double-charged).
    if (
      order.payment_status === 'paid' ||
      existing?.status === 'capture' ||
      existing?.status === 'settlement'
    ) {
      return NextResponse.json({ error: 'Order sudah dibayar.' }, { status: 409 });
    }

    if (
      existing?.snap_token &&
      ACTIVE_TRANSACTION_STATUSES.includes(existing.status)
    ) {
      // A stored token may have expired on Midtrans' side while our row still
      // says pending — verify before reusing so we never hand back a dead
      // token (which would block payment forever).
      //
      // Note: the Midtrans status endpoint responds with HTTP 200 plus a body
      // `status_code: "404"` ("Transaction doesn't exist.") when no chargeable
      // transaction is registered for the order — including for a token that
      // expired or was never opened. Only a stored token whose transaction is
      // still genuinely active (status_code 200 / pending) is reusable.
      try {
        // The stored token belongs to the current attempt's Midtrans
        // order_id (or, for legacy rows, the order UUID itself).
        const current = await getTransactionStatus(
          existing.midtrans_order_id ?? orderId
        );
        const statusCode = String(current.status_code ?? '');
        const currentStatus = String(current.transaction_status ?? '');
        if (currentStatus === 'pending' && statusCode !== '404') {
          return NextResponse.json({
            snap_token: existing.snap_token,
            snap_url: snapScriptUrl(),
          });
        }
        if (currentStatus === 'settlement' || currentStatus === 'capture') {
          return NextResponse.json(
            { error: 'Pesanan ini sudah dibayar.' },
            { status: 409 }
          );
        }
        // expire / cancel / deny / transaction-not-found (status_code 404) →
        // fall through and create a fresh Snap transaction.
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (/transaction doesn't exist|404/i.test(message)) {
          // Midtrans has no record of this order — the stored token is
          // stale. Fall through and create a fresh Snap transaction.
        } else {
          // Genuine network / unexpected error — reuse the stored token as a
          // safe default so a possibly-valid order is not blocked.
          return NextResponse.json({
            snap_token: existing.snap_token,
            snap_url: snapScriptUrl(),
          });
        }
      }
    }

    const grossAmount = Number(order.total) || 0;

    const items = (order.order_items ?? []).map((it) => ({
      id: it.product_id ?? it.id,
      price: Number(it.price) || 0,
      quantity: it.quantity,
      name: it.product_name || 'Produk',
    }));
    const shipping = Number(order.shipping_cost) || 0;
    if (shipping > 0) {
      items.push({ id: 'SHIPPING', price: shipping, quantity: 1, name: 'Ongkos Kirim' });
    }

    const addr = (order.shipping_address ?? {}) as Record<string, string>;

    // Re-reserve stock untuk attempt BARU. Attempt sebelumnya yang
    // expired/failed sudah melepas reservasinya, jadi retry harus
    // me-reserve ulang secara atomik sebelum customer bisa membayar lagi
    // (kalau tidak, settlement nanti tidak menemukan reservasi). Idempotent:
    // no-op bila order masih memegang reservasi. Jika stok habis, pembayaran
    // ulang ditolak di sini (bukan saat settlement).
    const { error: reserveError } = await supabase.rpc('reserve_order_stock', {
      p_order_id: orderId,
    });
    if (reserveError) {
      const reserveMessage = reserveError.message ?? '';
      if (reserveMessage.includes('insufficient_stock')) {
        return NextResponse.json(
          { error: 'Stok produk tidak mencukupi untuk melanjutkan pembayaran.' },
          { status: 400 }
        );
      }
      if (reserveMessage.includes('order_cancelled')) {
        return NextResponse.json(
          { error: 'Pesanan ini sudah dibatalkan.' },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: 'Gagal menyiapkan pembayaran ulang. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    // Every payment attempt gets a fresh, unique Midtrans order_id so a
    // retry never collides with a previous (expired/cancelled) transaction
    // on Midtrans' side. The orders row itself stays the same.
    const midtransOrderId = buildMidtransOrderId(orderId);

    const created = await createSnapTransaction({
      orderId: midtransOrderId,
      grossAmount,
      items,
      customer: {
        first_name: addr.name,
        phone: addr.phone,
        address: addr.address,
        city: addr.city,
        postal_code: addr.postalCode,
      },
    });

    const { error: saveError } = await supabase.rpc('save_midtrans_transaction', {
      p_order_id: orderId,
      p_midtrans_order_id: midtransOrderId,
      p_transaction_id: null,
      p_snap_token: created.token,
      p_redirect_url: created.redirectUrl,
      p_status: 'pending',
      p_amount: grossAmount,
    });

    if (saveError) {
      return NextResponse.json(
        { error: 'Gagal menyimpan transaksi pembayaran. Silakan coba lagi.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      snap_token: created.token,
      snap_url: snapScriptUrl(),
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Terjadi kesalahan saat membuat pembayaran.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
