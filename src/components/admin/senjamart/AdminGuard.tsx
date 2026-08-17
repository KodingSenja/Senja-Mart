'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { getCurrentUser } from 'lib/services/auth';

export default function AdminGuard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'admin' | 'denied'>('loading');

  useEffect(() => {
    let active = true;
    getCurrentUser()
      .then((user) => {
        if (!active) return;
        setState(user?.role === 'admin' ? 'admin' : 'denied');
      })
      .catch(() => {
        if (active) setState('denied');
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-navy-200 border-t-brand-500" />
      </div>
    );
  }

  if (state === 'denied') {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-[20px] bg-white p-8 text-center shadow-md shadow-shadow-500 dark:!bg-navy-700">
        <span className="text-5xl">🔒</span>
        <h2 className="mt-4 text-xl font-bold text-navy-700 dark:text-white">
          Akses Khusus Admin
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          Halaman ini hanya bisa diakses oleh akun dengan peran{' '}
          <strong>admin</strong>. Masuk dengan akun admin terlebih dahulu.
        </p>
        <Link
          href="/senjamart/login?redirect=/admin/senjamart"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-white transition-all hover:bg-brand-600"
        >
          Masuk sebagai Admin
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
