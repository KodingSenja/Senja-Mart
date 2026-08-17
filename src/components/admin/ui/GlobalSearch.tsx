'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { FiSearch } from 'react-icons/fi';
import {
  searchGlobal,
  type GlobalSearchEntity,
  type GlobalSearchResult,
} from 'lib/services/search';

const entityMeta: Record<
  GlobalSearchEntity,
  { label: string; icon: string; className: string }
> = {
  product: {
    label: 'Produk',
    icon: '📦',
    className:
      'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  },
  category: {
    label: 'Kategori',
    icon: '🗂️',
    className:
      'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
  },
  order: {
    label: 'Pesanan',
    icon: '🧾',
    className:
      'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
  },
};

const DEBOUNCE_MS = 300;
const PANEL_MAX_WIDTH = 400;

interface PanelPosition {
  top: number;
  left: number;
  width: number;
}

/**
 * Admin Global Search — standalone navigator across the SenjaMart dashboard.
 *
 * Owns its own query state (`query`) and NEVER touches the per-section
 * search states (Orders/Products/Categories/Marketing). Selecting a result
 * only navigates to the section page — it does not pre-fill or filter that
 * page, so the two systems cannot interfere with each other.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<PanelPosition | null>(null);

  // Debounce keystrokes so we don't hit Supabase on every character.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  // Fetch results whenever the debounced query settles.
  useEffect(() => {
    if (!debounced) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    searchGlobal(debounced)
      .then((r) => {
        if (cancelled) return;
        setResults(r);
        setActive(0);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(
          e instanceof Error ? e.message : 'Gagal memuat hasil pencarian.'
        );
        setResults([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  // Position the panel under the input (fixed positioning avoids any
  // viewport overflow on small screens), and recompute on scroll/resize.
  const reposition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - 16);
    let left = r.left;
    if (left + width > window.innerWidth - 8) {
      left = Math.max(8, window.innerWidth - 8 - width);
    }
    setPos({ top: r.bottom + 8, left, width });
  };

  useEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, debounced]);

  // Close when clicking outside the widget (the panel is portaled to
  // document.body, so it must be treated as part of the widget too).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const go = (r: GlobalSearchResult) => {
    setOpen(false);
    setQuery('');
    setDebounced('');
    setResults([]);
    // Navigate only — never pass ?q= so the destination section keeps its
    // own untouched search state.
    router.push(r.href);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((a) => Math.min(a + 1, results.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      if (results.length > 0) {
        e.preventDefault();
        go(results[Math.min(active, results.length - 1)]);
      }
    }
  };

  const activeQuery = query.trim();

  return (
    <div ref={rootRef} className="relative w-full">
      <div className="flex h-full items-center rounded-full bg-lightPrimary text-navy-700 dark:bg-navy-900 dark:text-white xl:w-[225px]">
        <p className="pl-3 pr-2 text-xl">
          <FiSearch className="h-4 w-4 text-gray-400 dark:text-white" />
        </p>
        <input
          id="adminGlobalSearch"
          ref={inputRef}
          type="text"
          role="combobox"
          placeholder="Cari..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Typing while the panel is closed must open it (e.g. after a
            // previous navigation kept focus on the input but closed it).
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            reposition();
          }}
          onClick={() => {
            // Clicking an already-focused input does not fire onFocus again;
            // reopen explicitly so the dropdown comes back after navigation.
            setOpen(true);
            reposition();
          }}
          onKeyDown={handleKeyDown}
          aria-label="Pencarian global"
          aria-expanded={open}
          aria-controls="globalSearchResults"
          aria-autocomplete="list"
          aria-activedescendant={
            open && results.length > 0
              ? `globalSearchOption-${active}`
              : undefined
          }
          className="block h-full w-full rounded-full bg-lightPrimary text-sm font-medium text-navy-700 outline-none placeholder:!text-gray-400 dark:bg-navy-900 dark:text-white dark:placeholder:!text-white sm:w-fit"
        />
      </div>

      {open &&
        pos &&
        createPortal(
        <div
          ref={panelRef}
          id="globalSearchResults"
          role="listbox"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
          className="fixed z-50 overflow-hidden rounded-xl bg-white shadow-xl shadow-shadow-500 ring-1 ring-gray-200 dark:bg-navy-800 dark:ring-navy-600"
        >
          {!activeQuery ? (
            <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500">
              Cari produk, kategori, atau pesanan di seluruh dashboard.
            </p>
          ) : loading || !debounced ? (
            <div className="flex items-center gap-3 px-4 py-4 text-sm text-gray-400">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-brand-500 dark:border-navy-600 dark:border-t-brand-500" />
              Mencari...
            </div>
          ) : error ? (
            <p className="px-4 py-4 text-sm text-red-500">
              Gagal memuat hasil pencarian.
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-4 text-sm text-gray-400 dark:text-gray-500">
              Tidak ada hasil.
            </p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto py-1">
              {results.map((r, i) => {
                const meta = entityMeta[r.type];
                const selected = i === active;
                return (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      type="button"
                      id={`globalSearchOption-${i}`}
                      role="option"
                      aria-selected={selected}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => go(r)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors ${
                        selected
                          ? 'bg-gray-50 dark:bg-navy-700'
                          : 'hover:bg-gray-50 dark:hover:bg-navy-700'
                      }`}
                    >
                      <span className="shrink-0 text-lg">{meta.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-navy-700 dark:text-white">
                          {r.title}
                        </span>
                        <span className="block truncate text-xs text-gray-400 dark:text-gray-500">
                          {r.subtitle}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
