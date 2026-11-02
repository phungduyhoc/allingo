import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', 'question/index': 'src/question/index.ts', 'ai/index': 'src/ai/index.ts', 'api/index': 'src/api/index.ts', 'product/index': 'src/product/index.ts' },
  format: ['esm', 'cjs'],
  // rootDir '..': src/product/entitlements.ts re-export packages/config/entitlements.ts (bundle vào dist, S7)
  dts: { compilerOptions: { rootDir: '..' } },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
});
