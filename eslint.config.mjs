import nextVitals from 'eslint-config-next/core-web-vitals';

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
  ...nextVitals,
  {
    ignores: ['.next/**', 'out/**', 'build/**', 'next-env.d.ts'],
  },
  {
    rules: {
      'react/no-unescaped-entities': ['error', { forbid: ['>', '}'] }],
      // Codebase ini sengaja memuat data client-side di dalam useEffect
      // (pola data-fetching standar, termasuk hydrate cart dari localStorage).
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default eslintConfig;
