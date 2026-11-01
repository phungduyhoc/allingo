/**
 * pnpm api:diff — so OpenAPI sinh từ NestJS (openapi.generated.yaml) với hợp đồng docs/spec/allingo-openapi.yaml.
 * Quy tắc Sprint 0 (master prompt §4.1 G): endpoint ĐÃ triển khai phải có trong spec với cùng method; mã trạng thái thành công
 * phải khớp; endpoint trong spec chưa làm chỉ cảnh báo. Đường dẫn /internal/* và /health/* nằm ngoài hợp đồng.
 * Thoát 1 nếu có lệch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const specPath = path.resolve(here, '../../../docs/spec/allingo-openapi.yaml');
const genPath = path.resolve(here, '../openapi.generated.yaml');
if (!fs.existsSync(genPath)) {
  console.error('✘ Chưa có openapi.generated.yaml – chạy pnpm api:openapi trước');
  process.exit(1);
}
type Doc = { paths: Record<string, Record<string, { responses?: Record<string, unknown>; parameters?: Array<{ name: string; in: string; required?: boolean }>; requestBody?: { required?: boolean; content?: Record<string, unknown> } }>> };
const spec = parse(fs.readFileSync(specPath, 'utf8')) as Doc;
const gen = parse(fs.readFileSync(genPath, 'utf8')) as Doc;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const normalize = (p: string) => p.replace(/^\/v1/, '').replace(/\{[^}]+\}/g, '{}');
const specKeys = new Map<string, { path: string; method: string; op: Doc['paths'][string][string] }>();
for (const [p, ops] of Object.entries(spec.paths)) for (const m of METHODS) if (ops[m]) specKeys.set(`${m} ${normalize(p)}`, { path: p, method: m, op: ops[m] });

const errors: string[] = [];
const implemented = new Set<string>();
for (const [p, ops] of Object.entries(gen.paths)) {
  if (/^\/v1\/(internal|health)\b/.test(p)) continue;
  for (const m of METHODS) {
    const op = ops[m];
    if (!op) continue;
    const key = `${m} ${normalize(p)}`;
    implemented.add(key);
    const s = specKeys.get(key);
    if (!s) {
      errors.push(`${m.toUpperCase()} ${p}: không có trong spec (thêm vào docs/spec/allingo-openapi.yaml trước – CLAUDE.md §2)`);
      continue;
    }
    const specSuccess = Object.keys(s.op.responses ?? {}).filter((c) => c.startsWith('2'));
    const genSuccess = Object.keys(op.responses ?? {}).filter((c) => c.startsWith('2'));
    if (specSuccess.length && genSuccess.length && !genSuccess.some((c) => specSuccess.includes(c))) errors.push(`${m.toUpperCase()} ${p}: mã thành công ${genSuccess.join(',')} ≠ spec ${specSuccess.join(',')}`);
    // Tham số query bắt buộc trong spec phải được khai báo
    for (const prm of s.op.parameters ?? []) {
      if (prm.in === 'query' && prm.required && !(op.parameters ?? []).some((g) => g.name === prm.name && g.in === 'query')) errors.push(`${m.toUpperCase()} ${p}: thiếu query bắt buộc "${prm.name}"`);
    }
  }
}
const missing = [...specKeys.keys()].filter((k) => !implemented.has(k));
console.log(`Đã triển khai ${implemented.size}/${specKeys.size} operation trong spec; chưa làm: ${missing.length}`);
if (process.argv.includes('--verbose')) for (const k of missing) console.log(`   · chưa làm: ${k}`);
if (errors.length) {
  console.error(`✘ api:diff: ${errors.length} lệch so với hợp đồng`);
  for (const e of errors) console.error(`   - ${e}`);
  process.exit(1);
}
console.log('✔ api:diff: mọi endpoint đã triển khai khớp hợp đồng');
