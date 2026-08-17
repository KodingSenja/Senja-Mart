'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useCart } from 'contexts/CartContext';
import { useAuth } from 'contexts/AuthContext';
import { createOrder } from 'lib/services/orders';
import { formatRupiah } from 'lib/utils/format';
import { shippingCost } from 'lib/utils/constants';
import PayNow, { type PaymentResult } from 'components/senjamart/PayNow';

export default function CheckoutPage() {
  const { cart, subtotal, clearCart } = useCart();
  const { user, loading: authLoading } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<{
    id: string;
    total: number;
  } | null>(null);
  const [payResult, setPayResult] = useState<PaymentResult | null>(null);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    city: '',
    postalCode: '',
    notes: '',
  });

  const shipping = shippingCost(subtotal);
  const total = subtotal + shipping;

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-fresh-gray-300 border-t-fresh-green-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <span className="text-5xl">🔐</span>
        <h1 className="mt-4 text-2xl font-bold text-fresh-gray-900">
          Masuk untuk Checkout
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-fresh-gray-500">
          Buat pesanan dengan akun Senja Mart agar riwayat pesanan tersimpan
          dan bisa dilacak.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/senjamart/login?redirect=/senjamart/checkout"
            className="inline-flex items-center rounded-lg bg-fresh-green-600 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
          >
            Masuk / Daftar
          </Link>
          <Link
            href="/senjamart/cart"
            className="inline-flex items-center rounded-lg border border-fresh-gray-300 px-6 py-3 text-sm font-semibold text-fresh-gray-700 transition-colors hover:border-fresh-green-600 hover:text-fresh-green-700"
          >
            ← Kembali ke Keranjang
          </Link>
        </div>
      </div>
    );
  }

  if (createdOrder) {
    const resultTone =
      payResult?.status === 'paid'
        ? 'border-fresh-green-600/30 bg-fresh-green-50 text-fresh-green-800'
        : payResult?.status === 'error' ||
          payResult?.status === 'failed' ||
          payResult?.status === 'denied'
        ? 'border-fresh-red-600/30 bg-fresh-red-50 text-fresh-red-600'
        : 'border-fresh-yellow-500/30 bg-fresh-yellow-500/10 text-fresh-yellow-500';

    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-8">
        <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">
          Pembayaran
        </h1>
        <div className="mx-auto max-w-md rounded-lg border border-fresh-gray-200 p-6 text-center">
          <span className="text-5xl">💳</span>
          <h2 className="mt-4 text-lg font-bold text-fresh-gray-900">
            Pesanan berhasil dibuat!
          </h2>
          <p className="mt-2 text-sm text-fresh-gray-500">
            Selesaikan pembayaran di bawah ini agar pesanan Anda dapat kami
            proses.
          </p>

          <dl className="mt-4 flex items-center justify-between rounded-lg bg-fresh-gray-50 px-4 py-3 text-sm">
            <dt className="text-fresh-gray-500">Total Pembayaran</dt>
            <dd className="font-bold text-fresh-gray-900">
              {formatRupiah(createdOrder.total)}
            </dd>
          </dl>

          {payResult?.status !== 'paid' && (
            <div className="mt-5">
              <PayNow orderId={createdOrder.id} onResult={setPayResult} />
            </div>
          )}

          {payResult && (
            <div
              className={`mt-4 rounded-lg border px-4 py-3 text-xs font-medium ${resultTone}`}
            >
              {payResult.message}
            </div>
          )}

          <div className="mt-5 flex flex-col gap-2">
            <Link
              href="/senjamart/orders"
              className="inline-flex w-full items-center justify-center rounded-lg border border-fresh-gray-300 px-5 py-3 text-sm font-semibold text-fresh-gray-700 transition-colors hover:border-fresh-green-600 hover:text-fresh-green-700"
            >
              Lihat Pesanan Saya
            </Link>
            <Link
              href="/senjamart/products"
              className="text-center text-xs text-fresh-gray-400 transition-colors hover:text-fresh-green-600"
            >
              Lanjut Belanja
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <span className="text-5xl">🧾</span>
        <h1 className="mt-4 text-2xl font-bold text-fresh-gray-900">
          Keranjang kosong
        </h1>
        <p className="mt-2 text-sm text-fresh-gray-500">
          Tambahkan produk terlebih dahulu sebelum melakukan checkout.
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

  const update = (field: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const order = await createOrder({
        items: cart.items.map((i) => ({
          productId: i.productId,
          name: i.product.name,
          price: i.product.price,
          quantity: i.quantity,
          image: i.product.image,
        })),
        subtotal,
        shippingCost: shipping,
        total,
        shippingAddress: {
          name: form.name,
          phone: form.phone,
          address: form.address,
          city: form.city,
          postalCode: form.postalCode,
          notes: form.notes || undefined,
        },
      });
      clearCart();
      setPayResult(null);
      setCreatedOrder({ id: order.id, total: order.total });
    } catch {
      setError(
        'Gagal membuat pesanan. Silakan coba lagi atau hubungi layanan pelanggan.'
      );
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-fresh-gray-300 px-3 py-2.5 text-sm text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25';

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-fresh-gray-900">Checkout</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-8 lg:flex-row">
        {/* Shipping form */}
        <div className="flex-1">
          <div className="rounded-lg border border-fresh-gray-200 p-6">
            <h2 className="mb-5 text-lg font-bold text-fresh-gray-900">
              Alamat Pengiriman
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="checkoutName"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Nama Penerima
                </label>
                <input
                  id="checkoutName"
                  required
                  value={form.name}
                  onChange={update('name')}
                  placeholder="Nama lengkap"
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="checkoutPhone"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  No. HP / WhatsApp
                </label>
                <input
                  id="checkoutPhone"
                  required
                  type="tel"
                  value={form.phone}
                  onChange={update('phone')}
                  placeholder="08xxxxxxxxxx"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="checkoutAddress"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Alamat Lengkap
                </label>
                <textarea
                  id="checkoutAddress"
                  required
                  rows={3}
                  value={form.address}
                  onChange={update('address')}
                  placeholder="Nama jalan, nomor rumah, RT/RW, kelurahan..."
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="checkoutCity"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Kota / Kabupaten
                </label>
                <input
                  id="checkoutCity"
                  required
                  value={form.city}
                  onChange={update('city')}
                  placeholder="Kota"
                  className={inputClass}
                />
              </div>
              <div>
                <label
                  htmlFor="checkoutPostal"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Kode Pos
                </label>
                <input
                  id="checkoutPostal"
                  required
                  inputMode="numeric"
                  value={form.postalCode}
                  onChange={update('postalCode')}
                  placeholder="12345"
                  className={inputClass}
                />
              </div>
              <div className="sm:col-span-2">
                <label
                  htmlFor="checkoutNotes"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Catatan (opsional)
                </label>
                <input
                  id="checkoutNotes"
                  value={form.notes}
                  onChange={update('notes')}
                  placeholder="Catatan untuk kurir"
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Order summary */}
        <aside className="w-full shrink-0 lg:w-96">
          <div className="rounded-lg border border-fresh-gray-200 p-6">
            <h2 className="mb-4 text-lg font-bold text-fresh-gray-900">
              Pesanan Anda
            </h2>

            <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
              {cart.items.map((item) => (
                <li key={item.productId} className="flex items-center gap-3">
                  <div className="relative shrink-0">
                    <Image
                      src={item.product.image}
                      alt={item.product.name}
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-fresh-gray-900 text-[10px] font-bold text-white">
                      {item.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-fresh-gray-900">
                      {item.product.name}
                    </div>
                    <div className="text-xs text-fresh-gray-500">
                      {formatRupiah(item.product.price)} × {item.quantity}
                    </div>
                  </div>
                  <div className="text-sm font-semibold text-fresh-gray-900">
                    {formatRupiah(item.product.price * item.quantity)}
                  </div>
                </li>
              ))}
            </ul>

            <dl className="mt-5 flex flex-col gap-3 border-t border-fresh-gray-200 pt-4 text-sm">
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

            {error && (
              <div className="mt-5 rounded-lg bg-fresh-red-50 px-4 py-3 text-xs font-medium text-fresh-red-600">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-fresh-green-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Memproses...' : 'Buat Pesanan'}
            </button>
            <p className="mt-3 text-center text-xs text-fresh-gray-400">
              Dengan membuat pesanan, Anda menyetujui syarat & ketentuan Senja
              Mart.
            </p>
          </div>
        </aside>
      </form>
    </div>
  );
}
