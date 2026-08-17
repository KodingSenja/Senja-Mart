'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
  onPageChange: (page: number) => void;
}

const navBtn =
  'flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

/** Client-side pagination control (previous / next + page numbers). */
export default function Pagination({
  page,
  totalPages,
  from,
  to,
  total,
  onPageChange,
}: PaginationProps) {
  if (total === 0) return null;

  // Page numbers with ellipsis for large ranges: 1 … p-1 p p+1 … N
  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    const around = new Set([1, totalPages, page - 1, page, page + 1]);
    const sorted = [...around]
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
    let prev = 0;
    for (const p of sorted) {
      if (p - prev > 1) pages.push('...');
      pages.push(p);
      prev = p;
    }
  }

  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4 dark:border-navy-700">
      <p className="text-xs text-gray-400">
        Menampilkan {from}–{to} dari {total}
      </p>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Halaman sebelumnya"
          className={`${navBtn} text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-700`}
        >
          ‹
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`e${i}`} className="px-1 text-xs text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              className={`${navBtn} ${
                p === page
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-700'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Halaman berikutnya"
          className={`${navBtn} text-gray-500 hover:bg-gray-100 dark:hover:bg-navy-700`}
        >
          ›
        </button>
      </div>
    </div>
  );
}
