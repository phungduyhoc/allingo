import { baseConfig } from '@allingo/config/eslint/base';
export default [...baseConfig, { ignores: ['dist/**', 'drizzle/migrations/**', '.pull/**', 'drizzle.pull.config.ts'] }];
