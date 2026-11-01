import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

// SWC để phát emitDecoratorMetadata cho NestJS trong test
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' } })],
  test: {
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.spec.ts', 'test/unit/**/*.test.ts'], environment: 'node' } },
      { extends: true, test: { name: 'integration', include: ['test/integration/**/*.test.ts'], environment: 'node', testTimeout: 60_000, hookTimeout: 120_000, fileParallelism: false } },
    ],
  },
});
