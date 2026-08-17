'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import SearchInput from 'components/admin/ui/SearchInput';
import SelectFilter from 'components/admin/ui/SelectFilter';
import Pagination from 'components/admin/ui/Pagination';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import { usePagination } from 'components/admin/ui/usePagination';
import type {
  InventoryProduct,
  StockMovement,
  StockMovementType,
  StockStatus,
} from 'types/inventory';
import {
  adjustStock,
  getInventoryProducts,
  getStockMovements,
  MOVEMENT_TYPE_LABEL,
  stockStatus,
  STOCK_STATUS_LABEL,
} from 'lib/services/inventory';
import { formatRupiah, formatDate } from 'lib/utils/format';
import { ADMIN_PAGE_SIZE } from 'lib/utils/constants';

const statusBadge: Record<StockStatus, string> = {
  safe: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  low: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  out: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const statusFilterOptions = [
  { value: 'safe', label: 'Aman' },
  { value: 'low', label: 'Menipis' },
  { value: 'out', label: 'Habis' },
];

const movementBadge: Record<StockMovementType, string> = {
  restock: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  sale: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  adjustment:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  cancellation:
    'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  refund: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
};

interface AdjustModalState {
  product: InventoryProduct;
  mode: 'add' | 'reduce';
  amount: string;
  note: string;
}

function InventoryContent() {
  const [products, setProducts] = useState<InventoryProduct[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<'stock' | 'history'>('stock');

  // Search & filter — STATE SENDIRI, tidak terhubung ke Global Search /
  // Search Produk / Search Pesanan / Search Kategori, dan tidak pakai ?q=.
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StockStatus | ''>('');
  const [historySearch, setHistorySearch] = useState('');
  const [historyProductFilter, setHistoryProductFilter] = useState('');

  const [adjusting, setAdjusting] = useState<AdjustModalState | null>(null);
  const [adjustingError, setAdjustingError] = useState<string | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prods, mv] = await Promise.all([
        getInventoryProducts(),
        getStockMovements(),
      ]);
      setProducts(prods);
      setMovements(mv);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data stok.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- Ringkasan (angka real dari Supabase, tanpa mock) ----
  const summary = useMemo(() => {
    let safe = 0;
    let low = 0;
    let out = 0;
    for (const p of products) {
      const s = stockStatus(p.stock, p.lowStockThreshold);
      if (s === 'safe') safe += 1;
      else if (s === 'low') low += 1;
      else out += 1;
    }
    return { total: products.length, safe, low, out };
  }, [products]);

  const categoryOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of products) {
      if (p.categoryId && p.categoryName) seen.set(p.categoryId, p.categoryName);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (categoryFilter && p.categoryId !== categoryFilter) return false;
      if (statusFilter && stockStatus(p.stock, p.lowStockThreshold) !== statusFilter)
        return false;
      return true;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const resetKey = `${search}|${categoryFilter}|${statusFilter}`;
  const { page, setPage, totalPages, pageItems, from, to, total } = usePagination(
    filtered,
    ADMIN_PAGE_SIZE,
    resetKey
  );

  // ---- Riwayat ----
  const filteredMovements = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return movements.filter((m) => {
      if (historyProductFilter && m.productId !== historyProductFilter) return false;
      if (q && !m.productName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [movements, historySearch, historyProductFilter]);

  const historyResetKey = `${historySearch}|${historyProductFilter}`;
  const historyPage = usePagination(
    filteredMovements,
    ADMIN_PAGE_SIZE,
    historyResetKey
  );

  const openHistoryFor = (product: InventoryProduct) => {
    setHistoryProductFilter(product.id);
    setHistorySearch('');
    setView('history');
  };

  const openAdjust = (product: InventoryProduct) => {
    setAdjusting({ product, mode: 'add', amount: '', note: '' });
    setAdjustingError(null);
  };

  const previewAfter = (): number | null => {
    if (!adjusting) return null;
    const n = Number(adjusting.amount);
    if (!Number.isFinite(n) || n <= 0) return null;
    return adjusting.mode === 'add'
      ? adjusting.product.stock + n
      : adjusting.product.stock - n;
  };

  const handleSaveAdjust = async () => {
    if (!adjusting) return;
    const n = Math.floor(Number(adjusting.amount));
    if (!Number.isFinite(n) || n <= 0) {
      setAdjustingError('Jumlah harus lebih dari 0.');
      return;
    }
    if (adjusting.mode === 'reduce' && adjusting.product.stock - n < 0) {
      setAdjustingError('Hasil tidak boleh stok negatif.');
      return;
    }
    setAdjustingError(null);
    setSavingAdjust(true);
    try {
      await adjustStock(
        adjusting.product.id,
        adjusting.mode === 'add' ? n : -n,
        adjusting.note.trim(),
        adjusting.mode === 'add' ? 'restock' : 'adjustment'
      );
      setNotice(
        `Stok "${adjusting.product.name}" ${adjusting.mode === 'add' ? 'ditambah' : 'dikurangi'} ${n} → ${previewAfter()}.`
      );
      setAdjusting(null);
      void load();
    } catch (err) {
      setAdjustingError(
        err instanceof Error ? err.message : 'Gagal menyesuaikan stok.'
      );
    } finally {
      setSavingAdjust(false);
    }
  };

  const movementDeltaClass = (qty: number) =>
    qty > 0
      ? 'text-green-600 font-bold'
      : qty < 0
        ? 'text-red-500 font-bold'
        : 'text-gray-400';

  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="Stok"
          description={
            <>
              Manajemen stok dari tabel{' '}
              <code className="font-mono">products</code> — setiap perubahan
              tercatat di <code className="font-mono">stock_movements</code>.
            </>
          }
        />

        {/* Tabs */}
        <div className="mb-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView('stock')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              view === 'stock'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-800 dark:text-gray-400'
            }`}
          >
            Tabel Stok
          </button>
          <button
            type="button"
            onClick={() => setView('history')}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              view === 'history'
                ? 'bg-brand-500 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-800 dark:text-gray-400'
            }`}
          >
            Riwayat Stok
          </button>
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

        {view === 'stock' ? (
          <>
            {/* Ringkasan */}
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <Card extra="p-5">
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Total Produk
                </div>
                <div className="mt-2 text-2xl font-bold text-navy-700 dark:text-white">
                  {summary.total}
                </div>
                <div className="mt-1 text-xs text-gray-400">semua produk</div>
              </Card>
              <Card extra="p-5">
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Stok Aman
                </div>
                <div className="mt-2 text-2xl font-bold text-green-600">
                  {summary.safe}
                </div>
                <div className="mt-1 text-xs text-gray-400">di atas ambang minimum</div>
              </Card>
              <Card extra="p-5">
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Stok Menipis
                </div>
                <div className="mt-2 text-2xl font-bold text-orange-500">
                  {summary.low}
                </div>
                <div className="mt-1 text-xs text-gray-400">≤ ambang minimum</div>
              </Card>
              <Card extra="p-5">
                <div className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                  Habis
                </div>
                <div className="mt-2 text-2xl font-bold text-red-500">{summary.out}</div>
                <div className="mt-1 text-xs text-gray-400">stok 0</div>
              </Card>
            </div>

            {/* Search & filter — state sendiri */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <SearchInput
                id="inventorySearch"
                placeholder="Cari produk..."
                value={search}
                onChange={setSearch}
              />
              <SelectFilter
                id="inventoryCategoryFilter"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categoryOptions}
                allLabel="Semua Kategori"
              />
              <SelectFilter
                id="inventoryStatusFilter"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as StockStatus | '')}
                options={statusFilterOptions}
                allLabel="Semua Status"
              />
            </div>

            <Card extra="mt-4 p-6">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                      <th className="px-3 pb-3 text-start">Produk</th>
                      <th className="px-3 pb-3 text-start">Kategori</th>
                      <th className="px-3 pb-3 text-start">Harga</th>
                      <th className="px-3 pb-3 text-start">Stok</th>
                      <th className="px-3 pb-3 text-start">Minimum</th>
                      <th className="px-3 pb-3 text-start">Status</th>
                      <th className="px-3 pb-3 text-end">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={7}>
                          <LoadingState label="Memuat stok..." />
                        </td>
                      </tr>
                    ) : products.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            title="Belum ada produk."
                            description="Tambah produk lewat halaman Produk."
                          />
                        </td>
                      </tr>
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState
                            icon="🔍"
                            title="Tidak ditemukan produk yang cocok."
                            description="Coba ubah kata kunci atau filter."
                          />
                        </td>
                      </tr>
                    ) : (
                      pageItems.map((product) => {
                        const status = stockStatus(
                          product.stock,
                          product.lowStockThreshold
                        );
                        return (
                          <tr
                            key={product.id}
                            className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                          >
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-3">
                                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg">
                                  {product.image ? (
                                    <Image
                                      src={product.image}
                                      alt={product.name}
                                      fill
                                      sizes="44px"
                                      className="object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-gray-100 text-lg dark:bg-navy-700">
                                      📦
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="max-w-[220px] truncate text-sm font-bold text-navy-700 dark:text-white">
                                    {product.name}
                                  </div>
                                  {!product.isActive && (
                                    <span className="text-[10px] font-bold text-gray-400">
                                      NONAKTIF
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                              {product.categoryName ?? '—'}
                            </td>
                            <td className="px-3 py-3 text-sm font-semibold text-navy-700 dark:text-white">
                              {formatRupiah(product.price)}
                            </td>
                            <td className="px-3 py-3">
                              <div className="text-sm font-bold text-navy-700 dark:text-white">
                                {product.stock}
                              </div>
                              {product.reservedStock > 0 && (
                                <div className="text-xs text-gray-400">
                                  {Math.max(0, product.stock - product.reservedStock)}{' '}
                                  tersedia · {product.reservedStock} dipesan
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                              {product.lowStockThreshold}
                            </td>
                            <td className="px-3 py-3">
                              <span
                                className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${statusBadge[status]}`}
                              >
                                {STOCK_STATUS_LABEL[status]}
                              </span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openAdjust(product)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
                                >
                                  Sesuaikan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openHistoryFor(product)}
                                  className="rounded-lg px-3 py-1.5 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-navy-700"
                                >
                                  Riwayat
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              {filtered.length > 0 && (
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
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <SearchInput
                id="inventoryHistorySearch"
                placeholder="Cari produk di riwayat..."
                value={historySearch}
                onChange={setHistorySearch}
              />
              {historyProductFilter && (
                <button
                  type="button"
                  onClick={() => setHistoryProductFilter('')}
                  className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2 text-xs font-bold text-gray-500 transition-colors hover:bg-gray-200 dark:bg-navy-800 dark:text-gray-400"
                >
                  ✕ Hapus filter produk
                </button>
              )}
            </div>

            <Card extra="mt-4 p-6">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                      <th className="px-3 pb-3 text-start">Tanggal</th>
                      <th className="px-3 pb-3 text-start">Produk</th>
                      <th className="px-3 pb-3 text-start">Jenis</th>
                      <th className="px-3 pb-3 text-start">Sebelum</th>
                      <th className="px-3 pb-3 text-start">Perubahan</th>
                      <th className="px-3 pb-3 text-start">Sesudah</th>
                      <th className="px-3 pb-3 text-start">Alasan</th>
                      <th className="px-3 pb-3 text-start">Admin</th>
                      <th className="px-3 pb-3 text-start">Referensi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={9}>
                          <LoadingState label="Memuat riwayat..." />
                        </td>
                      </tr>
                    ) : movements.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState
                            icon="🕓"
                            title="Belum ada riwayat stok."
                            description="Semua perubahan stok akan tercatat di sini."
                          />
                        </td>
                      </tr>
                    ) : filteredMovements.length === 0 ? (
                      <tr>
                        <td colSpan={9}>
                          <EmptyState
                            icon="🔍"
                            title="Tidak ditemukan riwayat yang cocok."
                          />
                        </td>
                      </tr>
                    ) : (
                      historyPage.pageItems.map((m) => (
                        <tr
                          key={m.id}
                          className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                        >
                          <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(m.createdAt)}
                          </td>
                          <td className="px-3 py-3 text-sm font-bold text-navy-700 dark:text-white">
                            {m.productName}
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${movementBadge[m.type]}`}
                            >
                              {MOVEMENT_TYPE_LABEL[m.type]}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                            {m.stockBefore}
                          </td>
                          <td
                            className={`px-3 py-3 text-sm ${movementDeltaClass(m.quantity)}`}
                          >
                            {m.quantity > 0
                              ? `+${m.quantity}`
                              : m.quantity < 0
                                ? m.quantity
                                : '0'}
                          </td>
                          <td className="px-3 py-3 text-sm font-semibold text-navy-700 dark:text-white">
                            {m.stockAfter}
                          </td>
                          <td className="max-w-[220px] px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                            {m.note ?? '—'}
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
                            {m.adminName ?? 'Sistem'}
                          </td>
                          <td className="px-3 py-3">
                            <span className="font-mono text-[11px] text-gray-400">
                              {m.referenceId
                                ? `#${m.referenceId.slice(0, 8).toUpperCase()}`
                                : '—'}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {filteredMovements.length > 0 && (
                <Pagination
                  page={historyPage.page}
                  totalPages={historyPage.totalPages}
                  from={historyPage.from}
                  to={historyPage.to}
                  total={historyPage.total}
                  onPageChange={historyPage.setPage}
                />
              )}
            </Card>
          </>
        )}
      </div>

      {/* ============ MODAL PENYESUAIAN STOK ============ */}
      {adjusting && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!savingAdjust) setAdjusting(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Penyesuaian Stok"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-navy-800"
          >
            <h3 className="text-lg font-bold text-navy-700 dark:text-white">
              Penyesuaian Stok
            </h3>

            <dl className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Produk</dt>
                <dd className="font-bold text-navy-700 dark:text-white">
                  {adjusting.product.name}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-gray-500 dark:text-gray-400">Stok saat ini</dt>
                <dd className="font-bold text-navy-700 dark:text-white">
                  {adjusting.product.stock}
                </dd>
              </div>
            </dl>

            <div className="mt-4 flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                  Jenis
                </label>
                <select
                  value={adjusting.mode}
                  onChange={(e) =>
                    setAdjusting((a) =>
                      a ? { ...a, mode: e.target.value as 'add' | 'reduce' } : a
                    )
                  }
                  className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white"
                >
                  <option value="add">Tambah</option>
                  <option value="reduce">Kurangi</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                  Jumlah
                </label>
                <input
                  type="number"
                  min={1}
                  value={adjusting.amount}
                  onChange={(e) =>
                    setAdjusting((a) =>
                      a ? { ...a, amount: e.target.value } : a
                    )
                  }
                  placeholder="cth: 10"
                  className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white dark:placeholder:text-gray-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                  Alasan
                </label>
                <input
                  value={adjusting.note}
                  onChange={(e) =>
                    setAdjusting((a) =>
                      a ? { ...a, note: e.target.value } : a
                    )
                  }
                  placeholder="cth: Restock supplier"
                  className="w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white dark:placeholder:text-gray-500"
                />
              </div>

              <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm dark:bg-navy-700">
                <span className="text-gray-500 dark:text-gray-400">
                  Stok setelah perubahan:{' '}
                </span>
                <span className="font-bold text-navy-700 dark:text-white">
                  {previewAfter() ?? '—'}
                </span>
              </div>

              {adjustingError && (
                <div className="rounded-lg bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600 dark:bg-red-500/10">
                  {adjustingError}
                </div>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-gray-100 pt-5 dark:border-navy-700">
              <button
                type="button"
                onClick={() => setAdjusting(null)}
                disabled={savingAdjust}
                className="rounded-xl px-5 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:text-navy-700 dark:hover:text-white"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() => void handleSaveAdjust()}
                disabled={savingAdjust}
                className="inline-flex items-center rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingAdjust ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminGuard>
  );
}

export default function InventoryAdminPage() {
  return <InventoryContent />;
}
