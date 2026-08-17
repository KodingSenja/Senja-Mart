'use client';

import Link from 'next/link';
import { useAuth } from 'contexts/AuthContext';

export default function TopNavbar() {
  const { user } = useAuth();
  return (
    <div className="bg-fresh-gray-100 py-1.5 font-inter">
      <div className="container mx-auto max-w-[1320px] px-4">
        <div className="flex flex-wrap items-center justify-between">
          <div className="w-full text-center md:w-1/2 md:text-left">
            <span className="text-sm font-medium text-fresh-gray-700">
              Promo Spesial — Hemat lebih banyak dengan kupon Senja Mart 🎉
            </span>
          </div>
          <div className="hidden w-1/2 items-center justify-end gap-4 lg:flex">
            <span className="flex items-center gap-1.5 text-sm font-medium text-fresh-gray-600">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-fresh-green-600"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              Aman & Terpercaya
            </span>
            {user ? (
              <Link
                href="/senjamart/profile"
                className="flex items-center gap-1.5 text-sm font-medium text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
              >
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
                  <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                  <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                </svg>
                {user.name || user.email}
              </Link>
            ) : (
              <Link
                href="/senjamart/login"
                className="flex items-center gap-1.5 text-sm font-medium text-fresh-gray-600 transition-colors hover:text-fresh-green-600"
              >
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
                  <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
                  <path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
                </svg>
                Masuk
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
