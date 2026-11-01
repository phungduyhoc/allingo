// ESLint cho apps/cms. Ý định: `nextConfig` của @allingo/config/eslint/next; nhưng gói config không khai báo
// dependency `@next/eslint-plugin-next`/`eslint-plugin-react-hooks` nên import từ packages/config thất bại (pnpm strict).
// Tạm thời ghép lại tại đây từ `baseConfig` + hai plugin cài trong apps/cms (cùng rule với eslint/next.js).
import nextPlugin from '@next/eslint-plugin-next';
import { baseConfig } from '@allingo/config/eslint/base';
import reactHooks from 'eslint-plugin-react-hooks';

// `globals` không resolve được từ apps/cms (chỉ là dependency của @allingo/config) → khai báo tối thiểu cho DOM
const browserGlobals = Object.fromEntries(
  ['window', 'document', 'navigator', 'fetch', 'File', 'FileReader', 'FormData', 'Response', 'Request', 'Headers', 'URL', 'AbortController', 'HTMLInputElement', 'HTMLElement', 'Event', 'localStorage', 'sessionStorage', 'setTimeout', 'clearTimeout', 'console'].map((g) => [g, 'readonly']),
);

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ['.next/**', 'media/**', 'src/payload-types.ts', 'src/app/(payload)/admin/importMap.js', 'next-env.d.ts'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: browserGlobals,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Script seed/CLI: cho phép console
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
