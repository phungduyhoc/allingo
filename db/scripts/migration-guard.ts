/**
 * pnpm --filter @allingo/db migration:guard — CI chặn DROP/RENAME/khoá bảng trong migration mới không có cờ cho phép (S11).
 * Baseline: drizzle/migrations/.guard-baseline.json (sha256 các migration đã phát hành 0001–0007) – tệp baseline bị sửa → lỗi.
 * `--update-baseline` ghi lại baseline (chỉ khi phát hành bản mới, có review).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardFile, sha256 } from '../src/migration-guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(process.argv.find((a) => a.startsWith('--dir='))?.slice(6) ?? path.join(here, '../drizzle/migrations'));
const baselinePath = path.join(dir, '.guard-baseline.json');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const baseline: Record<string, string> = fs.existsSync(baselinePath) ? (JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as Record<string, string>) : {};

if (process.argv.includes('--update-baseline')) {
  const next = Object.fromEntries(files.map((f) => [f, sha256(fs.readFileSync(path.join(dir, f), 'utf8'))]));
  fs.writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`✔ baseline ${files.length} migration`);
  process.exit(0);
}

const errors: string[] = [];
let checked = 0;
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  if (baseline[f]) {
    if (baseline[f] !== sha256(text)) errors.push(`${f}: migration đã phát hành bị sửa (modified_baseline) – tạo migration mới thay vì sửa`);
    continue;
  }
  checked++;
  for (const v of guardFile(f, text)) errors.push(`${v.file}:${v.line} [${v.rule}] ${v.statement}`);
}
console.log(`migration-guard: ${files.length} tệp (${files.length - checked} baseline, ${checked} mới kiểm)`);
if (errors.length) {
  console.error(`✘ ${errors.length} vi phạm – thêm "-- migration-guard: allow <lý do>" ngay trên câu lệnh nếu có chủ đích (expand/contract):`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log('✔ migration-guard: không có câu lệnh phá huỷ/khoá bảng chưa được cho phép');
