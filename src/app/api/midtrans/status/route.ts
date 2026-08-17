import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from 'lib/supabase/server';
import {
  getTransactionStatus,
  isMidtransConfigured,
  mapMidtransToPaymentStatus,
} from 'lib/midtrans/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/midtrans/status?orderId=...
 *
 * Returns the authoritative payment status from Midtrans for the current
 * user's order and syncs it to the DB (used when the webhook isn't
 * configured yet or after the Snap popup closes). The amount is compared
 * against the stored order total before any write.
 */
export async function GET(req: NextRequest) {
  try {
    const orderId = req.nextUrl.searchParams.get('orderId');
    if (!orderId) {
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

    const { data: order } = (await supabase
      .from('orders')
      .select('total, user_id, payment_status')
      .eq('id', orderId)
      .maybeSingle()) as {
      data: {
        total: number | string;
        user_id: string | null;
        payment_status: string | null;
      } | null;
      error: unknown;
    };

    if (!order) {
      return NextResponse.json({ error: 'Pesanan tidak ditemukan.' }, { status: 404 });
    }
    if (order.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Anda tidak berhak memeriksa pesanan ini.' },
        { status: 403 }
      );
    }

    if (!isMidtransConfigured) {
      return NextResponse.json(
        { error: 'Konfigurasi Midtrans belum lengkap.' },
        { status: 500 }
      );
    }

    // The current payment attempt's Midtrans order_id (legacy rows fall
    // back to the order UUID, which is what they were created with).
    const { data: txn } = (await supabase
      .from('midtrans_transactions')
      .select('midtrans_order_id')
      .eq('order_id', orderId)
      .maybeSingle()) as {
      data: { midtrans_order_id: string | null } | null;
      error: unknown;
    };
    const midtransOrderId = txn?.midtrans_order_id ?? orderId;

    const midtransStatus = await getTransactionStatus(midtransOrderId);
    const statusCode = String(midtransStatus.status_code ?? '');

    // Midtrans answers with status_code "404" ("Transaction doesn't exist.")
    // when no transaction was ever registered for this order (e.g. a Snap
    // token that was never opened / expired). Nothing to sync — keep the
    // order's stored payment_status untouched.
    if (statusCode === '404') {
      return NextResponse.json({
        transactionStatus: 'notfound',
        paymentStatus: order.payment_status ?? 'unpaid',
      });
    }

    const transactionStatus = String(midtransStatus.transaction_status ?? 'pending');
    const grossAmount = Number(midtransStatus.gross_amount);
    const paymentStatus = mapMidtransToPaymentStatus(transactionStatus);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Sync only when the amount matches what we stored — never trust a
    // notification/response whose amount differs from the order total.
    if (supabaseUrl && serviceRoleKey && Number.isFinite(grossAmount)) {
      const admin = createClient(supabaseUrl, serviceRoleKey);
      const amountOk = grossAmount === Number(order.total);
      if (amountOk) {
        const transactionId = midtransStatus.transaction_id
          ? String(midtransStatus.transaction_id)
          : undefined;
        await admin
          .from('midtrans_transactions')
          .update({
            status: transactionStatus,
            transaction_id: transactionId,
            updated_at: new Date().toISOString(),
          })
          .eq('order_id', orderId);

        // Stok mengikuti pembayaran (Fase 9), idempotent di database —
        // polling status ini adalah jalur cadangan saat webhook belum
        // terkonfigurasi, jadi logika stok harus sama persis.
        if (paymentStatus === 'paid') {
          const { error: fulfillError } = await admin.rpc('fulfill_order_stock', {
            p_order_id: orderId,
          });
          if (fulfillError) {
            console.error(
              `[midtrans:status] fulfill_order_stock gagal order ${orderId}: ${fulfillError.message}`
            );
          }
        } else if (paymentStatus === 'expired' || paymentStatus === 'failed') {
          const { error: releaseError } = await admin.rpc(
            'release_order_reservation',
            { p_order_id: orderId }
          );
          if (releaseError) {
            console.error(
              `[midtrans:status] release_order_reservation gagal order ${orderId}: ${releaseError.message}`
            );
          }
        }

        await admin
          .from('orders')
          .update({ payment_status: paymentStatus })
          .eq('id', orderId)
          .eq('user_id', user.id);
      }
    }

    return NextResponse.json({ transactionStatus, paymentStatus });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Gagal memeriksa status pembayaran.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
