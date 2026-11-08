import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig } from 'tsup';

/** Mọi module nguồn (không test) → một entry: `src/api/s12.ts` → `dist/api/s12.js` (export theo đường dẫn con `@allingo/schemas/api/s12`) */
function sourceEntries(dir = 'src'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) Object.assign(out, sourceEntries(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out[relative('src', p).replace(/\.ts$/, '')] = p;
  }
  return out;
}

/** Entry CJS giữ như trước (ai dùng `require` vẫn chạy) – không tách chunk */
const CJS_ENTRIES = { index: 'src/index.ts', 'question/index': 'src/question/index.ts', 'ai/index': 'src/ai/index.ts', 'api/index': 'src/api/index.ts', 'product/index': 'src/product/index.ts' };

/**
 * B7/S141 (hiệu năng): ESM tách chunk (`splitting`) + một entry cho mỗi module nguồn + `sideEffects: false` (package.json) → web nhập
 * theo đường dẫn con chỉ nạp schema cần dùng (trước đây một module 231 KB khởi tạo toàn bộ Zod schema ở mọi trang).
 * rootDir '..': src/product/entitlements.ts re-export packages/config/entitlements.ts (bundle vào dist, S7).
 */
export default defineConfig([
  {
    entry: sourceEntries(),
    format: ['esm'],
    dts: { compilerOptions: { rootDir: '..' } },
    sourcemap: true,
    // dist được xoá ở script build (hai cấu hình chạy song song – không để cấu hình này xoá đầu ra CJS)
    clean: false,
    target: 'es2022',
    splitting: true,
  },
  {
    entry: CJS_ENTRIES,
    format: ['cjs'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    splitting: false,
  },
]);
