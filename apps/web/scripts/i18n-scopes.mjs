#!/usr/bin/env node
/**
 * S11 (hiệu năng) – tính nhánh thông điệp next-intl mà COMPONENT CLIENT của từng trang khu vực học cần, bằng phân tích tĩnh đồ thị
 * import (từ page.tsx / layout.tsx đi theo `import … from '@/…' | './…'` và `import('…')`, chỉ đếm tệp thuộc nhánh client – có
 * 'use client' hoặc được tệp client import). Thu `useTranslations('ns')` (namespace luôn là chuỗi hằng – kiểm bằng test).
 *
 *   node scripts/i18n-scopes.mjs          # ghi src/lib/i18n-app-scopes.ts
 *   node scripts/i18n-scopes.mjs --check  # chỉ so sánh (exit 1 nếu tệp sinh đã cũ)
 *
 * `src/lib/i18n-app-scopes.test.ts` chạy cùng kiểm tra này trong `pnpm test` → thêm useTranslations mới mà quên chạy script sẽ đỏ.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(WEB, 'src');
const APP = join(SRC, 'app', '[locale]', '(app)');
const OUT = join(SRC, 'lib', 'i18n-app-scopes.ts');
const EXTS = ['.tsx', '.ts', '/index.tsx', '/index.ts'];

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const NS_RE = /useTranslations\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveImport(from, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  if (existsSync(base) && /\.(tsx?|mjs|js)$/.test(base)) return base;
  for (const e of EXTS) if (existsSync(base + e)) return base + e;
  return null;
}

const cache = new Map();
function parse(file) {
  if (cache.has(file)) return cache.get(file);
  const text = readFileSync(file, 'utf8');
  const client = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"]use client['"]/.test(text);
  const imports = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const stmt = m[0];
    if (/^import\s+type\s/.test(stmt) || /^export\s+type\s/.test(stmt)) continue;
    const r = resolveImport(file, m[1] ?? m[2]);
    if (r) imports.push(r);
  }
  const namespaces = [...text.matchAll(NS_RE)].map((m) => m[1]);
  const info = { client, imports, namespaces };
  cache.set(file, info);
  return info;
}

/** Namespace dùng bởi phần client đi ra từ các tệp gốc (gốc là server component – page/layout) */
export function clientNamespaces(entries) {
  const out = new Set();
  const seen = new Set();
  const visit = (file, inClient) => {
    const info = parse(file);
    const client = inClient || info.client;
    const key = `${file}|${client}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (client) for (const ns of info.namespaces) out.add(ns);
    for (const dep of info.imports) visit(dep, client);
  };
  for (const e of entries) visit(e, false);
  return [...out].sort();
}

/** Gộp đường dẫn con vào nhánh cha (`plan` bao `plan.status`) */
function compact(paths) {
  const sorted = [...new Set(paths)].sort();
  return sorted.filter((p) => !sorted.some((q) => q !== p && p.startsWith(`${q}.`)));
}

function walkPages(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'page.tsx') acc.push(p);
    else if (statSync(p).isDirectory()) walkPages(p, acc);
  }
  return acc;
}

/** Thông điệp luôn có (ErrorState/Spinner/… dùng ở mọi nơi) */
const ALWAYS = ['common', 'errors'];

export function computeScopes() {
  const layouts = [join(APP, 'layout.tsx'), join(APP, '(shell)', 'layout.tsx')];
  const layout = compact([...ALWAYS, ...clientNamespaces(layouts)]);
  const pages = {};
  for (const page of walkPages(APP).sort()) {
    const key = relative(APP, dirname(page)).split('\\').join('/');
    pages[key] = compact([...ALWAYS, ...clientNamespaces([page])]);
  }
  return { layout, pages };
}

export function render(scopes) {
  const lines = [
    '// TỰ SINH bởi `node scripts/i18n-scopes.mjs` (S11) – không sửa tay; `pnpm test` kiểm tra tệp còn khớp mã nguồn.',
    '// Nhánh thông điệp next-intl gửi xuống trình duyệt cho khu vực học: layout (AuthGate, AppShell, realtime…) + từng trang.',
    '',
    `export const APP_LAYOUT_MESSAGES = ${JSON.stringify(scopes.layout)} as const;`,
    '',
    'export const APP_PAGE_MESSAGES = {',
    ...Object.entries(scopes.pages).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '} as const satisfies Record<string, readonly string[]>;',
    '',
    'export type AppPageKey = keyof typeof APP_PAGE_MESSAGES;',
    '',
  ];
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const next = render(computeScopes());
  const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (process.argv.includes('--check')) {
    if (prev !== next) {
      console.error('src/lib/i18n-app-scopes.ts đã cũ – chạy: node scripts/i18n-scopes.mjs');
      process.exit(1);
    }
    console.log('i18n scopes OK');
  } else {
    writeFileSync(OUT, next);
    console.log(`wrote ${relative(WEB, OUT)}`);
  }
}
