'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCart } from 'contexts/CartContext';
import { useAuth } from 'contexts/AuthContext';
import { signOut } from 'lib/services/auth';

const departments = [
  'Susu, Roti & Telur',
  'Snack & Makanan Ringan',
  'Bakery & Biskuit',
  'Makanan Instan',
  'Teh, Kopi & Minuman',
  'Beras & Sembako',
  'Buah & Sayur',
  'Ayam, Daging & Ikan',
];

export default function Navbar() {
  const { itemCount } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [deptOpen, setDeptOpen] = useState(false);
  const [query, setQuery] = useState('');

  const handleLogout = async () => {
    await signOut();
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-50 border-b border-fresh-gray-200 bg-white shadow-sm font-inter">
      <div className="container mx-auto max-w-[1320px] px-4">
        {/* Main bar */}
        <div className="flex flex-wrap items-center justify-between gap-y-4 py-5">
          {/* Logo */}
          <div className="w-2/5 md:w-auto lg:w-1/6">
            <Link
              href="/senjamart"
              className="flex items-center gap-2 text-2xl font-bold tracking-tight text-fresh-gray-900"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-fresh-green-600 text-white">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z" />
                  <path d="M9 11v-5a3 3 0 0 1 6 0v5" />
                </svg>
              </span>
              <span>
                Senja<span className="text-fresh-green-600">Mart</span>
              </span>
            </Link>
          </div>

          {/* Search (desktop) */}
          <div className="hidden lg:block lg:w-2/5">
            <form
              action="/senjamart/products"
              className="relative"
              role="search"
            >
              <label htmlFor="searchProducts" className="sr-only">
                Cari produk
              </label>
              <input
                id="searchProducts"
                name="q"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Cari produk di Senja Mart..."
                className="w-full rounded-lg border border-fresh-gray-300 px-3 py-2.5 text-base text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25"
              />
              <button
                type="submit"
                aria-label="Cari"
                className="absolute right-0 top-0 p-3 text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
              >
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
                  <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                  <path d="M21 21l-6 -6" />
                </svg>
              </button>
            </form>
          </div>

          {/* Icons */}
          <div className="flex w-3/5 items-center justify-end gap-6 text-end md:w-1/2 lg:w-1/5">
            <Link
              href="/senjamart/products"
              aria-label="Wishlist"
              className="hidden text-fresh-gray-600 transition-colors hover:text-fresh-green-600 sm:block"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
              </svg>
            </Link>

            {user ? (
              <div className="group relative hidden sm:block">
                <Link
                  href="/senjamart/profile"
                  aria-label="Akun"
                  className="flex items-center gap-2 text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-fresh-green-100 text-sm font-bold text-fresh-green-700">
                    {(user.name || user.email || 'P').charAt(0).toUpperCase()}
                  </span>
                </Link>
                <div className="invisible absolute right-0 top-full z-50 mt-2 w-48 rounded-lg border border-fresh-gray-200 bg-white p-2 opacity-0 shadow-xl transition-all group-hover:visible group-hover:opacity-100">
                  <div className="px-3 py-2">
                    <div className="truncate text-sm font-semibold text-fresh-gray-900">
                      {user.name || 'Pengguna'}
                    </div>
                    <div className="truncate text-xs text-fresh-gray-500">
                      {user.email}
                    </div>
                  </div>
                  <Link
                    href="/senjamart/profile"
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
                  >
                    Profil Saya
                  </Link>
                  <Link
                    href="/senjamart/orders"
                    className="block rounded-lg px-3 py-2 text-sm font-medium text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
                  >
                    Pesanan Saya
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-fresh-red-600 transition-colors hover:bg-fresh-red-50"
                  >
                    Keluar
                  </button>
                </div>
              </div>
            ) : (
              <Link
                href="/senjamart/login"
                aria-label="Akun"
                className="hidden text-fresh-gray-600 transition-colors hover:text-fresh-green-600 sm:block"
              >
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                  <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                </svg>
              </Link>
            )}

            <Link
              href="/senjamart/cart"
              aria-label="Keranjang"
              className="relative text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
            >
              <svg
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304z" />
                <path d="M9 11v-5a3 3 0 0 1 6 0v5" />
              </svg>
              <span className="absolute -ml-3 -mt-1 left-full top-0 flex h-5 w-5 items-center justify-center rounded-full bg-fresh-green-600 text-center text-xs font-semibold text-white">
                {itemCount}
                <span className="sr-only">item di keranjang</span>
              </span>
            </Link>

            {/* Mobile toggle */}
            <button
              className="lg:hidden"
              type="button"
              aria-label="Buka menu"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((v) => !v)}
            >
              <svg
                className="text-fresh-gray-800"
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 6l16 0" />
                <path d="M4 12l16 0" />
                <path d="M4 18l16 0" />
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile search + menu */}
        {mobileOpen && (
          <div className="border-t border-fresh-gray-200 pb-5 lg:hidden">
            <form
              action="/senjamart/products"
              className="relative mt-4"
              role="search"
            >
              <label htmlFor="searchMobile" className="sr-only">
                Cari produk
              </label>
              <input
                id="searchMobile"
                name="q"
                placeholder="Cari produk di Senja Mart..."
                className="w-full rounded-lg border border-fresh-gray-300 px-3 py-2 text-base text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25"
              />
              <button
                type="submit"
                aria-label="Cari"
                className="absolute right-0 top-0 p-3 text-fresh-gray-600"
              >
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
                  <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                  <path d="M21 21l-6 -6" />
                </svg>
              </button>
            </form>

            <nav className="mt-4 flex flex-col gap-1 text-base font-medium">
              <Link
                href="/senjamart"
                className="rounded-lg px-3 py-2 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
              >
                Beranda
              </Link>
              <Link
                href="/senjamart/products"
                className="rounded-lg px-3 py-2 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
              >
                Semua Produk
              </Link>
              <Link
                href="/senjamart/login"
                className="rounded-lg px-3 py-2 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
              >
                Masuk / Daftar
              </Link>
            </nav>
          </div>
        )}
      </div>

      {/* Category nav (desktop) */}
      <nav className="hidden border-t border-fresh-gray-200 lg:block">
        <div className="container mx-auto flex max-w-[1320px] items-center gap-6 px-4">
          <div className="relative py-3">
            <button
              type="button"
              onClick={() => setDeptOpen((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-fresh-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
                <path d="M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
              </svg>
              Semua Kategori
            </button>

            {deptOpen && (
              <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-lg border border-fresh-gray-200 bg-white p-2 shadow-xl">
                <ul className="flex flex-col gap-0.5">
                  {departments.map((dept) => (
                    <li key={dept}>
                      <Link
                        href="/senjamart/categories/semua"
                        onClick={() => setDeptOpen(false)}
                        className="block rounded-lg px-3 py-2.5 text-sm font-medium text-fresh-gray-700 transition-colors hover:bg-fresh-gray-100 hover:text-fresh-green-600"
                      >
                        {dept}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <ul className="flex items-center gap-6 py-3 text-sm font-semibold">
            <li>
              <Link
                href="/senjamart"
                className="text-fresh-gray-800 transition-colors hover:text-fresh-green-600"
              >
                Beranda
              </Link>
            </li>
            <li>
              <Link
                href="/senjamart/products"
                className="text-fresh-gray-800 transition-colors hover:text-fresh-green-600"
              >
                Belanja
              </Link>
            </li>
            <li>
              <Link
                href="/senjamart/orders"
                className="text-fresh-gray-800 transition-colors hover:text-fresh-green-600"
              >
                Pesanan Saya
              </Link>
            </li>
            <li>
              <Link
                href="/senjamart/cart"
                className="text-fresh-gray-800 transition-colors hover:text-fresh-green-600"
              >
                Keranjang
              </Link>
            </li>
            <li>
              <Link
                href="/senjamart/profile"
                className="text-fresh-gray-800 transition-colors hover:text-fresh-green-600"
              >
                Profil
              </Link>
            </li>
          </ul>
        </div>
      </nav>
    </header>
  );
}
