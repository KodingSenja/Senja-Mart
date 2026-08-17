'use client';

import Image from 'next/image';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import SearchInput from 'components/admin/ui/SearchInput';
import Pagination from 'components/admin/ui/Pagination';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import { usePagination } from 'components/admin/ui/usePagination';
import type { Category } from 'types/category';
import {
  getCategories,
  createCategory,
  updateCategory,
  setCategoryActive,
  deleteCategory,
} from 'lib/services/categories';
import { uploadProductImage } from 'lib/services/storage';
import { slugify } from 'lib/utils/slugify';
import { ADMIN_PAGE_SIZE } from 'lib/utils/constants';

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white';

function CategoriesContent() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugAuto, setSlugAuto] = useState(true);
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [sortOrder, setSortOrder] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await getCategories({ includeInactive: true }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setSlug('');
    setSlugAuto(true);
    setDescription('');
    setImageUrl('');
    setSortOrder(
      categories.reduce((max, c) => Math.max(max, c.sortOrder ?? 0), 0) + 1
    );
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setName(category.name);
    setSlug(category.slug);
    // Auto mode only when the current slug matches what the name would
    // produce — a custom/edited slug is preserved as-is.
    setSlugAuto(category.slug === slugify(category.name));
    setDescription(category.description ?? '');
    setImageUrl(category.image);
    setSortOrder(category.sortOrder ?? 0);
    setFormError(null);
    setFormOpen(true);
  };

  const handleNameChange = (value: string) => {
    setName(value);
    // Only follow the name while the slug is still in auto mode.
    if (slugAuto) setSlug(slugify(value));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError(null);
    try {
      setImageUrl(await uploadProductImage(file, 'categories'));
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal mengunggah gambar.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setFormError('Nama kategori wajib diisi.');
    const finalSlug = slug.trim() || slugify(name);
    const collision = categories.find(
      (c) => c.slug === finalSlug && c.id !== editing?.id
    );
    if (collision) {
      return setFormError(
        `Slug "${finalSlug}" sudah digunakan kategori lain.`
      );
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        name: name.trim(),
        slug: finalSlug,
        description,
        imageUrl: imageUrl || null,
        sortOrder,
      };
      if (editing) {
        await updateCategory(editing.id, payload);
        setNotice(`Kategori "${name}" diperbarui ✅`);
      } else {
        await createCategory(payload);
        setNotice(`Kategori "${name}" dibuat ✅`);
      }
      setFormOpen(false);
      void load();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal menyimpan kategori.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (category: Category) => {
    setActionError(null);
    try {
      await setCategoryActive(category.id, !(category.isActive ?? true));
      setNotice(
        category.isActive === false
          ? `Kategori "${category.name}" diaktifkan.`
          : `Kategori "${category.name}" dinonaktifkan.`
      );
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal mengubah status.');
    }
  };

  const handleDelete = async (category: Category) => {
    if (
      category.productCount &&
      category.productCount > 0
    ) {
      window.alert(
        `Kategori "${category.name}" memiliki ${category.productCount} produk. Nonaktifkan saja atau pindahkan produknya terlebih dahulu.`
      );
      return;
    }
    if (!window.confirm(`Hapus kategori "${category.name}"?`)) return;
    setActionError(null);
    try {
      await deleteCategory(category.id);
      setNotice(`Kategori "${category.name}" dihapus.`);
      void load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Gagal menghapus kategori.');
    }
  };

  const sorted = [...categories].sort(
    (a, b) =>
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)
  );

  // Client-side filter (same pattern as the Products page): all categories
  // are already loaded from Supabase, so typing filters instantly without a
  // per-keystroke query. CRUD + reorder logic keep using the full `sorted`.
  const query = search.trim().toLowerCase();
  const filtered = query
    ? sorted.filter((c) => c.name.toLowerCase().includes(query))
    : sorted;

  const { page, setPage, totalPages, pageItems, from, to, total } =
    usePagination(filtered, ADMIN_PAGE_SIZE, search);

  const hasNeighbor = (category: Category, dir: -1 | 1): boolean => {
    const idx = sorted.findIndex((c) => c.id === category.id);
    return idx >= 0 && Boolean(sorted[idx + dir]);
  };

  const handleMove = async (category: Category, dir: -1 | 1) => {
    setActionError(null);
    const idx = sorted.findIndex((c) => c.id === category.id);
    const neighbor = sorted[idx + dir];
    if (!neighbor) return;
    try {
      await Promise.all([
        updateCategory(category.id, { name: category.name, sortOrder: neighbor.sortOrder ?? 0 }),
        updateCategory(neighbor.id, { name: neighbor.name, sortOrder: category.sortOrder ?? 0 }),
      ]);
      setNotice('Urutan kategori diperbarui.');
      void load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengubah urutan.'
      );
    }
  };

  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="Kategori"
          description={
            <>
              Data langsung dari tabel{' '}
              <code className="font-mono">categories</code> di Supabase.
            </>
          }
          actions={
            <>
              <SearchInput
                id="adminCategorySearch"
                placeholder="Cari kategori..."
                value={search}
                onChange={setSearch}
              />
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600"
              >
                + Tambah Kategori
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
          <Card extra="mb-6 p-6">
            <h3 className="mb-5 text-lg font-bold text-navy-700 dark:text-white">
              {editing ? `Edit: ${editing.name}` : 'Tambah Kategori Baru'}
            </h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Nama Kategori *
                  </label>
                  <input
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="cth: Minuman"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Slug
                  </label>
                  <input
                    value={slug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugAuto(false);
                    }}
                    placeholder="cth: minuman"
                    className={inputClass}
                  />
                  {slugAuto && (
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      Otomatis mengikuti nama. Edit manual untuk slug khusus.
                    </p>
                  )}
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Gambar
                  </label>
                  <div className="flex items-center gap-3">
                    {imageUrl && (
                      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg">
                        <Image
                          src={imageUrl}
                          alt=""
                          fill
                          sizes="48px"
                          className="object-cover"
                        />
                      </div>
                    )}
                    <label className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-navy-600">
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Deskripsi
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Deskripsi kategori..."
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Urutan
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={sortOrder}
                    onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                    className={inputClass}
                  />
                </div>
              </div>

              {formError && (
                <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-4 dark:border-navy-700">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-xl px-5 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:text-navy-700 dark:hover:text-white"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Buat Kategori'}
                </button>
              </div>
            </form>
          </Card>
        )}

        <Card extra="p-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 text-start text-xs font-bold uppercase tracking-wide text-gray-400 dark:border-navy-700">
                  <th className="px-3 pb-3 text-start">Kategori</th>
                  <th className="px-3 pb-3 text-start">Slug</th>
                  <th className="px-3 pb-3 text-start">Produk</th>
                  <th className="px-3 pb-3 text-start">Urutan</th>
                  <th className="px-3 pb-3 text-start">Status</th>
                  <th className="px-3 pb-3 text-end">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <LoadingState label="Memuat kategori..." />
                    </td>
                  </tr>
                ) : categories.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState title="Belum ada kategori." />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon="🔍"
                        title="Tidak ditemukan"
                        description="Coba ubah kata kunci pencarian."
                      />
                    </td>
                  </tr>
                ) : (
                  pageItems.map((category) => (
                    <tr
                      key={category.id}
                      className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                    >
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg">
                            {category.image ? (
                              <Image
                                src={category.image}
                                alt={category.name}
                                fill
                                sizes="40px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gray-100 text-lg dark:bg-navy-700">
                                🗂️
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-bold text-navy-700 dark:text-white">
                            {category.name}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {category.slug}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {category.productCount ?? 0}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                          <button
                            type="button"
                            aria-label="Naikkan urutan"
                            disabled={!hasNeighbor(category, -1)}
                            onClick={() => handleMove(category, -1)}
                            className="rounded px-1.5 py-0.5 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-navy-700 dark:hover:text-white"
                          >
                            ↑
                          </button>
                          <span className="w-6 text-center font-semibold">
                            {category.sortOrder ?? 0}
                          </span>
                          <button
                            type="button"
                            aria-label="Turunkan urutan"
                            disabled={!hasNeighbor(category, 1)}
                            onClick={() => handleMove(category, 1)}
                            className="rounded px-1.5 py-0.5 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-navy-700 dark:hover:text-white"
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(category)}
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                            category.isActive === false
                              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700'
                              : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              category.isActive === false
                                ? 'bg-gray-400'
                                : 'bg-green-500'
                            }`}
                          />
                          {category.isActive === false ? 'Nonaktif' : 'Aktif'}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(category)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(category)}
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

export default function CategoriesAdminPage() {
  return <CategoriesContent />;
}
