// ESLint cho apps/web & apps/cms (Next.js + React)
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { baseConfig } from './base.js';

/** @type {import('eslint').Linter.Config[]} */
export const nextConfig = [
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // Không chuỗi cứng tiếng Việt/Anh trong JSX (CLAUDE.md §5.11) – kiểm tra mềm, cảnh báo
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];

export default nextConfig;
