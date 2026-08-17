'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination over an already-filtered array.
 *
 * - `items` should be the FULL filtered dataset (search/filter applied
 *   BEFORE pagination, so "20 per halaman" slices the filtered result).
 * - `resetKey` is a value that changes when the search/filter changes
 *   (e.g. the search string); the hook jumps back to page 1 so the user
 *   never lands on an empty page after narrowing results.
 */
export function usePagination<T>(
  items: T[],
  pageSize: number,
  resetKey: string
) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Filter/search changed → back to page 1.
  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  const safePage = Math.min(page, totalPages);

  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );

  const from = items.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, items.length);

  return {
    page: safePage,
    setPage,
    totalPages,
    pageItems,
    from,
    to,
    total: items.length,
  };
}
