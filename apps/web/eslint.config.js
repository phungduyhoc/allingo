// ESLint cho apps/web. Không import '@allingo/config/eslint/next' vì gói config không khai báo
// @next/eslint-plugin-next / eslint-plugin-react-hooks (chúng là devDependencies của apps/web);
// dùng baseConfig dùng chung rồi gắn hai plugin Next/React từ node_modules của web.
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import { baseConfig } from '@allingo/config/eslint/base';
import allingoI18n from './eslint-rules/no-jsx-literal-text.js';

/**
 * S11 – i18n lint: chuỗi hiển thị trong JSX phải qua next-intl. Tên riêng/thương hiệu/đơn vị không dịch được liệt kê ở đây;
 * trường hợp đặc biệt khác ghi `// i18n-ignore` kèm lý do ở dòng trên.
 */
const I18N_ALLOW = ['Allingo', 'TOEIC', 'IELTS', 'JLPT', 'HSK', 'ETS', 'Pro', 'VND', 'VNPay', 'MoMo', 'ZaloPay', 'Zalo', 'Facebook', 'Messenger', 'Google', 'Apple', 'Markdown', 'IPA', 'US', 'UK', 'L&R', 'OK', 'XP', 'SRS', 'FSRS', 'AI', 'QR', 'PDF', 'CSV', 'JSON', 'URL', 'ID', 'MST', 'Email', 'Lexical'];

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
    files: ['src/**/*.tsx'],
    // mock-gateway: công cụ dev (cổng thanh toán giả, 404 ở bản build không mock) – cố ý không i18n như trang mock của API
    ignores: ['src/mock/**', 'src/**/*.test.*', 'src/features/mock-gateway/**'],
    plugins: { allingo: allingoI18n },
    rules: { 'allingo/no-jsx-literal-text': ['error', { allow: I18N_ALLOW }] },
  },
  {
    // Service worker & script build: cho phép console để chẩn đoán cache
    files: ['src/app/sw.ts', 'scripts/**/*.{js,mjs}'],
    rules: { 'no-console': 'off' },
  },
];
