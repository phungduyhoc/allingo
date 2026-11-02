import { defineConfig } from 'vitest/config';
// Property test 500 ca × 5 thuộc tính: nới timeout (mặc định 5 s)
export default defineConfig({ test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'], testTimeout: 60_000 } });
