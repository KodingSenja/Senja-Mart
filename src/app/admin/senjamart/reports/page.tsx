'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import Pagination from 'components/admin/ui/Pagination';
import { usePagination } from 'components/admin/ui/usePagination';
import ReportChart from 'components/admin/senjamart/ReportChart';
import { getReportData, resolvePeriod } from 'lib/services/reports';
import type { ReportData, ReportPeriodKey } from 'lib/services/reports';
import { formatRupiah } from 'lib/utils/format';
import type { OrderStatus, PaymentStatus } from 'types/order';
import { MdCalendarMonth, MdDateRange, MdPictureAsPdf, MdPrint } from 'react-icons/md';

const REPORT_PAGE_SIZE = 10;

const statusLabels: Record<OrderStatus, string> = {
  pending: 'Menunggu',
  processing: 'Diproses',
  shipped: 'Dikirim',
  delivered: 'Selesai',
  cancelled: 'Dibatalkan',
};

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

const periodOptions: { key: ReportPeriodKey; label: string }[] = [
  { key: 'today', label: 'Hari Ini' },
  { key: '7d', label: '7 Hari' },
  { key: '30d', label: '30 Hari' },
  { key: 'thisMonth', label: 'Bulan Ini' },
  { key: 'lastMonth', label: 'Bulan Lalu' },
  { key: 'custom', label: 'Custom' },
  { key: 'monthYear', label: 'Pilih Bulan/Tahun' },
];

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

const emptyData: ReportData = {
  summary: {
    totalOmzet: 0,
    totalOrders: 0,
    paidOrders: 0,
    unpaidOrders: 0,
    deliveredOrders: 0,
    cancelledOrders: 0,
    avgOrderValue: 0,
  },
  daily: [],
  topProducts: [],
  topCategories: [],
  transactions: [],
  comparison: null,
};

function jakartaTodayKey(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Year options for the month/tahun picker (module scope → stable). */
const YEAR_OPTIONS: number[] = (() => {
  const jn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const years: number[] = [];
  for (let y = jn.getUTCFullYear() - 2; y <= jn.getUTCFullYear(); y++) years.push(y);
  return years;
})();

function ReportsContent() {
  const [periodKey, setPeriodKey] = useState<ReportPeriodKey>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [monthYear, setMonthYear] = useState('');

  const [data, setData] = useState<ReportData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  const period = useMemo(
    () => resolvePeriod(periodKey, { customFrom, customTo, monthYear }),
    [periodKey, customFrom, customTo, monthYear]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getReportData(period));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat laporan.');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  // Default the month/tahun selector to the current month when first opened.
  useEffect(() => {
    if (periodKey === 'monthYear' && !monthYear) {
      const jn = new Date(Date.now() + 7 * 60 * 60 * 1000);
      setMonthYear(
        `${jn.getUTCFullYear()}-${String(jn.getUTCMonth() + 1).padStart(2, '0')}`
      );
    }
  }, [periodKey, monthYear]);

  const handlePeriodClick = (key: ReportPeriodKey) => {
    if (key === 'custom') {
      const today = jakartaTodayKey();
      if (!customFrom) setCustomFrom(today);
      if (!customTo) setCustomTo(today);
    }
    setPeriodKey(key);
  };

  const comparisonText = useMemo(() => {
    const c = data.comparison;
    if (!c) return 'Data tidak tersedia';
    const base = `Rp ${Math.round(c.prevTotalOmzet).toLocaleString('id-ID')} → Rp ${Math.round(
      data.summary.totalOmzet
    ).toLocaleString('id-ID')}`;
    if (c.omzetChangePercent === null) return base;
    const sign = c.omzetChangePercent >= 0 ? '+' : '';
    return `${base} (${sign}${c.omzetChangePercent.toFixed(1)}%)`;
  }, [data]);

  const { page, setPage, totalPages, pageItems, from, to, total } = usePagination(
    data.transactions,
    REPORT_PAGE_SIZE,
    period.startISO
  );

  const summaryCards = [
    {
      label: 'Total Omzet',
      value: formatRupiah(data.summary.totalOmzet),
      sub: 'pesanan lunas, tanpa dibatalkan',
      accent: true,
    },
    { label: 'Total Pesanan', value: String(data.summary.totalOrders), sub: 'semua pesanan periode' },
    { label: 'Pesanan Lunas', value: String(data.summary.paidOrders), sub: 'payment_status = paid' },
    { label: 'Belum Dibayar', value: String(data.summary.unpaidOrders), sub: 'payment_status ≠ paid' },
    { label: 'Selesai', value: String(data.summary.deliveredOrders), sub: 'status = delivered' },
    { label: 'Dibatalkan', value: String(data.summary.cancelledOrders), sub: 'status = cancelled' },
    {
      label: 'Rata-rata Nilai Pesanan',
      value: formatRupiah(data.summary.avgOrderValue),
      sub: 'omzet ÷ pesanan lunas',
    },
    { label: 'Perbandingan Periode Lalu', value: comparisonText, sub: 'omzet vs periode sebelumnya' },
  ];

  const handleExportPdf = async () => {
    setPdfBusy(true);
    try {
      const { exportReportPdf } = await import('lib/reports/pdf');
      exportReportPdf({
        periodLabel: period.label,
        summary: data.summary,
        daily: data.daily,
        topProducts: data.topProducts,
        topCategories: data.topCategories,
        transactions: data.transactions,
        comparisonText,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat PDF.');
    } finally {
      setPdfBusy(false);
    }
  };

  const periodBtn = (opt: { key: ReportPeriodKey; label: string }) => (
    <button
      key={opt.key}
      type="button"
      onClick={() => handlePeriodClick(opt.key)}
      className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
        periodKey === opt.key
          ? 'bg-brand-500 text-white'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-400'
      }`}
    >
      {opt.label}
    </button>
  );

  return (
    <AdminGuard>
      <div className="mt-3">
        {/* ================== Header + controls (never printed) ================== */}
        <div className="no-print">
          <PageHeader
            title="Laporan Penjualan"
            description={
              <>
                Rekap omzet & transaksi dari tabel{' '}
                <code className="font-mono">orders</code> +{' '}
                <code className="font-mono">order_items</code> (read-only,
                Supabase asli).
              </>
            }
            actions={
              <>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-navy-700 transition-colors hover:bg-gray-100 dark:border-navy-600 dark:text-white dark:hover:bg-navy-800"
                >
                  <MdPrint className="h-4 w-4" /> Cetak
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={pdfBusy}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:opacity-50"
                >
                  <MdPictureAsPdf className="h-4 w-4" />
                  {pdfBusy ? 'Menyiapkan PDF...' : 'Export PDF'}
                </button>
              </>
            }
          />

          <div className="mb-6 flex flex-wrap items-center gap-2">
            {periodOptions.map(periodBtn)}
          </div>

          {periodKey === 'custom' && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-600 dark:bg-navy-800">
              <span className="flex items-center gap-1.5 text-sm font-bold text-navy-700 dark:text-white">
                <MdDateRange className="h-4 w-4 text-brand-500" /> Rentang tanggal
              </span>
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                Dari
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm text-navy-700 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                Sampai
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm text-navy-700 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
                />
              </label>
            </div>
          )}

          {periodKey === 'monthYear' && (
            <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-navy-600 dark:bg-navy-800">
              <span className="flex items-center gap-1.5 text-sm font-bold text-navy-700 dark:text-white">
                <MdCalendarMonth className="h-4 w-4 text-brand-500" /> Pilih bulan & tahun
              </span>
              <select
                aria-label="Bulan"
                value={monthYear ? monthYear.slice(5, 7) : ''}
                onChange={(e) =>
                  setMonthYear(
                    `${(monthYear || '2026').slice(0, 4)}-${e.target.value}`
                  )
                }
                className="rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm font-bold text-navy-700 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
              >
                {MONTHS_SHORT.map((m, i) => (
                  <option key={m} value={String(i + 1).padStart(2, '0')}>
                    {m}
                  </option>
                ))}
              </select>
              <select
                aria-label="Tahun"
                value={monthYear ? monthYear.slice(0, 4) : ''}
                onChange={(e) =>
                  setMonthYear(
                    `${e.target.value}-${(monthYear || '01').slice(5, 7)}`
                  )
                }
                className="rounded-lg border border-gray-200 bg-transparent px-3 py-1.5 text-sm font-bold text-navy-700 outline-none focus:border-brand-500 dark:border-navy-600 dark:bg-navy-900 dark:text-white"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* ================== Report body (this is what gets printed) ================== */}
        <div className="print-report">
          {/* Print-only header (hidden on screen) */}
          <div className="hidden print:block">
            <div className="text-2xl font-bold text-navy-700">Senja Mart</div>
            <div className="text-sm font-semibold text-gray-500">
              Laporan Penjualan — {period.label}
            </div>
            <div className="mb-4 mt-1 text-xs text-gray-400">
              Dibuat {new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })} · Sumber: Supabase (orders · order_items · products · categories)
            </div>
          </div>

          {/* Period label bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-navy-700 dark:text-white">
              Laporan Penjualan
            </h2>
            <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-500 dark:bg-brand-500/20">
              {period.label}
            </span>
          </div>

          {loading ? (
            <Card extra="p-6">
              <LoadingState label="Menghitung laporan..." />
            </Card>
          ) : error ? (
            <Card extra="p-6">
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
                Gagal memuat laporan: {error}
              </div>
            </Card>
          ) : (
            <>
              {/* ===== Ringkasan ===== */}
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                {summaryCards.map((c) => (
                  <Card key={c.label} extra="p-5">
                    <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                      {c.label}
                    </div>
                    <div
                      className={`mt-2 break-words text-xl font-bold ${
                        c.accent
                          ? 'text-brand-500'
                          : 'text-navy-700 dark:text-white'
                      }`}
                    >
                      {c.value}
                    </div>
                    <div className="mt-1 text-xs text-gray-400">{c.sub}</div>
                  </Card>
                ))}
              </div>

              {/* ===== Grafik + Kategori terlaris ===== */}
              <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
                <Card extra="p-6 lg:col-span-2">
                  <ReportChart data={data.daily} />
                </Card>
                <Card extra="p-6">
                  <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">
                    Kategori Terlaris (Top 5)
                  </h3>
                  {data.topCategories.length === 0 ? (
                    <EmptyState
                      icon="🗂️"
                      title="Belum ada penjualan."
                      description="Kategori terlaris tampil setelah ada pesanan lunas."
                    />
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {data.topCategories.map((c, i) => (
                        <li key={c.id} className="flex items-center gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-500 dark:bg-brand-500/20">
                            {i + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-navy-700 dark:text-white">
                              {c.name}
                            </div>
                            <div className="text-xs text-gray-400">
                              {c.quantitySold} unit
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-navy-700 dark:text-white">
                            {formatRupiah(c.revenue)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              {/* ===== Produk terlaris ===== */}
              <Card extra="mt-5 p-6">
                <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">
                  Produk Terlaris (Top 10)
                </h3>
                {data.topProducts.length === 0 ? (
                  <EmptyState
                    icon="🏆"
                    title="Belum ada penjualan."
                    description="Produk terlaris tampil setelah ada pesanan lunas."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                          <th className="px-3 pb-3 text-start">#</th>
                          <th className="px-3 pb-3 text-start">Produk</th>
                          <th className="px-3 pb-3 text-end">Unit Terjual</th>
                          <th className="px-3 pb-3 text-end">Omzet</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topProducts.map((p, i) => (
                          <tr
                            key={p.id}
                            className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                          >
                            <td className="px-3 py-3 text-sm font-bold text-gray-400">
                              {i + 1}
                            </td>
                            <td className="px-3 py-3 text-sm font-bold text-navy-700 dark:text-white">
                              {p.name}
                            </td>
                            <td className="px-3 py-3 text-end text-sm text-gray-500 dark:text-gray-400">
                              {p.quantitySold}
                            </td>
                            <td className="px-3 py-3 text-end text-sm font-semibold text-navy-700 dark:text-white">
                              {formatRupiah(p.revenue)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* ===== Detail transaksi ===== */}
              <Card extra="mt-5 p-6">
                <h3 className="mb-4 text-lg font-bold text-navy-700 dark:text-white">
                  Detail Transaksi
                </h3>
                {data.transactions.length === 0 ? (
                  <EmptyState
                    icon="🧾"
                    title="Tidak ada transaksi pada periode ini."
                    description="Coba pilih periode lain."
                  />
                ) : (
                  <>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                            <th className="px-3 pb-3 text-start">Tanggal</th>
                            <th className="px-3 pb-3 text-start">Order</th>
                            <th className="px-3 pb-3 text-start">Customer</th>
                            <th className="px-3 pb-3 text-end">Total</th>
                            <th className="px-3 pb-3 text-start">Pembayaran</th>
                            <th className="px-3 pb-3 text-start">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageItems.map((t) => (
                            <tr
                              key={t.id}
                              className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                            >
                              <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                                {new Date(t.date).toLocaleDateString('id-ID', {
                                  day: 'numeric',
                                  month: 'short',
                                  year: 'numeric',
                                  timeZone: 'Asia/Jakarta',
                                })}
                              </td>
                              <td className="px-3 py-3 text-sm font-bold text-navy-700 dark:text-white">
                                {t.orderNumber}
                              </td>
                              <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                                {t.customer ?? '—'}
                              </td>
                              <td className="px-3 py-3 text-end text-sm font-semibold text-navy-700 dark:text-white">
                                {formatRupiah(t.total)}
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${paymentBadge[t.paymentStatus]}`}
                                >
                                  {paymentLabels[t.paymentStatus]}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span
                                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge[t.status]}`}
                                >
                                  {statusLabels[t.status]}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="no-print">
                      <Pagination
                        page={page}
                        totalPages={totalPages}
                        from={from}
                        to={to}
                        total={total}
                        onPageChange={setPage}
                      />
                    </div>
                  </>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </AdminGuard>
  );
}

export default function ReportsAdminPage() {
  return <ReportsContent />;
}
