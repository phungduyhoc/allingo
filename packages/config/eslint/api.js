// ESLint cho apps/api: thực thi ranh giới module (CLAUDE.md §5.1, §5.2)
import boundaries from 'eslint-plugin-boundaries';
import { baseConfig } from './base.js';

// Thứ tự phụ thuộc: tầng thấp không được import tầng cao
const LAYER_0 = ['shared'];
const LAYER_1 = ['iam', 'catalog', 'billing', 'ai-gateway', 'speech'];
const LAYER_2 = ['test-engine', 'grading'];
const LAYER_3 = ['learning'];
const LAYER_4 = ['growth', 'b2b', 'analytics', 'admin'];

const allModules = [...LAYER_1, ...LAYER_2, ...LAYER_3, ...LAYER_4];

const elements = [
  { type: 'shared', pattern: 'src/shared/*', mode: 'folder', capture: ['area'] },
  ...allModules.map((m) => ({ type: m, pattern: `src/modules/${m}`, mode: 'folder' })),
  { type: 'config', pattern: 'src/config', mode: 'folder' },
  { type: 'root', pattern: 'src/*.ts', mode: 'file' },
];

const allow = (from, to) => ({ from, allow: to });

/** @type {import('eslint').Linter.Config[]} */
export const apiConfig = [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/ignore': ['**/*.spec.ts', '**/*.test.ts'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            allow(['config'], ['config']),
            allow(['shared'], ['shared', 'config']),
            allow(LAYER_1, ['shared', 'config', ...LAYER_1]),
            allow(LAYER_2, ['shared', 'config', ...LAYER_1, ...LAYER_2]),
            allow(LAYER_3, ['shared', 'config', ...LAYER_1, ...LAYER_2, ...LAYER_3]),
            allow(LAYER_4, ['shared', 'config', ...allModules]),
            allow(['root'], ['shared', 'config', ...allModules]),
          ],
        },
      ],
      // Chỉ được import index.ts công khai của module khác
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          rules: [
            { target: allModules, allow: 'index.ts' },
            { target: ['shared'], allow: ['index.ts', '**/*.ts'] },
            { target: ['config'], allow: '**/*.ts' },
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
