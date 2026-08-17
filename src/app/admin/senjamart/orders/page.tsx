'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import SearchInput from 'components/admin/ui/SearchInput';
import SelectFilter from 'components/admin/ui/SelectFilter';
import Pagination from 'components/admin/ui/Pagination';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import { usePagination } from 'components/admin/ui/usePagination';
import type { Order, OrderStatus, PaymentStatus } from 'types/order';
import { getAdminOrders, updateOrderStatus } from 'lib/services/orders';
import { formatRupiah, formatDate } from 'lib/utils/format';
import { ADMIN_PAGE_SIZE } from 'lib/utils/constants';

const statusOptions: { value: OrderStatus; label: string }[] = [
  { value: 'pending', label: 'Menunggu' },
  { value: 'processing', label: 'Diproses' },
  { value: 'shipped', label: 'Dikirim' },
  { value: 'delivered', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
];

const statusBadge: Record<OrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  shipped: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
  delivered: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Belum Bayar',
  pending: 'Menunggu',
  paid: 'Lunas',
  expired: 'Kedaluwarsa',
  failed: 'Gagal',
  refunded: 'Dikembalikan',
};

const paymentBadge: Record<PaymentStatus, string> = {
  unpaid: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300',
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  paid: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  expired: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  refunded: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300',
};

const statusFilterOptions = [
  { value: 'pending', label: 'Menunggu' },
  { value: 'processing', label: 'Diproses' },
  { value: 'shipped', label: 'Dikirim' },
  { value: 'delivered', label: 'Selesai' },
  { value: 'cancelled', label: 'Dibatalkan' },
];

const paymentFilterOptions = [
  { value: 'pending', label: 'Menunggu' },
  { value: 'paid', label: 'Lunas' },
  { value: 'expired', label: 'Kedaluwarsa' },
  { value: 'failed', label: 'Gagal' },
];

function OrdersContent() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | ''>('');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatus | ''>('');

  // Client-side filtering over the already-loaded orders (all rows are in
  // memory), so typing reacts instantly without extra Supabase queries.
  const filteredOrders = orders.filter((order) => {
    const q = search.trim().toLowerCase();
    if (q) {
      const orderRef = `${order.orderNumber ?? ''} ${order.id}`.toLowerCase();
      const customer = order.shippingAddress?.name?.toLowerCase() ?? '';
      if (!orderRef.includes(q) && !customer.includes(q)) return false;
    }
    if (statusFilter && order.status !== statusFilter) return false;
    if (paymentFilter && order.paymentStatus !== paymentFilter) return false;
    return true;
  });

  const resetKey = `${search}|${statusFilter}|${paymentFilter}`;
  const { page, setPage, totalPages, pageItems, from, to, total } =
    usePagination(filteredOrders, ADMIN_PAGE_SIZE, resetKey);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await getAdminOrders());
    } catch {
      setError('Gagal memuat pesanan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusChange = async (order: Order, status: OrderStatus) => {
    setError(null);
    try {
      await updateOrderStatus(order.id, status);
      setNotice(`Status pesanan ${order.orderNumber ?? order.id.slice(0, 8).toUpperCase()} → ${status}.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  };

  return (
    <AdminGuard>
      <div className="mt-3">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-navy-700 dark:text-white">
            Pesanan
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Semua pesanan dari tabel <code className="font-mono">orders</code>{' '}
            — update status langsung tersimpan ke Supabase.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SearchInput
              id="adminOrderSearch"
              placeholder="Cari Order ID / Customer..."
              value={search}
              onChange={setSearch}
            />
            <SelectFilter
              id="adminOrderStatusFilter"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as OrderStatus | '')}
              options={statusFilterOptions}
              allLabel="Status Pesanan"
            />
            <SelectFilter
              id="adminOrderPaymentFilter"
              value={paymentFilter}
              onChange={(v) => setPaymentFilter(v as PaymentStatus | '')}
              options={paymentFilterOptions}
              allLabel="Pembayaran"
            />
          </div>
        </div>

        {notice && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:bg-green-500/10">
            {notice}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
            {error}
          </div>
        )}

        <Card extra="p-6">
          {loading ? (
            <LoadingState label="Memuat pesanan..." />
          ) : orders.length === 0 ? (
            <EmptyState
              icon="🧾"
              title="Belum ada pesanan. Pesanan customer akan muncul di sini."
            />
          ) : filteredOrders.length === 0 ? (
            <EmptyState
              icon="🔍"
              title="Tidak ditemukan pesanan yang cocok."
              description="Coba ubah kata kunci atau filter."
            />
          ) : (
            <div className="flex flex-col gap-4">
              {pageItems.map((order) => {
                const isOpen = expanded[order.id];
                const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-gray-200 p-5 dark:border-navy-600"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-bold text-navy-700 dark:text-white">
                          Pesanan {order.orderNumber ?? order.id.slice(0, 8).toUpperCase()}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatDate(order.createdAt)} · {itemCount} item
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${statusBadge[order.status]}`}
                        >
                          {statusOptions.find((s) => s.value === order.status)?.label ??
                            order.status}
                        </span>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-bold ${paymentBadge[order.paymentStatus ?? 'unpaid']}`}
                        >
                          {paymentLabels[order.paymentStatus ?? 'unpaid']}
                        </span>
                        {order.fulfillmentIssue && (
                          <span
                            title={order.fulfillmentIssue}
                            className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-600 dark:bg-red-500/20 dark:text-red-400"
                          >
                            ⚠️ Perlu penanganan stok
                          </span>
                        )}
                        <select
                          value={order.status}
                          onChange={(e) =>
                            handleStatusChange(
                              order,
                              e.target.value as OrderStatus
                            )
                          }
                          className="rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-xs font-bold text-navy-700 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white"
                        >
                          {statusOptions.map((s) => (
                            <option key={s.value} value={s.value}>
                              Ubah → {s.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((prev) => ({
                              ...prev,
                              [order.id]: !prev[order.id],
                            }))
                          }
                          className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
                        >
                          {isOpen ? 'Sembunyikan' : 'Detail'}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400">
                        Subtotal {formatRupiah(order.subtotal)} + ongkir{' '}
                        {formatRupiah(order.shippingCost)}
                      </span>
                      <span className="font-bold text-navy-700 dark:text-white">
                        Total: {formatRupiah(order.total)}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="mt-4 border-t border-gray-100 pt-4 dark:border-navy-700">
                        {order.shippingAddress && (
                          <div className="mb-4 rounded-lg bg-gray-50 p-4 text-xs text-gray-600 dark:bg-navy-800 dark:text-gray-400">
                            <div className="font-bold text-navy-700 dark:text-white">
                              {order.shippingAddress.name} ·{' '}
                              {order.shippingAddress.phone}
                            </div>
                            <div className="mt-1">
                              {order.shippingAddress.address},{' '}
                              {order.shippingAddress.city}{' '}
                              {order.shippingAddress.postalCode}
                            </div>
                            {order.shippingAddress.notes && (
                              <div className="mt-1 italic">
                                Catatan: {order.shippingAddress.notes}
                              </div>
                            )}
                          </div>
                        )}
                        <ul className="flex flex-col gap-2">
                          {order.items.map((item) => (
                            <li
                              key={item.productId}
                              className="flex items-center gap-3 text-sm"
                            >
                              {item.image && (
                                <Image
                                  src={item.image}
                                  alt={item.name}
                                  width={40}
                                  height={40}
                                  className="h-10 w-10 rounded-lg object-cover"
                                />
                              )}
                              <span className="flex-1 text-navy-700 dark:text-white">
                                {item.name}
                              </span>
                              <span className="text-gray-500 dark:text-gray-400">
                                {item.quantity} × {formatRupiah(item.price)}
                              </span>
                            </li>
                          ))}
                        </ul>

                        {order.paymentAttempt && (
                          <div className="mt-4 rounded-lg bg-gray-50 p-4 text-xs text-gray-600 dark:bg-navy-800 dark:text-gray-400">
                            <div className="mb-1.5 font-bold text-navy-700 dark:text-white">
                              Pembayaran Midtrans
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span>
                                Transaksi ID:{' '}
                                <span className="font-mono">
                                  {order.paymentAttempt.transactionId ?? '—'}
                                </span>
                              </span>
                              <span>
                                Status:{' '}
                                <span className="font-semibold">
                                  {order.paymentAttempt.status ?? '—'}
                                </span>
                              </span>
                              <span>
                                Amount:{' '}
                                {formatRupiah(order.paymentAttempt.amount)}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {filteredOrders.length > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              from={from}
              to={to}
              total={total}
              onPageChange={setPage}
            />
          )}
        </Card>
      </div>
    </AdminGuard>
  );
}

export default function OrdersAdminPage() {
  return <OrdersContent />;
}
