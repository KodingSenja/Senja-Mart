'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import RevenueChart from 'components/admin/senjamart/RevenueChart';
import { getProducts } from 'lib/services/products';
import { getCategories } from 'lib/services/categories';
import { getAdminOrders } from 'lib/services/orders';
import { getDashboardAnalytics, LOW_STOCK_THRESHOLD } from 'lib/services/dashboard';
import type { DashboardAnalytics } from 'lib/services/dashboard';
import type { OrderStatus, PaymentStatus } from 'types/order';
import { formatRupiah } from 'lib/utils/format';

const orderStatusLabels: Record<OrderStatus, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
};

const orderStatusColors: Record<OrderStatus, string> = {
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

const paymentColors: Record<PaymentStatus, string> = {
  unpaid: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300',
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  paid: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  expired: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  refunded: 'bg-gray-100 text-gray-600 dark:bg-navy-700 dark:text-gray-300',
};

const emptyAnalytics: DashboardAnalytics = {
  revenueToday: 0,
  revenue7d: 0,
  revenue30d: 0,
  orderCounts: {
    pending: 0,
    processing: 0,
    shipped: 0,
    delivered: 0,
    cancelled: 0,
  },
  totalOrders: 0,
  revenueByDay: [],
  topProducts: [],
  recentOrders: [],
  lowStock: [],
  outOfStockCount: 0,
  lowStockCount: 0,
};

export default function SenjaMartAdminPage() {
  const [stats, setStats] = useState({
    products: 0,
    activeProducts: 0,
    categories: 0,
    orders: 0,
    revenue: 0,
  });
  const [analytics, setAnalytics] = useState<DashboardAnalytics>(emptyAnalytics);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getProducts({ includeInactive: true }),
      getCategories({ includeInactive: true }),
      getAdminOrders(),
    ])
      .then(([products, categories, orders]) => {
        if (!active) return;
        setStats({
          products: products.length,
          activeProducts: products.filter((p) => p.isActive !== false).length,
          categories: categories.length,
          orders: orders.length,
          // Definisi omzet konsisten di dashboard/analytics/reports:
          // hanya order payment_status='paid' dan status != 'cancelled'.
          revenue: orders.reduce(
            (sum, o) =>
              sum +
              (o.paymentStatus === 'paid' && o.status !== 'cancelled'
                ? o.total
                : 0),
            0
          ),
        });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    getDashboardAnalytics()
      .then((data) => {
        if (active) setAnalytics(data);
      })
      .catch((err) => {
        if (active) {
          setAnalyticsError(
            err instanceof Error ? err.message : 'Gagal memuat analitik.'
          );
        }
      })
      .finally(() => {
        if (active) setAnalyticsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const cards = [
    {
      label: 'Produk',
      value: String(stats.products),
      sub: `${stats.activeProducts} aktif`,
      href: '/admin/senjamart/products',
    },
    {
      label: 'Kategori',
      value: String(stats.categories),
      sub: 'katalog',
      href: '/admin/senjamart/categories',
    },
    {
      label: 'Pesanan',
      value: String(stats.orders),
      sub: 'total',
      href: '/admin/senjamart/orders',
    },
    {
      label: 'Pendapatan',
      value: formatRupiah(stats.revenue),
      sub: 'dari order lunas (paid)',
      href: '/admin/senjamart/orders',
    },
  ];

  const revenueCards = [
    { label: 'Hari ini', value: analytics.revenueToday },
    { label: '7 hari terakhir', value: analytics.revenue7d },
    { label: '30 hari terakhir', value: analytics.revenue30d },
  ];

  const orderStatusRows = (
    ['pending', 'processing', 'shipped', 'delivered', 'cancelled'] as OrderStatus[]
  ).map((status) => ({
    status,
    label: orderStatusLabels[status],
    count: analytics.orderCounts[status],
    color: orderStatusColors[status],
  }));

  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="Senja Mart"
          description="Kelola katalog & pesanan toko — semua perubahan tersimpan langsung ke Supabase."
          actions={
            <Link
              href="/admin/senjamart/products?new=1"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600"
            >
              + Tambah Produk
            </Link>
          }
        />

        {/* PERHATIAN STOK — satu section kecil yang mengarah ke halaman Stok */}
        {!analyticsLoading && !analyticsError &&
          analytics.outOfStockCount + analytics.lowStockCount > 0 && (
            <Link
              href="/admin/senjamart/inventory"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-200 bg-orange-50 px-5 py-4 transition-colors hover:border-orange-400 dark:border-orange-500/20 dark:bg-orange-500/10"
            >
              <span className="text-sm font-bold text-orange-700 dark:text-orange-400">
                ⚠️ PERHATIAN STOK
              </span>
              <span className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                {analytics.outOfStockCount > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    🔴 {analytics.outOfStockCount} produk habis
                  </span>
                )}
                {analytics.lowStockCount > 0 && (
                  <span className="text-orange-600 dark:text-orange-400">
                    🟠 {analytics.lowStockCount} produk stok menipis
                  </span>
                )}
                <span className="text-orange-500">Kelola Stok →</span>
              </span>
            </Link>
          )}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <Link key={card.label} href={card.href}>
              <Card extra="p-6 transition-all hover:-translate-y-0.5 hover:shadow-xl">
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  {card.label}
                </div>
                <div className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">
                  {card.value}
                </div>
                <div className="mt-1 text-xs text-gray-400">{card.sub}</div>
              </Card>
            </Link>
          ))}
        </div>

        {/* ================= DASHBOARD ANALYTICS ================= */}
        <div className="mt-6">
          <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">
            Analitik Penjualan
          </h3>

          {analyticsLoading ? (
            <Card extra="p-6">
              <LoadingState label="Memuat analitik..." />
            </Card>
          ) : analyticsError ? (
            <Card extra="p-6">
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
                Gagal memuat analitik: {analyticsError}
              </div>
            </Card>
          ) : (
            <>
              {/* Omzet */}
              <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
                {revenueCards.map((c) => (
                  <Card key={c.label} extra="p-6">
                    <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                      Omzet — {c.label}
                    </div>
                    <div className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">
                      {formatRupiah(c.value)}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">
                      hanya pesanan lunas (paid)
                    </div>
                  </Card>
                ))}
              </div>

              {/* Pesanan by status */}
              <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-6">
                <Card extra="p-5">
                  <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                    Total Pesanan
                  </div>
                  <div className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">
                    {analytics.totalOrders}
                  </div>
                </Card>
                {orderStatusRows.map((r) => (
                  <Card key={r.status} extra="p-5">
                    <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                      {r.label}
                    </div>
                    <div className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">
                      {r.count}
                    </div>
                    <span
                      className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold ${r.color}`}
                    >
                      {r.label}
                    </span>
                  </Card>
                ))}
              </div>

              {/* Chart + Produk Terlaris */}
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
                <Card extra="p-6 lg:col-span-2">
                  <RevenueChart data={analytics.revenueByDay} />
                </Card>
                <Card extra="p-6">
                  <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">
                    Produk Terlaris
                  </h3>
                  {analytics.topProducts.length === 0 ? (
                    <EmptyState
                      icon="🏆"
                      title="Belum ada penjualan."
                      description="Produk terlaris tampil setelah ada pesanan."
                    />
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {analytics.topProducts.map((p, i) => (
                        <li key={p.productId} className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-500 dark:bg-brand-500/20">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-navy-700 dark:text-white">
                              {p.name}
                            </div>
                            <div className="text-xs text-gray-400">
                              {p.quantitySold} terjual
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-navy-700 dark:text-white">
                            {formatRupiah(p.revenue)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              {/* Recent Orders + Stok Menipis */}
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
                <Card extra="p-6 lg:col-span-2">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-navy-700 dark:text-white">
                      Pesanan Terbaru
                    </h3>
                    <Link
                      href="/admin/senjamart/orders"
                      className="text-xs font-bold text-brand-500 hover:underline"
                    >
                      Lihat semua
                    </Link>
                  </div>
                  {analytics.recentOrders.length === 0 ? (
                    <EmptyState
                      icon="🧾"
                      title="Belum ada pesanan."
                      description="Pesanan customer akan muncul di sini."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                            <th className="px-3 pb-3 text-start">Order</th>
                            <th className="px-3 pb-3 text-start">Customer</th>
                            <th className="px-3 pb-3 text-start">Total</th>
                            <th className="px-3 pb-3 text-start">Status</th>
                            <th className="px-3 pb-3 text-start">Pembayaran</th>
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.recentOrders.map((o) => (
                            <tr
                              key={o.id}
                              className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                            >
                              <td className="px-3 py-3 text-sm font-bold text-navy-700 dark:text-white">
                                {o.orderNumber ?? o.id.slice(0, 8).toUpperCase()}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                                {o.customer ?? '—'}
                              </td>
                              <td className="px-3 py-3 text-sm font-semibold text-navy-700 dark:text-white">
                                {formatRupiah(o.total)}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${orderStatusColors[o.status]}`}
                                >
                                  {orderStatusLabels[o.status]}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${paymentColors[o.paymentStatus]}`}
                                >
                                  {paymentLabels[o.paymentStatus]}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
                <Card extra="p-6">
                  <h3 className="mb-1 text-lg font-bold text-navy-700 dark:text-white">
                    Stok Menipis
                  </h3>
                  <p className="mb-4 text-xs text-gray-400">
                    Stok ≤ {LOW_STOCK_THRESHOLD} (data real dari tabel{' '}
                    <code className="font-mono">products</code>)
                  </p>
                  {analytics.lowStock.length === 0 ? (
                    <EmptyState
                      icon="✅"
                      title="Semua stok aman."
                      description={`Tidak ada produk dengan stok ≤ ${LOW_STOCK_THRESHOLD}.`}
                    />
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {analytics.lowStock.map((p) => (
                        <li key={p.id} className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100 text-lg dark:bg-navy-700">
                            {p.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={p.image}
                                alt={p.name}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span aria-hidden>{'📦'}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-navy-700 dark:text-white">
                              {p.name}
                            </div>
                            <div className="text-xs text-gray-400">
                              Stok {p.stock}
                            </div>
                          </div>
                          <span className="rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-bold text-red-600 dark:bg-red-500/20 dark:text-red-400">
                            {p.stock} tersisa
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <Link href="/admin/senjamart/ai">
            <Card extra="p-6 transition-all hover:border-brand-500">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl dark:bg-brand-500/20">
                  🤖
                </span>
                <div>
                  <div className="font-bold text-navy-700 dark:text-white">
                    AI Business Assistant
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Tanya omzet, analisis penjualan, rekomendasi, dan tindakan aman
                  </div>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/admin/senjamart/products">
            <Card extra="p-6 transition-all hover:border-brand-500">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl dark:bg-brand-500/20">
                  📦
                </span>
                <div>
                  <div className="font-bold text-navy-700 dark:text-white">
                    Produk
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    List, tambah, ubah harga & stok, aktif/nonaktif
                  </div>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/admin/senjamart/categories">
            <Card extra="p-6 transition-all hover:border-brand-500">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl dark:bg-brand-500/20">
                  🗂️
                </span>
                <div>
                  <div className="font-bold text-navy-700 dark:text-white">
                    Kategori
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    List, tambah, edit, aktif/nonaktif
                  </div>
                </div>
              </div>
            </Card>
          </Link>
          <Link href="/admin/senjamart/orders">
            <Card extra="p-6 transition-all hover:border-brand-500">
              <div className="flex items-center gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-2xl dark:bg-brand-500/20">
                  🧾
                </span>
                <div>
                  <div className="font-bold text-navy-700 dark:text-white">
                    Pesanan
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Semua pesanan customer, update status
                  </div>
                </div>
              </div>
            </Card>
          </Link>
        </div>
      </div>
    </AdminGuard>
  );
}
