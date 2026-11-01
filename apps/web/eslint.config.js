// ESLint cho apps/web. Không import '@allingo/config/eslint/next' vì gói config không khai báo
// @next/eslint-plugin-next / eslint-plugin-react-hooks (chúng là devDependencies của apps/web);
// dùng baseConfig dùng chung rồi gắn hai plugin Next/React từ node_modules của web.
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { baseConfig } from '@allingo/config/eslint/base';

export default [
  ...baseConfig,
  { ignores: ['.next/**', 'public/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Service worker & script build: cho phép console để chẩn đoán cache
    files: ['src/app/sw.ts', 'scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off' },
  },
];
