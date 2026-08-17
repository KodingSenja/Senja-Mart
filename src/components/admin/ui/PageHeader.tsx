'use client';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Right-aligned actions (search input, action buttons). */
  actions?: ReactNode;
}

/**
 * Admin page header — same layout as the Products page
 * (title + description on the left, actions on the right).
 */
export default function PageHeader({
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-2xl font-bold text-navy-700 dark:text-white">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
