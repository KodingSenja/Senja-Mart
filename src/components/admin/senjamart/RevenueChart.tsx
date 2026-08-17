'use client';

import { useState } from 'react';
import type { RevenuePoint } from 'lib/services/dashboard';
import { formatRupiah } from 'lib/utils/format';

type Period = 7 | 30;

function shortDate(date: string): string {
  // yyyy-mm-dd → dd/mm
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/**
 * Dependency-free bar chart of revenue per day (Horizon-styled).
 * The data passed in is the full 30-day series; the 7/30 toggle just
 * slices it — no extra query, no chart library needed.
 */
export default function RevenueChart({ data }: { data: RevenuePoint[] }) {
  const [period, setPeriod] = useState<Period>(7);
  const points = data.slice(-period);
  const max = Math.max(1, ...points.map((p) => p.revenue));
  const hasRevenue = points.some((p) => p.revenue > 0);

  const periodBtn = (p: Period, label: string) => (
    <button
      type="button"
      onClick={() => setPeriod(p)}
      className={`rounded-full px-4 py-1.5 text-sm font-bold transition-colors ${
        period === p
          ? 'bg-brand-500 text-white'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-navy-700 dark:text-gray-400'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold text-navy-700 dark:text-white">
          Grafik Omzet
        </h3>
        <div className="flex items-center gap-2">
          {periodBtn(7, '7 Hari')}
          {periodBtn(30, '30 Hari')}
        </div>
      </div>

      {!hasRevenue ? (
        <div className="flex h-44 items-center justify-center text-sm text-gray-400">
          Belum ada omzet pada periode ini.
        </div>
      ) : (
        <div className="flex h-44 items-end gap-1.5">
          {points.map((p) => (
            <div
              key={p.date}
              title={`${shortDate(p.date)}: ${formatRupiah(p.revenue)}`}
              className="group flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div
                style={{
                  height: `${Math.max((p.revenue / max) * 100, 2)}%`,
                }}
                className={`w-full rounded-t-md transition-colors ${
                  p.revenue > 0
                    ? 'bg-brand-500 group-hover:bg-brand-600'
                    : 'bg-gray-100 dark:bg-navy-700'
                }`}
              />
              {points.length <= 14 && (
                <span className="text-[10px] text-gray-400">
                  {shortDate(p.date)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
        <span>Omzet per hari (Asia/Jakarta)</span>
        <span className="font-semibold text-navy-700 dark:text-white">
          {formatRupiah(points.reduce((s, p) => s + p.revenue, 0))}
        </span>
      </div>
    </div>
  );
}
