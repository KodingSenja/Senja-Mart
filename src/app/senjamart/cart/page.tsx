'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCart } from 'contexts/CartContext';
import { formatRupiah } from 'lib/utils/format';
import {
  FREE_SHIPPING_THRESHOLD,
  shippingCost,
} from 'lib/utils/constants';

export default function CartPage() {
  const { cart, updateQuantity, removeItem, clearCart, subtotal } = useCart();

  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
  const shipping = shippingCost(subtotal);
  const total = subtotal + shipping;

  if (cart.items.length === 0) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <span className="text-5xl">🛒</span>
        <h1 className="mt-4 text-2xl font-bold text-fresh-gray-900">
          Keranjang belanja Anda masih kosong
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-fresh-gray-500">
          Yuk mulai belanja kebutuhan segar & harian Anda di Senja Mart.
        </p>
        <Link
          href="/senjamart/products"
          className="mt-8 inline-flex items-center rounded-lg bg-fresh-green-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
        >
          Mulai Belanja
        </Link>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">
        Keranjang Belanja
      </h1>

      <div className="flex flex-col gap-8 lg:flex-row">
        {/* Items */}
        <div className="flex-1">
          <ul className="flex flex-col gap-4">
            {cart.items.map((item) => (
              <li
                key={item.productId}
                className="flex flex-wrap items-center gap-4 rounded-lg border border-fresh-gray-200 p-4"
              >
                <Link
                  href={`/senjamart/products/${item.product.slug}`}
                  className="shrink-0 overflow-hidden rounded-lg"
                >
                  <Image
                    src={item.product.image}
                    alt={item.product.name}
                    width={80}
                    height={80}
                    className="h-20 w-20 object-cover"
                  />
                </Link>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/senjamart/products/${item.product.slug}`}
                    className="block truncate text-sm font-semibold text-fresh-gray-900 hover:text-fresh-green-600"
                  >
                    {item.product.name}
                  </Link>
                  <span className="text-xs text-fresh-gray-500">
                    {item.product.unit}
                  </span>
                  <div className="mt-1 text-sm font-semibold text-fresh-gray-900">
                    {formatRupiah(item.product.price)}
                  </div>
                </div>

                {/* Quantity */}
                <div className="flex items-center rounded-lg border border-fresh-gray-300">
                  <button
                    type="button"
                    aria-label="Kurangi jumlah"
                    onClick={() =>
                      updateQuantity(item.productId, item.quantity - 1)
                    }
                    className="px-3 py-2 text-base font-semibold text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-sm font-semibold text-fresh-gray-900">
                    {item.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Tambah jumlah"
                    onClick={() =>
                      updateQuantity(item.productId, item.quantity + 1)
                    }
                    className="px-3 py-2 text-base font-semibold text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100"
                  >
                    +
                  </button>
                </div>

                <div className="w-24 text-right">
                  <div className="text-sm font-bold text-fresh-gray-900">
                    {formatRupiah(item.product.price * item.quantity)}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label="Hapus item"
                  onClick={() => removeItem(item.productId)}
                  className="text-fresh-gray-400 transition-colors hover:text-fresh-red-600"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 7l16 0" />
                    <path d="M10 11l0 6" />
                    <path d="M14 11l0 6" />
                    <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                    <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 flex items-center justify-between">
            <Link
              href="/senjamart/products"
              className="text-sm font-semibold text-fresh-green-700 transition-colors hover:text-fresh-green-600"
            >
              ← Lanjut Belanja
            </Link>
            <button
              type="button"
              onClick={clearCart}
              className="text-sm text-fresh-gray-500 transition-colors hover:text-fresh-red-600"
            >
              Kosongkan Keranjang
            </button>
          </div>
        </div>

        {/* Summary */}
        <aside className="w-full shrink-0 lg:w-96">
          <div className="rounded-lg border border-fresh-gray-200 p-6">
            <h2 className="mb-4 text-lg font-bold text-fresh-gray-900">
              Ringkasan Belanja
            </h2>

            {remaining > 0 && (
              <div className="mb-4 rounded-lg bg-fresh-green-50 px-4 py-3 text-xs text-fresh-green-800">
                Belanja {formatRupiah(remaining)} lagi untuk mendapatkan
                <strong> gratis ongkir</strong> 🚚
              </div>
            )}

            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-fresh-gray-500">Subtotal</dt>
                <dd className="font-semibold text-fresh-gray-900">
                  {formatRupiah(subtotal)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-fresh-gray-500">Ongkos Kirim</dt>
                <dd className="font-semibold text-fresh-gray-900">
                  {shipping === 0 ? 'Gratis' : formatRupiah(shipping)}
                </dd>
              </div>
              <div className="flex items-center justify-between border-t border-fresh-gray-200 pt-3 text-base">
                <dt className="font-bold text-fresh-gray-900">Total</dt>
                <dd className="font-bold text-fresh-gray-900">
                  {formatRupiah(total)}
                </dd>
              </div>
            </dl>

            <Link
              href="/senjamart/checkout"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fresh-green-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
            >
              Lanjut ke Checkout
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l14 0" />
                <path d="M13 18l6 -6" />
                <path d="M13 6l6 6" />
              </svg>
            </Link>

            <p className="mt-3 text-center text-xs text-fresh-gray-400">
              Metode pembayaran aman & terenkripsi
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
