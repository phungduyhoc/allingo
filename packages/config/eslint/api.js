// ESLint cho apps/api: thực thi ranh giới module (CLAUDE.md §5.1, §5.2) bằng eslint-plugin-boundaries v7 (policies)
import boundaries from 'eslint-plugin-boundaries';
import { baseConfig } from './base.js';

// Thứ tự phụ thuộc: tầng thấp không được import tầng cao
const LAYER_1 = ['iam', 'catalog', 'billing', 'ai-gateway', 'speech'];
const LAYER_2 = ['test-engine', 'grading'];
const LAYER_3 = ['learning'];
const LAYER_4 = ['growth', 'b2b', 'analytics', 'admin'];
const allModules = [...LAYER_1, ...LAYER_2, ...LAYER_3, ...LAYER_4];

const elements = [
  { type: 'shared', pattern: 'src/shared/*', capture: ['area'] },
  ...allModules.map((m) => ({ type: m, pattern: `src/modules/${m}` })),
  { type: 'config', pattern: 'src/config' },
  { type: 'worker', pattern: 'src/worker' },
];

const allowTo = (fromTypes, toTypes) => ({
  from: { element: { types: { anyOf: fromTypes } } },
  allow: { to: { element: { types: { anyOf: toTypes } } } },
});

/** @type {import('eslint').Linter.Config[]} */
export const apiConfig = [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/files': [{ category: 'root', pattern: 'src/*.ts' }],
      'boundaries/ignore': ['**/*.spec.ts', '**/*.test.ts'],
      // ESM NodeNext import '.js' → tệp '.ts': cần resolver TypeScript, nếu không plugin coi đích là "unknown" và bỏ qua
      'import/resolver': { typescript: { project: ['./tsconfig.json'], alwaysTryTypes: true }, node: { extensions: ['.ts', '.js'] } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            allowTo(['config'], ['config']),
            allowTo(['shared'], ['shared', 'config']),
            allowTo(LAYER_1, ['shared', 'config', ...LAYER_1]),
            allowTo(LAYER_2, ['shared', 'config', ...LAYER_1, ...LAYER_2]),
            allowTo(LAYER_3, ['shared', 'config', ...LAYER_1, ...LAYER_2, ...LAYER_3]),
            allowTo(LAYER_4, ['shared', 'config', ...allModules]),
            allowTo(['worker'], ['shared', 'config', 'worker', ...allModules]),
            { from: { file: { categories: 'root' } }, allow: { to: { element: { types: { anyOf: ['shared', 'config', 'worker', ...allModules] } } } } },
            { from: { file: { categories: 'root' } }, allow: { to: { file: { categories: 'root' } } } },
            // Chỉ được import index.ts công khai của module khác (ngoại lệ: ai-gateway/core dùng chung nội bộ tầng 1 qua đường dẫn core)
            {
              from: { element: { types: { anyOf: allModules } } },
              disallow: { to: { element: { types: { anyOf: allModules }, fileInternalPath: '!(index.ts|core/ai-gateway.module.ts|core/ai-gateway.service.ts)' } } },
            },
          ],
        },
      ],
      // Cấm SDK model ngoài ai-gateway và adapter speech
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['ai', '@ai-sdk/*', 'openai', '@anthropic-ai/*', '@google/generative-ai', 'microsoft-cognitiveservices-speech-sdk'],
              message: 'Mọi lời gọi AI/Speech phải đi qua AiGateway hoặc SpeechProvider (CLAUDE.md §5.2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/modules/ai-gateway/**/*.ts', 'src/modules/speech/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
];

export default apiConfig;
