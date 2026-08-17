'use client';

interface SearchInputProps {
  id?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  /** Width class, defaults to the standard w-56 used on the Products page. */
  className?: string;
}

const inputClass =
  'w-full rounded-lg border border-gray-200 bg-transparent px-3 py-2.5 text-sm font-medium text-navy-700 outline-none transition-all placeholder:text-gray-400 focus:border-brand-500 dark:border-navy-600 dark:bg-navy-800 dark:text-white';

/** Admin search input — same styling as the Products page search box. */
export default function SearchInput({
  id,
  placeholder = 'Cari...',
  value,
  onChange,
  className = 'w-56',
}: SearchInputProps) {
  return (
    <input
      id={id}
      name="search"
      type="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} ${className}`}
    />
  );
}
