import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/**
 * Tiện ích dùng chung cho PoC (eval/poc – KHÔNG thuộc runtime). Thư mục eval/ không có node_modules riêng:
 * chỉ import tương đối vào apps/api/src và nạp gói npm qua createRequire neo tại apps/api.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '../../..');
export const API_DIR = path.join(REPO_ROOT, 'apps/api');
const apiRequire = createRequire(path.join(API_DIR, 'package.json'));

interface YamlLib {
  parse(src: string): unknown;
}

interface PromptSpecLite {
  prompts: Array<{ code: string; eval?: { eval_set?: string; thresholds?: Record<string, number> } }>;
  scoring_rules?: Record<string, unknown>;
}

let specCache: PromptSpecLite | null = null;
/** docs/spec/allingo-prompts.yaml (nguồn sự thật của ngưỡng eval & scoring_rules) */
export function loadPromptsSpec(): PromptSpecLite {
  if (!specCache) {
    const yaml = apiRequire('yaml') as YamlLib;
    specCache = yaml.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs/spec/allingo-prompts.yaml'), 'utf8')) as PromptSpecLite;
  }
  return specCache;
}

export function thresholdsFor(taskCode: string): { evalSet: string | null; thresholds: Record<string, number> } {
  const p = loadPromptsSpec().prompts.find((x) => x.code === taskCode);
  if (!p?.eval?.thresholds) throw new Error(`Không tìm thấy eval.thresholds cho ${taskCode} trong docs/spec/allingo-prompts.yaml`);
  return { evalSet: p.eval.eval_set ?? null, thresholds: p.eval.thresholds };
}

/** Đọc JSONL (bỏ dòng trống và dòng bắt đầu bằng //) – trả kèm số dòng để báo lỗi */
export function readJsonl<T>(file: string): Array<{ line: number; value: T }> {
  const out: Array<{ line: number; value: T }> = [];
  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const t = raw.trim();
      if (!t || t.startsWith('//')) return;
      try {
        out.push({ line: i + 1, value: JSON.parse(t) as T });
      } catch (err) {
        throw new Error(`${path.basename(file)}:${i + 1}: JSON không hợp lệ (${(err as Error).message})`);
      }
    });
  return out;
}

export function envInt(name: string, def: number, min = 0): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} phải là số nguyên ≥ ${min}`);
  return n;
}

export function timestamp(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

export function writeResult(dir: string, data: unknown): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${timestamp()}.json`);
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

/** In bảng đơn giản ra console (stdout của script PoC, không phải log API) */
export function printTable(rows: Array<Record<string, unknown>>): void {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '–').length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(width[i]!)).join('  ');
  process.stdout.write(`${line(cols)}\n${line(width.map((w) => '-'.repeat(w)))}\n`);
  for (const r of rows) process.stdout.write(`${line(cols.map((c) => String(r[c] ?? '–')))}\n`);
}
