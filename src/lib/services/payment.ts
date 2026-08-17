'use client';

/**
 * Client-side Midtrans payment helpers. Talks only to our own API routes
 * (never to Midtrans directly) so the Server Key stays server-side.
 */

export interface SnapTransactionResponse {
  snap_token: string;
  snap_url: string;
}

export interface PaymentStatusResponse {
  transactionStatus: string;
  paymentStatus: string;
}

/**
 * Thrown when the payment API responds 409 — the order is already paid.
 * Callers must treat this as a terminal "already paid" state (show the paid
 * message) and NOT as a generic open-payment failure.
 */
export class PaymentAlreadyPaidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentAlreadyPaidError';
  }
}

/** Ask the server for a (reused or fresh) Snap token for an order. */
export async function createSnapToken(orderId: string): Promise<SnapTransactionResponse> {
  const res = await fetch('/api/midtrans/transaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId }),
  });
  const data = (await res.json().catch(() => null)) as Partial<SnapTransactionResponse> & {
    error?: string;
  } | null;
  if (res.status === 409) {
    // 409 means the order is already paid — always surface the same single
    // canonical message regardless of which server branch rejected it.
    throw new PaymentAlreadyPaidError('Pesanan ini sudah dibayar.');
  }
  if (!res.ok) {
    throw new Error(data?.error ?? 'Gagal membuat pembayaran. Silakan coba lagi.');
  }
  if (!data?.snap_token) {
    throw new Error('Server tidak mengembalikan token pembayaran.');
  }
  return {
    snap_token: data.snap_token,
    snap_url: data.snap_url ?? 'https://app.sandbox.midtrans.com/snap/snap.js',
  };
}

/** Ask the server for the authoritative Midtrans status of an order. */
export async function getPaymentStatus(
  orderId: string
): Promise<PaymentStatusResponse> {
  const res = await fetch(
    `/api/midtrans/status?orderId=${encodeURIComponent(orderId)}`
  );
  const data = (await res.json().catch(() => null)) as Partial<PaymentStatusResponse> & {
    error?: string;
  } | null;
  if (!res.ok) {
    throw new Error(data?.error ?? 'Gagal memeriksa status pembayaran.');
  }
  return {
    transactionStatus: data.transactionStatus ?? 'pending',
    paymentStatus: data.paymentStatus ?? 'unpaid',
  };
}

let snapScriptPromise: Promise<Window['snap']> | null = null;

/** Load the Midtrans Snap script once (url comes from the server config). */
export function loadSnapScript(snapUrl?: string): Promise<Window['snap']> {
  const url = snapUrl || 'https://app.sandbox.midtrans.com/snap/snap.js';
  if (!snapScriptPromise) {
    snapScriptPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Snap hanya tersedia di browser.'));
        return;
      }
      if (window.snap) {
        resolve(window.snap);
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.setAttribute(
        'data-client-key',
        process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY ?? ''
      );
      script.async = true;
      script.onload = () => {
        if (window.snap) {
          resolve(window.snap);
        } else {
          snapScriptPromise = null;
          reject(new Error('Gagal memuat Midtrans Snap.'));
        }
      };
      script.onerror = () => {
        snapScriptPromise = null;
        reject(new Error('Gagal memuat Midtrans Snap. Periksa koneksi internet.'));
      };
      document.head.appendChild(script);
    });
  }
  return snapScriptPromise;
}
