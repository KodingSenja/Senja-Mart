'use client';

export interface FilterOption {
  value: string;
  label: string;
}

interface SelectFilterProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  /** Label for the "all" option (value ''), e.g. "Status Pesanan". */
  allLabel?: string;
  /** Width class, defaults to w-44. */
  className?: string;
}

const selectClass =
  'w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white';

/** Admin dropdown filter — styled like the Products page inputs. */
export default function SelectFilter({
  id,
  value,
  onChange,
  options,
  allLabel = 'Semua',
  className = 'w-44',
}: SelectFilterProps) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${selectClass} ${className}`}
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
