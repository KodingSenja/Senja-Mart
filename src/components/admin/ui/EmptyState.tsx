'use client';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
}

/** Centered empty state used across admin tables. */
export default function EmptyState({
  icon = '📦',
  title,
  description,
}: EmptyStateProps) {
  return (
    <div className="py-12 text-center">
      <span className="text-4xl">{icon}</span>
      <p className="mt-3 text-sm text-gray-500">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-gray-400">{description}</p>
      )}
    </div>
  );
}
