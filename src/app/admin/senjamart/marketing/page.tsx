'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import AdminGuard from 'components/admin/senjamart/AdminGuard';
import Card from 'components/card';
import PageHeader from 'components/admin/ui/PageHeader';
import SearchInput from 'components/admin/ui/SearchInput';
import Pagination from 'components/admin/ui/Pagination';
import LoadingState from 'components/admin/ui/LoadingState';
import EmptyState from 'components/admin/ui/EmptyState';
import { usePagination } from 'components/admin/ui/usePagination';
import type { MarketingContent, MarketingContentType } from 'types/marketing';
import {
  getAdminMarketingContent,
  createMarketingContent,
  updateMarketingContent,
  deleteMarketingContent,
  setMarketingContentActive,
} from 'lib/services/marketing';
import {
  uploadMarketingImage,
  deleteMarketingImage,
} from 'lib/services/storage';
import { ADMIN_PAGE_SIZE } from 'lib/utils/constants';

const typeLabels: Record<MarketingContentType, string> = {
  hero: 'Hero Slider',
  banner: 'Banner',
};

const typeBadge: Record<MarketingContentType, string> = {
  hero: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  banner: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400',
};

type TypeFilter = MarketingContentType | 'all';

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white dark:placeholder:text-gray-500';

function MarketingContent() {
  const [contents, setContents] = useState<MarketingContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MarketingContent | null>(null);

  const [formType, setFormType] = useState<MarketingContentType>('hero');
  const [imageUrl, setImageUrl] = useState('');
  const [badge, setBadge] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [description, setDescription] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContents(await getAdminMarketingContent());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const query = search.trim().toLowerCase();
  const filtered = contents
    .filter((c) => typeFilter === 'all' || c.type === typeFilter)
    .filter(
      (c) =>
        !query ||
        (c.title ?? '').toLowerCase().includes(query) ||
        (c.subtitle ?? '').toLowerCase().includes(query) ||
        (c.badge ?? '').toLowerCase().includes(query)
    )
    .sort(
      (a, b) =>
        a.type.localeCompare(b.type) ||
        a.sortOrder - b.sortOrder ||
        a.id.localeCompare(b.id)
    );

  const { page, setPage, totalPages, pageItems, from, to, total } =
    usePagination(filtered, ADMIN_PAGE_SIZE, `${search}|${typeFilter}`);

  const openCreate = () => {
    setEditing(null);
    setFormType(typeFilter === 'banner' ? 'banner' : 'hero');
    setImageUrl('');
    setBadge('');
    setTitle('');
    setSubtitle('');
    setDescription('');
    setCtaText('Belanja Sekarang');
    setCtaUrl('/senjamart/products');
    setIsActive(true);
    setSortOrder(
      contents
        .filter((c) => c.type === (typeFilter === 'banner' ? 'banner' : 'hero'))
        .reduce((max, c) => Math.max(max, c.sortOrder), 0) + 1
    );
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (content: MarketingContent) => {
    setEditing(content);
    setFormType(content.type);
    setImageUrl(content.imageUrl);
    setBadge(content.badge ?? '');
    setTitle(content.title ?? '');
    setSubtitle(content.subtitle ?? '');
    setDescription(content.description ?? '');
    setCtaText(content.ctaText ?? '');
    setCtaUrl(content.ctaUrl ?? '');
    setIsActive(content.isActive);
    setSortOrder(content.sortOrder);
    setFormError(null);
    setFormOpen(true);
  };

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFormError(null);
    try {
      setImageUrl(await uploadMarketingImage(file, formType));
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal mengunggah gambar.'
      );
    } finally {
      e.target.value = '';
    }
  };

  const emptyToNull = (value: string): string | null =>
    value.trim() === '' ? null : value.trim();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!imageUrl.trim()) return setFormError('Gambar wajib diunggah.');
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        type: formType,
        imageUrl: imageUrl.trim(),
        badge: emptyToNull(badge),
        title: emptyToNull(title),
        subtitle: emptyToNull(subtitle),
        description: emptyToNull(description),
        ctaText: emptyToNull(ctaText),
        ctaUrl: emptyToNull(ctaUrl),
        isActive,
        sortOrder,
      };
      if (editing) {
        await updateMarketingContent(editing.id, payload);
        setNotice(`Konten ${typeLabels[formType]} diperbarui ✅`);
      } else {
        await createMarketingContent(payload);
        setNotice(`Konten ${typeLabels[formType]} dibuat ✅`);
      }
      setFormOpen(false);
      void load();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Gagal menyimpan konten.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (content: MarketingContent) => {
    setActionError(null);
    try {
      await setMarketingContentActive(content.id, !content.isActive);
      setNotice(
        content.isActive
          ? `${typeLabels[content.type]} dinonaktifkan (tidak tampil di homepage).`
          : `${typeLabels[content.type]} diaktifkan.`
      );
      void load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengubah status.'
      );
    }
  };

  const handleDelete = async (content: MarketingContent) => {
    if (!window.confirm(`Hapus konten ${typeLabels[content.type]} ini?`))
      return;
    setActionError(null);
    try {
      await deleteMarketingContent(content.id);
      await deleteMarketingImage(content.imageUrl);
      setNotice(`${typeLabels[content.type]} dihapus.`);
      void load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal menghapus konten.'
      );
    }
  };

  const sameTypeSorted = (type: MarketingContentType) =>
    contents
      .filter((c) => c.type === type)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const hasNeighbor = (content: MarketingContent, dir: -1 | 1): boolean => {
    const sameType = sameTypeSorted(content.type);
    const idx = sameType.findIndex((c) => c.id === content.id);
    return idx >= 0 && Boolean(sameType[idx + dir]);
  };

  const handleMove = async (content: MarketingContent, dir: -1 | 1) => {
    setActionError(null);
    const sameType = sameTypeSorted(content.type);
    const idx = sameType.findIndex((c) => c.id === content.id);
    const neighbor = sameType[idx + dir];
    if (!neighbor) return;
    try {
      await Promise.all([
        updateMarketingContent(content.id, {
          type: content.type,
          sortOrder: neighbor.sortOrder,
        }),
        updateMarketingContent(neighbor.id, {
          type: neighbor.type,
          sortOrder: content.sortOrder,
        }),
      ]);
      setNotice('Urutan konten diperbarui.');
      void load();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Gagal mengubah urutan.'
      );
    }
  };

  const tabs: { value: TypeFilter; label: string }[] = [
    { value: 'all', label: 'Semua' },
    { value: 'hero', label: 'Hero Slider' },
    { value: 'banner', label: 'Banner' },
  ];

  return (
    <AdminGuard>
      <div className="mt-3">
        <PageHeader
          title="Marketing"
          description={
            <>
              Hero Slider & banner homepage dari tabel{' '}
              <code className="font-mono">marketing_content</code> di Supabase
              — tampil langsung di homepage.
            </>
          }
          actions={
            <>
              <SearchInput
                id="adminMarketingSearch"
                placeholder="Cari konten..."
                value={search}
                onChange={setSearch}
              />
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600"
              >
                + Tambah Konten
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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTypeFilter(tab.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
                typeFilter === tab.value
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {formOpen && (
          <Card extra="mb-6 p-6">
            <h3 className="mb-5 text-lg font-bold text-navy-700 dark:text-white">
              {editing
                ? `Edit ${typeLabels[formType]}`
                : 'Tambah Konten Marketing Baru'}
            </h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Tipe Konten *
                  </label>
                  <div className="flex gap-2">
                    {(['hero', 'banner'] as MarketingContentType[]).map(
                      (t) => (
                        <button
                          key={t}
                          type="button"
                          disabled={!!editing}
                          onClick={() => setFormType(t)}
                          className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                            formType === t
                              ? 'bg-brand-500 text-white'
                              : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-400'
                          }`}
                        >
                          {typeLabels[t]}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Gambar *
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
                {formType === 'hero' ? (
                  <>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                        Badge
                      </label>
                      <input
                        value={badge}
                        onChange={(e) => setBadge(e.target.value)}
                        placeholder="cth: Promo Pembukaan — Diskon 50%"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                        Judul
                      </label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Judul utama slide"
                        className={inputClass}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                        Subjudul
                      </label>
                      <textarea
                        rows={2}
                        value={subtitle}
                        onChange={(e) => setSubtitle(e.target.value)}
                        placeholder="Deskripsi singkat slide..."
                        className={inputClass}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                        Judul
                      </label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="cth: Buah & Sayur"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                        Deskripsi
                      </label>
                      <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="cth: Hemat hingga 30% untuk sayur dan buah segar"
                        className={inputClass}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Teks CTA
                  </label>
                  <input
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    placeholder="cth: Belanja Sekarang"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    URL CTA
                  </label>
                  <input
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    placeholder="cth: /senjamart/products"
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
                    onChange={(e) =>
                      setSortOrder(Number(e.target.value) || 0)
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
                    Status
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 pt-2.5 text-sm font-medium text-navy-700 dark:text-white">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                      className="h-4 w-4 accent-brand-500"
                    />
                    Aktif (tampil di homepage)
                  </label>
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
                  {saving ? 'Menyimpan...' : editing ? 'Simpan' : 'Buat Konten'}
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
                  <th className="px-3 pb-3 text-start">Tipe</th>
                  <th className="px-3 pb-3 text-start">Gambar</th>
                  <th className="px-3 pb-3 text-start">Judul</th>
                  <th className="px-3 pb-3 text-start">Urutan</th>
                  <th className="px-3 pb-3 text-start">Status</th>
                  <th className="px-3 pb-3 text-end">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6}>
                      <LoadingState label="Memuat konten..." />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6}>
                      <EmptyState
                        icon="🎨"
                        title={
                          query
                            ? 'Tidak ditemukan konten yang cocok.'
                            : `Belum ada konten ${
                                typeFilter === 'all' ? '' : typeLabels[typeFilter]
                              }.`
                        }
                        description="Tambahkan melalui tombol di atas."
                      />
                    </td>
                  </tr>
                ) : (
                  pageItems.map((content) => (
                    <tr
                      key={content.id}
                      className="border-b border-gray-100 transition-colors hover:bg-gray-50 dark:border-navy-700 dark:hover:bg-navy-800"
                    >
                      <td className="px-3 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-1 text-xs font-bold ${typeBadge[content.type]}`}
                        >
                          {typeLabels[content.type]}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="relative h-10 w-16 shrink-0 overflow-hidden rounded-lg">
                          <Image
                            src={content.imageUrl}
                            alt={content.title ?? 'Konten'}
                            fill
                            sizes="64px"
                            className="object-cover"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-3 text-sm font-semibold text-navy-700 dark:text-white">
                        {content.title ?? '—'}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400">
                          <button
                            type="button"
                            aria-label="Naikkan urutan"
                            disabled={!hasNeighbor(content, -1)}
                            onClick={() => handleMove(content, -1)}
                            className="rounded px-1.5 py-0.5 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-navy-700 dark:hover:text-white"
                          >
                            ↑
                          </button>
                          <span className="w-6 text-center font-semibold">
                            {content.sortOrder}
                          </span>
                          <button
                            type="button"
                            aria-label="Turunkan urutan"
                            disabled={!hasNeighbor(content, 1)}
                            onClick={() => handleMove(content, 1)}
                            className="rounded px-1.5 py-0.5 text-xs font-bold text-gray-400 transition-colors hover:bg-gray-100 hover:text-navy-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-navy-700 dark:hover:text-white"
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(content)}
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                            !content.isActive
                              ? 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700'
                              : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-500/20 dark:text-green-400'
                          }`}
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              !content.isActive ? 'bg-gray-400' : 'bg-green-500'
                            }`}
                          />
                          {content.isActive ? 'Aktif' : 'Nonaktif'}
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(content)}
                            className="rounded-lg px-3 py-1.5 text-xs font-bold text-brand-500 transition-colors hover:bg-brand-50 dark:hover:bg-brand-500/10"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(content)}
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

export default function MarketingAdminPage() {
  return <MarketingContent />;
}
