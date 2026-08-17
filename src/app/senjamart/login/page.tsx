'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { signIn, signUp } from 'lib/services/auth';
import { useAuth } from 'contexts/AuthContext';

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const redirectTo =
    searchParams.get('redirect') || '/senjamart/profile';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await signIn(email, password);
        await refresh();
        router.replace(redirectTo);
      } else {
        const { needsConfirmation } = await signUp(email, password, name);
        if (needsConfirmation) {
          setNotice(
            'Pendaftaran berhasil! Silakan cek email Anda untuk konfirmasi sebelum masuk.'
          );
        } else {
          await refresh();
          router.replace(redirectTo);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-fresh-gray-300 px-3 py-2.5 text-sm text-fresh-gray-900 placeholder:text-fresh-gray-400 focus:border-fresh-green-600 focus:outline-none focus:ring-4 focus:ring-fresh-green-600/25';

  return (
    <div className="container mx-auto max-w-[1320px] px-4 py-12">
      <div className="mx-auto grid max-w-4xl overflow-hidden rounded-2xl border border-fresh-gray-200 bg-white shadow-sm lg:grid-cols-2">
        {/* Info panel */}
        <div
          className="relative hidden flex-col justify-between bg-cover bg-center p-10 lg:flex"
          style={{ backgroundImage: "url('/senjamart/banner/grocery-banner.png')" }}
        >
          <div className="absolute inset-0 bg-fresh-gray-950/70" />
          <div className="relative z-10">
            <h2 className="text-2xl font-bold text-white">
              Selamat Datang di Senja Mart
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-white/80">
              Belanja kebutuhan segar & harian dengan harga terbaik, dikirim
              cepat ke depan pintu Anda.
            </p>
          </div>
          <div className="relative z-10 flex flex-col gap-3 text-sm text-white/90">
            <span className="flex items-center gap-2">
              <span className="text-fresh-green-500">✓</span> Gratis ongkir
              min. belanja Rp 300.000
            </span>
            <span className="flex items-center gap-2">
              <span className="text-fresh-green-500">✓</span> Pembayaran aman &
              terenkripsi
            </span>
            <span className="flex items-center gap-2">
              <span className="text-fresh-green-500">✓</span> Retur mudah tanpa
              syarat ribet
            </span>
          </div>
        </div>

        {/* Form panel */}
        <div className="p-8 lg:p-10">
          <div className="mb-6 flex rounded-lg bg-fresh-gray-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white text-fresh-green-700 shadow-sm'
                  : 'text-fresh-gray-500 hover:text-fresh-gray-800'
              }`}
            >
              Masuk
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError(null);
                setNotice(null);
              }}
              className={`flex-1 rounded-md py-2 text-sm font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white text-fresh-green-700 shadow-sm'
                  : 'text-fresh-gray-500 hover:text-fresh-gray-800'
              }`}
            >
              Daftar
            </button>
          </div>

          <h1 className="text-xl font-bold text-fresh-gray-900">
            {mode === 'login' ? 'Masuk ke Akun Anda' : 'Buat Akun Baru'}
          </h1>
          <p className="mt-1 text-sm text-fresh-gray-500">
            {mode === 'login'
              ? 'Masukkan email dan kata sandi Anda.'
              : 'Daftar untuk menikmati pengalaman belanja terbaik.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            {mode === 'register' && (
              <div>
                <label
                  htmlFor="loginName"
                  className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
                >
                  Nama Lengkap
                </label>
                <input
                  id="loginName"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama Anda"
                  className={inputClass}
                />
              </div>
            )}
            <div>
              <label
                htmlFor="loginEmail"
                className="mb-1.5 block text-sm font-medium text-fresh-gray-700"
              >
                Email
              </label>
              <input
                id="loginEmail"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@email.com"
                className={inputClass}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label
                  htmlFor="loginPassword"
                  className="block text-sm font-medium text-fresh-gray-700"
                >
                  Kata Sandi
                </label>
                {mode === 'login' && (
                  <a
                    href="#!"
                    className="text-xs text-fresh-green-700 hover:text-fresh-green-600"
                  >
                    Lupa kata sandi?
                  </a>
                )}
              </div>
              <input
                id="loginPassword"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </div>

            {error && (
              <div className="rounded-lg bg-fresh-red-50 px-4 py-3 text-xs font-medium text-fresh-red-600">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-lg bg-fresh-green-50 px-4 py-3 text-xs font-medium text-fresh-green-800">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center rounded-lg bg-fresh-green-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-fresh-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting
                ? 'Memproses...'
                : mode === 'login'
                  ? 'Masuk'
                  : 'Daftar'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-fresh-gray-500">
            <Link
              href="/senjamart"
              className="font-medium text-fresh-green-700 hover:text-fresh-green-600"
            >
              ← Kembali ke Beranda
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginContent />
    </Suspense>
  );
}
