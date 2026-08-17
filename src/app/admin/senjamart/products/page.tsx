'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import ProductForm from 'components/admin/senjamart/ProductForm';
import PageHeader from 'components/admin/ui/PageHeader';
import SearchInput from 'components/admin/ui/SearchInput';
import Pagination from 'components/admin/ui/Pagination';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import { usePagination } from 'components/admin/ui/usePagination';
import type { Category } from 'types/category';
import type { Product, ProductBadge } from 'types/product';import { getProducts,
  setProductActive,
  setProductPopular,
  deleteProduct,
} from 'lib/services/products';
import { stockStatus, STOCK_STATUS_LABEL } from 'lib/services/inventory';
import { getCategories } from 'lib/services/categories';
import { formatRupiah } from 'lib/utils/format';
import { ADMIN_PAGE_SIZE } from 'lib/utils/constants';

const badgeStyles: Record<ProductBadge, string> = {
  sale: 'bg-red-100 text-red-600',
  hot: 'bg-orange-100 text-orange-600',
  new: 'bg-green-100 text-green-600',
};

const stockBadge: Record<string, string> = {
  safe: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  low: 'bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400',
  out: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

function ProductsContent() {
  const searchParams = useSearchParams();
  const showNew = searchParams.get('new') === '1';

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(showNew);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  // Keep the inline edit/add form visible: it renders above the table, so
  // without scrolling it into view a user clicking "Edit" on a product lower
  // in the list would see nothing happen.
  useEffect(() => {
    if (!formOpen) return;
    const t = window.setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(t);
  }, [formOpen]);

  const handleEdit = (product: Product) => {
    setEditing(product);
    setFormOpen(true);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, cats] = await Promise.all([
        getProducts({ includeInactive: true }),
        getCategories({ includeInactive: true }),
      ]);
      setProducts(prods);
      setCategories(cats);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleActive = async (product: Product) => {
    setActionError(null);
    try {
      await setProductActive(product.id, !(product.isActive ?? true));
      setNotice(
        product.isActive === false
          ? `Produk "${product.name}" diaktifkan.`
          : `Produk "${product.name}" dinonaktifkan (tidak tampil di toko).`
      );
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  };

  const handleTogglePopular = async (product: Product) => {
    setActionError(null);
    try {
      await setProductPopular(product.id, !(product.isPopular ?? false));
      setNotice(
        product.isPopular
          ? `Produk "${product.name}" dihapus dari Produk Populer.`
          : `Produk "${product.name}" ditambahkan ke Produk Populer.`
      );
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  };

  const handleDelete = async (product: Product) => {
    if (
      !window.confirm(
        `Hapus produk "${product.name}"? Produk akan hilang dari toko.`
      )
    )
      return;
    setActionError(null);
    try {
      await deleteProduct(product.id);
      setNotice(`Produk "${product.name}" dihapus.`);
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menghapus produk.');
    }
  };

  // Client-side filter (before pagination): all products are loaded from
  // Supabase, so typing filters instantly without a per-keystroke query.
  const query = search.trim().toLowerCase();
  const filtered = query
    ? products.filter((p) => p.name.toLowerCase().includes(query))
    : products;

  const { page, setPage, totalPages, pageItems, from, to, total } =
    usePagination(filtered, ADMIN_PAGE_SIZE, search);

  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="Produk"
          description={
            <>
              Data langsung dari tabel <code className="font-mono">products</code>{' '}
              di Supabase — perubahan langsung tampil di toko.
            </>
          }
          actions={
            <>
              <SearchInput
                id="adminProductSearch"
                placeholder="Cari produk..."
                value={search}
                onChange={setSearch}
              />
              <button
                type="button"
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600"
              >
                + Tambah Produk
              </button>
            </>
          }
        />

        {notice && (
          <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-700 dark:bg-green-500/10">
            {notice}
          </div>
        )}
        {actionError && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
            {actionError}
          </div>
        )}

        {formOpen && (
          <div ref={formRef}>
          <Card extra="mb-6 p-6">
            <h3 className="mb-5 text-lg font-bold text-navy-700 dark:text-white">
              {editing ? `Edit: ${editing.name}` : 'Tambah Produk Baru'}
            </h3>
            <ProductForm
              categories={categories}
              product={editing}
              onSaved={() => {
                setFormOpen(false);
                setEditing(null);
                setNotice(
                  editing
                    ? 'Perubahan produk disimpan ✅'
                    : 'Produk baru berhasil dibuat ✅'
                );
                void load();
              }}
              onCancel={() => {
                setFormOpen(false);
                setEditing(null);
              }}
            />
          </Card>
          </div>
        )}

        <Card extra="p-6">
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
                      <LoadingState label="Memuat produk..." />
                    </td>
                  </tr>
                ) : products.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        title="Belum ada produk."
                        description="Tambahkan produk pertama melalui tombol di atas."
                      />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon="🔍"
                        title="Tidak ditemukan produk yang cocok."
                        description="Coba ubah kata kunci pencarian."
                      />
                    </td>
                  </tr>
                ) : (
                  pageItems.map((product) => (
                    <tr
                      key={product.id}
                      className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                            {product.image ? (
                              <Image
                                src={product.image}
                                alt={product.name}
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gray-100 text-xl dark:bg-navy-700">
                                📦
                              </div>
                            )}
                          </div>
                          <div>
                            <Link
                              href={`/senjamart/products/${product.slug}`}
                              target="_blank"
                              className="block max-w-[220px] truncate text-sm font-bold text-navy-700 hover:text-brand-500 dark:text-white"
                            >
                              {product.name}
                            </Link>
                            {product.badge && (
                              <span
                                className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${badgeStyles[product.badge]}`}
                              >
                                {product.badge.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {product.category?.name ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-sm font-bold text-navy-700 dark:text-white">
                          {formatRupiah(product.price)}
                        </div>
                        {product.compareAtPrice != null && (
                          <div className="text-xs text-gray-400 line-through">
                            {formatRupiah(product.compareAtPrice)}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-sm font-semibold ${
                              product.stock > 0
                                ? 'text-navy-700 dark:text-white'
                                : 'text-red-500'
                            }`}
                          >
                            {product.stock}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${stockBadge[stockStatus(product.stock, product.lowStockThreshold ?? 5)]}`}
                          >
                            {STOCK_STATUS_LABEL[stockStatus(product.stock, product.lowStockThreshold ?? 5)]}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {product.lowStockThreshold ?? 5}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleActive(product)}
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                              product.isActive === false
                                ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700'
                                : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                product.isActive === false
                                  ? 'bg-gray-400'
                                  : 'bg-green-500'
                              }`}
                            />
                            {product.isActive === false ? 'Nonaktif' : 'Aktif'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleTogglePopular(product)}
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                              product.isPopular
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-400'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700'
                            }`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                product.isPopular ? 'bg-amber-500' : 'bg-gray-400'
                              }`}
                            />
                            {product.isPopular ? 'Populer' : 'Bukan Populer'}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(product)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(product)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-500 transition-colors hover:bg-red-50 dark:hover:bg-red-500/10"
                          >
                            Hapus
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
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
      </div>
    </AdminGuard>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsContent />
    </Suspense>
  );
}
