/** Format a number as Indonesian Rupiah, e.g. 18000 -> "Rp 18.000". */
export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

/** Format a date to Indonesian locale, e.g. "12 Agustus 2026". */
export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

/** Compute discount percentage between compareAtPrice and price. */
export function discountPercent(price: number, compareAtPrice?: number | null): number | null {
  if (!compareAtPrice || compareAtPrice <= price) return null;
  return Math.round(((compareAtPrice - price) / compareAtPrice) * 100);
}
