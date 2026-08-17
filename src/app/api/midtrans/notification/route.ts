import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  isMidtransConfigured,
  mapMidtransToPaymentStatus,
  midtransConfig,
  orderUuidFromMidtransOrderId,
  verifyNotificationSignature,
} from 'lib/midtrans/server';

/**
 * POST /api/midtrans/notification
 *
 * Midtrans HTTP notification webhook. There is no user session here, so the
 * DB is written with the server-side service-role client. The notification
 * is only trusted after:
 *   1. the signature key (sha512 of order_id+status_code+gross_amount+ServerKey) matches
 *   2. a known transaction row exists for the order_id
 *   3. the reported gross_amount equals the amount we stored server-side
 *
 * Configure this URL as the "Payment Notification URL" in the Midtrans
 * Sandbox dashboard (https://app.sandbox.midtrans.com/settings/config_info).
 * The UI also polls GET /api/midtrans/status as a fallback.
 */
export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!isMidtransConfigured || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ status: 'not configured' }, { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== 'object') {
      return NextResponse.json({ status: 'invalid payload' }, { status: 400 });
    }

    if (!verifyNotificationSignature(payload, midtransConfig.serverKey)) {
      return NextResponse.json({ status: 'invalid signature' }, { status: 403 });
    }

    const midtransOrderId = String(payload.order_id ?? '');
    const transactionStatus = String(payload.transaction_status ?? '');
    const transactionId = payload.transaction_id
      ? String(payload.transaction_id)
      : null;
    const grossAmount = Number(payload.gross_amount);

    if (!midtransOrderId || !transactionStatus) {
      return NextResponse.json({ status: 'invalid payload' }, { status: 400 });
    }

    interface TxnRow {
      id: string;
      order_id: string;
      amount: number | string;
      status: string;
      midtrans_order_id: string | null;
    }

    // Resolve the payment-attempt row. Each attempt uses a unique Midtrans
    // order_id (midtrans_order_id, e.g. "<order-uuid>-<ts>"), so first try
    // an exact match. Legacy rows stored the order UUID as the Midtrans
    // order_id (midtrans_order_id IS NULL) — fall back to the UUID prefix.
    let txn: TxnRow | null = null;
    let txnError: { message: string } | null = null;
    const queryTxn = (where: { midtrans_order_id: string } | { order_id: string }) =>
      admin
        .from('midtrans_transactions')
        .select('id, order_id, amount, status, midtrans_order_id')
        .match(where)
        .maybeSingle();

    const lookups: (() => Promise<{
      data: TxnRow | null;
      error: { message: string } | null;
    }>)[] = [
      async () =>
        (await queryTxn({ midtrans_order_id: midtransOrderId })) as unknown as {
          data: TxnRow | null;
          error: { message: string } | null;
        },
    ];
    const orderUuid = orderUuidFromMidtransOrderId(midtransOrderId);
    if (orderUuid) {
      lookups.push(async () =>
        (await queryTxn({ order_id: orderUuid })) as unknown as {
          data: TxnRow | null;
          error: { message: string } | null;
        }
      );
    }
    for (const run of lookups) {
      const { data, error } = await run();
      if (error) {
        txnError = error;
      } else if (data) {
        txn = data;
        break;
      }
    }

    if (txnError || !txn) {
      return NextResponse.json({ status: 'not found' }, { status: 404 });
    }

    // Stale-attempt guard: a notification for a previous attempt (whose
    // Midtrans order_id was already replaced by a newer attempt) must not
    // clobber the current attempt's status or the order's payment_status.
    // Acknowledge it so Midtrans stops retrying, but write nothing.
    if (
      txn.midtrans_order_id &&
      txn.midtrans_order_id !== midtransOrderId
    ) {
      return NextResponse.json({ status: 'stale attempt' });
    }

    // Never let a mismatched amount flip an order to paid.
    if (Number.isFinite(grossAmount) && grossAmount !== Number(txn.amount)) {
      return NextResponse.json({ status: 'amount mismatch' }, { status: 400 });
    }

    await admin
      .from('midtrans_transactions')
      .update({
        status: transactionStatus,
        transaction_id: transactionId ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', txn.id);

    const paymentStatus = mapMidtransToPaymentStatus(transactionStatus);

    // Stok mengikuti pembayaran (Fase 9):
    //   paid (settlement/capture) -> konsumsi reservasi (stok berkurang)
    //   expired / failed          -> lepas reservasi (stok tidak berubah)
    // Keduanya idempotent di database (flags + row lock), jadi webhook yang
    // terkirim dua kali tidak akan mengurangi/mengembalikan stok dua kali.
    if (paymentStatus === 'paid') {
      const { error: fulfillError } = await admin.rpc('fulfill_order_stock', {
        p_order_id: txn.order_id,
      });
      if (fulfillError) {
        // Order tetap dibayar; konflik stok sudah ditandai di
        // orders.fulfillment_issue oleh fungsi — butuh penanganan manual
        // admin. Tanpa auto-refund (sesuai keputusan desain).
        console.error(
          `[midtrans:notification] fulfill_order_stock gagal order ${txn.order_id}: ${fulfillError.message}`
        );
      }
    } else if (paymentStatus === 'expired' || paymentStatus === 'failed') {
      const { error: releaseError } = await admin.rpc(
        'release_order_reservation',
        { p_order_id: txn.order_id }
      );
      if (releaseError) {
        console.error(
          `[midtrans:notification] release_order_reservation gagal order ${txn.order_id}: ${releaseError.message}`
        );
      }
    }

    await admin
      .from('orders')
      .update({ payment_status: paymentStatus })
      .eq('id', txn.order_id);

    // Acknowledge so Midtrans does not keep retrying.
    return NextResponse.json({ status: 'ok' });
  } catch {
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
