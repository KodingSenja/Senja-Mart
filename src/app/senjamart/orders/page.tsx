'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Order, OrderStatus, PaymentStatus } from 'types/order';
import { getOrders } from 'lib/services/orders';
import { supabase, isSupabaseConfigured } from 'lib/supabase/client';
import { useAuth } from 'contexts/AuthContext';
import { formatRupiah, formatDate } from 'lib/utils/format';
import PayNow from 'components/senjamart/PayNow';

const paymentBadges: Record<PaymentStatus, { label: string; className: string }> = {
  paid: {
    label: '✓ Lunas',
    className: 'bg-fresh-green-50 text-fresh-green-700',
  },
  pending: {
    label: 'Menunggu pembayaran',
    className: 'bg-fresh-yellow-500/15 text-fresh-yellow-500',
  },
  expired: {
    label: 'Kedaluwarsa',
    className: 'bg-fresh-red-50 text-fresh-red-600',
  },
  failed: {
    label: 'Pembayaran gagal',
    className: 'bg-fresh-red-50 text-fresh-red-600',
  },
  unpaid: {
    label: 'Belum dibayar',
    className: 'bg-fresh-yellow-500/15 text-fresh-yellow-500',
  },
  refunded: {
    label: 'Refund',
    className: 'bg-fresh-gray-100 text-fresh-gray-600',
  },
};

const statusStyles: Record<OrderStatus, { label: string; className: string }> = {
  pending: { label: 'Menunggu', className: 'bg-fresh-yellow-500/15 text-fresh-yellow-500' },
  processing: { label: 'Diproses', className: 'bg-blue-500/15 text-blue-600' },
  shipped: { label: 'Dikirim', className: 'bg-fresh-green-50 text-fresh-green-700' },
  delivered: { label: 'Selesai', className: 'bg-fresh-gray-100 text-fresh-gray-600' },
  cancelled: { label: 'Dibatalkan', className: 'bg-fresh-red-50 text-fresh-red-600' },
};

function OrdersContent() {
  const searchParams = useSearchParams();
  const justPlaced = searchParams.get('selesai') === '1';
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [payMessage, setPayMessage] = useState<{
    orderId: string;
    message: string;
  } | null>(null);

  const load = useCallback(async () => {
    if (authLoading || !user) return;
    setLoading(true);
    try {
      // RLS allows admins to see every order, but this is the customer's
      // "Pesanan Saya" page — only the signed-in user's own orders may be
      // listed (and paid). The payment API independently enforces the same
      // ownership check, so this only prevents offering payment for orders
      // the user does not own.
      const rows = await getOrders();
      setOrders(rows.filter((o) => o.userId === user.id));
    } catch {
      // keep whatever is already on screen
    } finally {
      setLoading(false);
    }
  }, [user, authLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the list in sync with Supabase: after a successful payment the
  // Midtrans webhook (or the status poll) updates orders.payment_status, so
  // subscribe to realtime and also re-fetch when the tab regains focus to
  // make sure "Lunas" appears without a manual refresh.
  useEffect(() => {
    if (!user) return;
    if (!isSupabaseConfigured || !supabase) return;

    const channel = supabase
      .channel(`orders-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `user_id=eq.${user.id}`,
        },
        () => void load()
      )
      .subscribe();

    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);

    return () => {
      void supabase.removeChannel(channel);
      window.removeEventListener('focus', onFocus);
    };
  }, [user, load]);

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-fresh-gray-300 border-t-fresh-green-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <span className="text-4xl">📦</span>
        <h1 className="mt-4 text-xl font-bold text-fresh-gray-900">
          Masuk untuk melihat pesanan
        </h1>
        <p className="mt-2 text-sm text-fresh-gray-500">
          Riwayat pesanan Anda tersimpan di akun Senja Mart.
        </p>
        <Link
          href="/senjamart/login?redirect=/senjamart/orders"
          className="mt-6 inline-flex items-center rounded-lg bg-fresh-green-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
        >
          Masuk / Daftar
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">
        Pesanan Saya
      </h1>

      {justPlaced && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-fresh-green-600/30 bg-fresh-green-50 p-4 text-sm text-fresh-green-800">
          <span className="text-xl leading-none">✅</span>
          <div>
            <p className="font-semibold">Pesanan berhasil dibuat!</p>
            <p className="mt-0.5">
              Terima kasih telah berbelanja di Senja Mart. Pesanan Anda sedang
              kami proses.
            </p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-lg bg-fresh-gray-100"
            />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-fresh-gray-300 py-16 text-center">
          <span className="text-4xl">📦</span>
          <h2 className="text-lg font-semibold text-fresh-gray-900">
            Belum ada pesanan
          </h2>
          <p className="max-w-sm text-sm text-fresh-gray-500">
            Pesanan Anda akan tampil di sini setelah Anda selesai checkout.
          </p>
          <Link
            href="/senjamart/products"
            className="rounded-lg bg-fresh-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
          >
            Mulai Belanja
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {orders.map((order) => {
            const status = statusStyles[order.status] ?? statusStyles.pending;
            const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
            return (
              <div
                key={order.id}
                className="rounded-lg border border-fresh-gray-200 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-fresh-gray-100 pb-4">
                  <div>
                    <div className="text-sm font-bold text-fresh-gray-900">
                      Pesanan {order.orderNumber ?? order.id.slice(0, 8).toUpperCase()}
                    </div>
                    <div className="text-xs text-fresh-gray-500">
                      {formatDate(order.createdAt)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}
                    >
                      {status.label}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${paymentBadges[order.paymentStatus ?? 'unpaid'].className}`}
                    >
                      {paymentBadges[order.paymentStatus ?? 'unpaid'].label}
                    </span>
                  </div>
                </div>

                <ul className="mt-4 flex flex-col gap-3">
                  {order.items.map((item) => (
                    <li key={item.productId} className="flex items-center gap-3">
                      {item.image && (
                        <Image
                          src={item.image}
                          alt={item.name}
                          width={48}
                          height={48}
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-fresh-gray-900">
                          {item.name}
                        </div>
                        <div className="text-xs text-fresh-gray-500">
                          {item.quantity} × {formatRupiah(item.price)}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-fresh-gray-900">
                        {formatRupiah(item.price * item.quantity)}
                      </div>
                    </li>
                  ))}
                </ul>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-fresh-gray-100 pt-3 text-sm">
                  <span className="text-fresh-gray-500">
                    {itemCount} item
                  </span>
                  <span className="font-bold text-fresh-gray-900">
                    Total: {formatRupiah(order.total)}
                  </span>
                </div>

                {order.paymentStatus !== 'paid' && (
                  <div className="mt-4">
                    <PayNow
                      orderId={order.id}
                      paymentStatus={order.paymentStatus}
                      onResult={(r) => {
                        setPayMessage({ orderId: order.id, message: r.message });
                        if (r.status === 'paid') void load();
                      }}
                    />
                    {payMessage?.orderId === order.id && (
                      <p className="mt-2 text-xs font-medium text-fresh-gray-600">
                        {payMessage.message}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersContent />
    </Suspense>
  );
}
