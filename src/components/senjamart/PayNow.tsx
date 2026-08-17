'use client';

import { useState } from 'react';
import {
  createSnapToken,
  getPaymentStatus,
  loadSnapScript,
  PaymentAlreadyPaidError,
} from 'lib/services/payment';
import { getOrderById } from 'lib/services/orders';

export type PaymentResultStatus =
  | 'paid'
  | 'pending'
  | 'expired'
  | 'cancelled'
  | 'denied'
  | 'failed'
  | 'closed'
  | 'error';

export interface PaymentResult {
  status: PaymentResultStatus;
  message: string;
}

function resultForStatus(transactionStatus: string): PaymentResult {
  switch (transactionStatus) {
    case 'settlement':
    case 'capture':
      return {
        status: 'paid',
        message:
          'Pembayaran berhasil. Pesanan Anda akan segera kami proses.',
      };
    case 'pending':
      return {
        status: 'pending',
        message:
          'Pembayaran sedang diproses. Status pesanan akan diperbarui setelah pembayaran terverifikasi.',
      };
    case 'expire':
      return {
        status: 'expired',
        message: 'Pembayaran kedaluwarsa. Silakan coba bayar kembali.',
      };
    case 'cancel':
      return { status: 'cancelled', message: 'Pembayaran dibatalkan.' };
    case 'deny':
      return {
        status: 'denied',
        message: 'Pembayaran ditolak. Silakan coba lagi atau gunakan metode lain.',
      };
    default:
      return {
        status: 'failed',
        message: 'Pembayaran gagal. Silakan coba lagi.',
      };
  }
}

export default function PayNow({
  orderId,
  onResult,
  label = 'Bayar Sekarang',
  variant = 'primary',
  paymentStatus,
}: {
  orderId: string;
  onResult?: (result: PaymentResult) => void;
  label?: string;
  variant?: 'primary' | 'outline';
  /** Current orders.payment_status known by the caller ('' if unknown). */
  paymentStatus?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Never offer payment for an order that is already paid.
  const isPaid = paymentStatus === 'paid';

  const confirmStatus = async (popup: 'success' | 'pending' | 'error') => {
    try {
      const { transactionStatus } = await getPaymentStatus(orderId);
      onResult?.(resultForStatus(transactionStatus));
    } catch {
      if (popup === 'success') onResult?.(resultForStatus('settlement'));
      else if (popup === 'pending') onResult?.(resultForStatus('pending'));
      else
        onResult?.({
          status: 'failed',
          message: 'Pembayaran gagal. Silakan coba lagi.',
        });
    }
  };

  const handlePay = async () => {
    setLoading(true);
    setError(null);
    try {
      // Guard: a paid order must never reach the Midtrans API. The caller's
      // prop can be stale (e.g. the webhook settled the order after the page
      // loaded), so re-verify the authoritative orders.payment_status from
      // Supabase before creating a Snap transaction.
      let orderPaid = isPaid;
      if (!orderPaid) {
        try {
          orderPaid = (await getOrderById(orderId))?.paymentStatus === 'paid';
        } catch {
          // Read failed — fall through; the API still enforces ownership and
          // the paid check server-side.
          orderPaid = false;
        }
      }
      if (orderPaid) {
        // Already paid — exactly one message, reported through onResult so
        // the caller shows it. No inline error, no generic failure path.
        onResult?.({ status: 'paid', message: 'Pesanan ini sudah dibayar.' });
        return;
      }
      const { snap_token, snap_url } = await createSnapToken(orderId);
      const snap = await loadSnapScript(snap_url);
      snap.pay(snap_token, {
        onSuccess: () => void confirmStatus('success'),
        onPending: () => void confirmStatus('pending'),
        onError: () => void confirmStatus('error'),
        onClose: () =>
          onResult?.({
            status: 'closed',
            message:
              'Popup pembayaran ditutup. Pembayaran belum selesai — Anda dapat melanjutkan dari halaman Pesanan.',
          }),
      });
    } catch (err) {
      // The API rejected because the order is already paid (409). This is a
      // terminal "paid" state, not an open-payment failure — surface the one
      // paid message and do NOT enter the generic error path.
      if (err instanceof PaymentAlreadyPaidError) {
        // The 409 usually means Midtrans already settled the order while
        // orders.payment_status is still stale (e.g. the webhook never
        // landed). Sync the authoritative status through the existing status
        // endpoint — it writes orders.payment_status back to Supabase when
        // Midtrans confirms settlement — so the page's single source of truth
        // updates and the caller's reload shows "Lunas" instead of a
        // contradictory "Belum dibayar" badge + "sudah dibayar" message.
        try {
          await getPaymentStatus(orderId);
        } catch {
          // Best effort — the paid message below is still accurate.
        }
        onResult?.({ status: 'paid', message: err.message });
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Terjadi kesalahan saat membuka pembayaran.'
      );
      onResult?.({
        status: 'error',
        message: 'Gagal membuka pembayaran. Silakan coba lagi.',
      });
    } finally {
      setLoading(false);
    }
  };

  const base =
    'inline-flex w-full items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';
  const styles =
    variant === 'outline'
      ? 'border border-fresh-gray-300 text-fresh-gray-700 hover:border-fresh-green-600 hover:text-fresh-green-700'
      : 'bg-fresh-green-600 text-white hover:bg-fresh-green-700';

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={loading || isPaid}
        className={`${base} ${styles}`}
      >
        {loading
          ? 'Menyiapkan pembayaran...'
          : isPaid
          ? '✓ Sudah dibayar'
          : label}
      </button>
      {error && (
        <p className="text-xs font-medium text-fresh-red-600">{error}</p>
      )}
    </div>
  );
}
