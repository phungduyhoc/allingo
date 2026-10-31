import { defineConfig } from 'tsup';
export default defineConfig({
  entry: { index: 'src/index.ts', 'question/index': 'src/question/index.ts', 'ai/index': 'src/ai/index.ts', 'api/index': 'src/api/index.ts', 'product/index': 'src/product/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
});
