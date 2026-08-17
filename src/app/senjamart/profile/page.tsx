'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useAuth } from 'contexts/AuthContext';
import { updateProfile, signOut } from 'lib/services/auth';
import { useRouter } from 'next/navigation';

const menu = [
  {
    label: 'Pesanan Saya',
    href: '/senjamart/orders',
    icon: (
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
        <path d="M7 16.5l-1.7 1.3a1.5 1.5 0 0 1 -1.8 0l-1.7 -1.3" />
        <path d="M21 16.5l-1.7 1.3a1.5 1.5 0 0 1 -1.8 0l-1.7 -1.3" />
        <path d="M2.7 14.5a1.5 1.5 0 0 1 .8 -1.3l1.6 -.9a1.5 1.5 0 0 0 .8 -1.3v-4a5 5 0 0 1 5 -5h3a5 5 0 0 1 5 5v4a1.5 1.5 0 0 0 .8 1.3l1.6 .9a1.5 1.5 0 0 1 .8 1.3v2a1.5 1.5 0 0 1 -1.5 1.5h-17a1.5 1.5 0 0 1 -1.5 -1.5z" />
      </svg>
    ),
  },
];

export default function ProfilePage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initial = user?.name || user?.email || 'P';

  if (loading) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-20 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-fresh-gray-300 border-t-fresh-green-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="container mx-auto max-w-[1320px] px-4 py-12">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-4 rounded-2xl border border-fresh-gray-200 p-6">
            <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-fresh-green-100 text-2xl font-bold text-fresh-green-700">
              P
            </span>
            <div>
              <h1 className="text-xl font-bold text-fresh-gray-900">
                Pengunjung
              </h1>
              <p className="text-sm text-fresh-gray-500">
                Belum masuk.{' '}
                <Link
                  href="/senjamart/login?redirect=/senjamart/profile"
                  className="font-medium text-fresh-green-700 hover:text-fresh-green-600"
                >
                  Masuk untuk menyinkronkan akun Anda.
                </Link>
              </p>
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-fresh-gray-200">
            <Link
              href="/senjamart/orders"
              className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-fresh-gray-50"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-fresh-gray-100 text-fresh-green-600">
                {menu[0].icon}
              </span>
              <span className="flex-1 text-sm font-semibold text-fresh-gray-900">
                {menu[0].label}
              </span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-fresh-gray-300"
              >
                <path d="M9 6l6 6l-6 6" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ full_name: name || undefined, phone: phone || undefined });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan profil.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-fresh-gray-300 px-3 py-2.5 text-sm text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25';

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="flex items-center gap-4 rounded-2xl border border-fresh-gray-200 p-6">
          <span className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-fresh-green-100 text-2xl font-bold text-fresh-green-700">
            {initial.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-bold text-fresh-gray-900">
              {user.name || 'Pengguna'}
            </h1>
            <p className="truncate text-sm text-fresh-gray-500">{user.email}</p>
            {user.role === 'admin' && (
              <span className="mt-1 inline-flex rounded-full bg-fresh-green-50 px-2.5 py-0.5 text-xs font-semibold text-fresh-green-700">
                Admin
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={async () => {
              await signOut();
              await refresh();
              router.replace('/senjamart');
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-fresh-gray-300 px-4 py-2 text-sm font-semibold text-fresh-gray-700 transition-colors hover:border-fresh-red-500 hover:text-fresh-red-600"
          >
            Keluar
          </button>
        </div>

        {/* Edit profile */}
        <form
          onSubmit={handleSave}
          className="mt-6 rounded-2xl border border-fresh-gray-200 p-6"
        >
          <h2 className="mb-4 text-base font-bold text-fresh-gray-900">
            Data Profil
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="profileName"
                className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
              >
                Nama Lengkap
              </label>
              <input
                id="profileName"
                value={name || user.name || ''}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama Anda"
                className={inputClass}
              />
            </div>
            <div>
              <label
                htmlFor="profilePhone"
                className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
              >
                No. HP / WhatsApp
              </label>
              <input
                id="profilePhone"
                type="tel"
                value={phone || user.phone || ''}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className={inputClass}
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-lg bg-fresh-red-50 px-4 py-3 text-xs font-medium text-fresh-red-600">
              {error}
            </div>
          )}
          {saved && (
            <div className="mt-4 rounded-lg bg-fresh-green-50 px-4 py-3 text-xs font-medium text-fresh-green-800">
              Profil berhasil disimpan ✅
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <Link
              href="/senjamart/orders"
              className="inline-flex items-center gap-2 rounded-lg border border-fresh-gray-300 px-4 py-2.5 text-sm font-semibold text-fresh-gray-700 transition-colors hover:border-fresh-green-600 hover:text-fresh-green-700"
            >
              {menu[0].icon}
              Pesanan Saya
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg bg-fresh-green-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Menyimpan...' : 'Simpan Profil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
