'use client';

import type { DailyRevenue } from 'lib/services/reports';
import { formatRupiah } from 'lib/utils/format';

function shortDate(date: string): string {
  // yyyy-mm-dd → dd/mm
  const [, m, d] = date.split('-');
  return `${d}/${m}`;
}

/**
 * Dependency-free bar chart of revenue per day/week for the ACTIVE period.
 * Same Horizon-styled approach as the dashboard RevenueChart — no chart lib.
 */
export default function ReportChart({ data }: { data: DailyRevenue[] }) {
  const max = Math.max(1, ...data.map((p) => p.revenue));
  const hasRevenue = data.some((p) => p.revenue > 0);
  const showLabels = data.length <= 14;

  return (
    <div>
      {!hasRevenue ? (
        <div className="flex h-44 items-center justify-center text-sm text-gray-400">
          Belum ada omzet pada periode ini.
        </div>
      ) : (
        <div className="flex h-44 items-end gap-1.5">
          {data.map((p) => (
            <div
              key={p.date}
              title={`${shortDate(p.date)}: ${formatRupiah(p.revenue)}`}
              className="group flex min-w-0 flex-1 flex-col items-center gap-1"
            >
              <div
                style={{ height: `${Math.max((p.revenue / max) * 100, 2)}%` }}
                className={`w-full rounded-t-md transition-colors ${
                  p.revenue > 0
                    ? 'bg-brand-500 group-hover:bg-brand-600'
                    : 'bg-gray-100 dark:bg-navy-700'
                }`}
              />
              {showLabels && (
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
          {formatRupiah(data.reduce((s, p) => s + p.revenue, 0))}
        </span>
      </div>
    </div>
  );
}
