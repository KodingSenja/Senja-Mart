/** Minimal belanja agar ongkos kirim gratis (Rupiah). */
export const FREE_SHIPPING_THRESHOLD = 300000;

/** Ongkos kirim flat ketika subtotal di bawah ambang gratis (Rupiah). */
export const SHIPPING_COST = 12000;

/** Hitung ongkos kirim berdasarkan subtotal. */
export function shippingCost(subtotal: number): number {
  if (subtotal <= 0 || subtotal >= FREE_SHIPPING_THRESHOLD) return 0;
  return SHIPPING_COST;
}

/** Jumlah baris per halaman di dashboard admin (client-side pagination). */
export const ADMIN_PAGE_SIZE = 20;
