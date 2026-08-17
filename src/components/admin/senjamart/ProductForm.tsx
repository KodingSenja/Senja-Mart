'use client';

import Image from 'next/image';
import { useState, type FormEvent } from 'react';
import type { Category } from 'types/category';
import type { Product, ProductBadge } from 'types/product';
import { createProduct, updateProduct } from 'lib/services/products';
import { uploadProductImage, deleteStorageObject } from 'lib/services/storage';
import { formatRupiah } from 'lib/utils/format';

interface ProductFormProps {
  categories: Category[];
  product?: Product | null;
  onSaved: () => void;
  onCancel: () => void;
}

const badges: { value: ProductBadge | ''; label: string }[] = [
  { value: '', label: 'Tidak ada' },
  { value: 'sale', label: 'Diskon' },
  { value: 'hot', label: 'Favorit' },
  { value: 'new', label: 'Baru' },
];

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white dark:placeholder:text-gray-500';

export default function ProductForm({
  categories,
  product,
  onSaved,
  onCancel,
}: ProductFormProps) {
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [price, setPrice] = useState(
    product && product.price != null ? String(product.price) : ''
  );
  const [compareAtPrice, setCompareAtPrice] = useState(
    product?.compareAtPrice != null ? String(product.compareAtPrice) : ''
  );
  const [stock, setStock] = useState(
    product && product.stock != null ? String(product.stock) : '0'
  );
  const [lowStockThreshold, setLowStockThreshold] = useState(
    product && product.lowStockThreshold != null
      ? String(product.lowStockThreshold)
      : '5'
  );
  const [unit, setUnit] = useState(product?.unit ?? '');
  const [categoryId, setCategoryId] = useState(
    product?.categoryId ?? categories[0]?.id ?? ''
  );
  const [badge, setBadge] = useState<ProductBadge | ''>(product?.badge ?? '');
  const [featured, setFeatured] = useState(product?.featured ?? false);
  const [isPopular, setIsPopular] = useState(product?.isPopular ?? false);
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [imageUrls, setImageUrls] = useState<string[]>(
    product?.images?.length
      ? product.images
      : product?.image
        ? [product.image]
        : []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const url = await uploadProductImage(file);
      setImageUrls((prev) => [...prev, url]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengunggah gambar.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const priceNum = Number(price);
    if (!name.trim()) return setError('Nama produk wajib diisi.');
    if (Number.isNaN(priceNum) || priceNum < 0)
      return setError('Harga harus berupa angka valid.');
    if (Number.isNaN(Number(stock)) || Number(stock) < 0)
      return setError('Stok harus berupa angka valid.');
    if (
      Number.isNaN(Number(lowStockThreshold)) ||
      Number(lowStockThreshold) < 0
    )
      return setError('Stok minimum harus berupa angka valid.');
    if (!imageUrls.length) return setError('Tambahkan minimal satu gambar.');

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description,
        price: priceNum,
        compareAtPrice: compareAtPrice ? Number(compareAtPrice) : null,
        stock: Number(stock),
        lowStockThreshold: Number(lowStockThreshold),
        unit,
        categoryId: categoryId || null,
        badge: badge || null,
        featured,
        isPopular,
        isActive,
        imageUrls,
      };
      if (product) {
        await updateProduct(product.id, payload);
      } else {
        await createProduct(payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan produk.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Nama Produk *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cth: Kopi Senja"
            className={inputClass}
          />
        </div>

        <div className="md:col-span-2">
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Deskripsi
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deskripsi produk..."
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Harga (Rp) *
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="15000"
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Harga Coret (Rp)
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={compareAtPrice}
            onChange={(e) => setCompareAtPrice(e.target.value)}
            placeholder={price ? formatRupiah(Number(price) + 3000) : ''}
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Stok *
          </label>
          <input
            type="number"
            min={0}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Perubahan stok tercatat di Riwayat Stok.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Stok Minimum
          </label>
          <input
            type="number"
            min={0}
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value)}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-gray-400">
            Di bawah angka ini produk ditandai "Stok Menipis".
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Satuan
          </label>
          <input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="cth: 250 g"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Kategori
          </label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputClass}
          >
            <option value="">Tanpa kategori</option>
            {categoryId &&
              !categories.some((c) => c.id === categoryId) && (
                <option value={categoryId} disabled>
                  (Kategori tidak ditemukan)
                </option>
              )}
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
            Badge
          </label>
          <select
            value={badge}
            onChange={(e) => setBadge(e.target.value as ProductBadge | '')}
            className={inputClass}
          >
            {badges.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Toggles */}
      <div className="flex flex-wrap items-center gap-6">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-navy-700 dark:text-white">
          <input
            type="checkbox"
            checked={featured}
            onChange={(e) => setFeatured(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Produk Unggulan
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-navy-700 dark:text-white">
          <input
            type="checkbox"
            checked={isPopular}
            onChange={(e) => setIsPopular(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Produk Populer
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-navy-700 dark:text-white">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Aktif (tampil di toko)
        </label>
      </div>

      {/* Images */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-navy-700 dark:text-white">
          Gambar Produk *
        </label>
        <div className="flex flex-wrap items-center gap-3">
          {imageUrls.map((url) => (
            <div
              key={url}
              className="relative h-20 w-20 overflow-hidden rounded-lg border border-gray-200 dark:border-navy-600"
            >
              <Image src={url} alt="" fill sizes="80px" className="object-cover" />                <button
                  type="button"
                  aria-label="Hapus gambar"
                  onClick={() => {
                    setImageUrls((prev) => prev.filter((u) => u !== url));
                    void deleteStorageObject(url);
                  }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs text-white hover:bg-red-600"
                >
                  ×
                </button>
            </div>
          ))}
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 transition-colors hover:border-brand-500 hover:text-brand-500 dark:border-navy-600">
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
            <span className="text-[10px]">Upload</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
          </label>
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Gambar disimpan di Supabase Storage (bucket{' '}
          <code className="font-mono">product-images</code>).
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:bg-red-500/10">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 border-t border-gray-100 pt-5 dark:border-navy-700">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl px-5 py-2.5 text-sm font-bold text-gray-500 transition-colors hover:text-navy-700 dark:hover:text-white"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition-all hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? 'Menyimpan...' : product ? 'Simpan Perubahan' : 'Buat Produk'}
        </button>
      </div>
    </form>
  );
}
