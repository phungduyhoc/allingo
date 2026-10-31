 
/**
 * Tổ chức lại schema do `drizzle-kit pull` sinh (.pull/schema.ts, .pull/relations.ts)
 * thành drizzle/schema/<schema>.ts + relations.ts + index.ts.
 *
 * Quy ước: drizzle-kit đặt tên `usersInIam` → đổi thành `iamUsers` (tiền tố schema),
 * citext → customType, timestamp mode 'date', gắn kiểu TypeScript cho cột JSONB theo bảng ánh xạ.
 *
 * Chạy: pnpm pull && pnpm organize   (hoặc pnpm schema:refresh)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pullDir = path.resolve(here, '../.pull');
const outDir = path.resolve(here, '../drizzle/schema');
type SchemaName = 'iam' | 'catalog' | 'learn' | 'ai' | 'billing' | 'ops';

/** Cột JSONB cần kiểu TypeScript (table theo tên đã đổi → cột → kiểu từ @allingo/schemas) */
const JSONB_TYPES: Record<string, Record<string, string>> = {
  catalogQuestionVersions: { content: 'QuestionContent' },
  catalogPrograms: { name: 'LocalizedText' },
  catalogSkills: { name: 'LocalizedText' },
  catalogSections: { name: 'LocalizedText' },
  catalogQuestionTypes: { name: 'LocalizedText' },
  catalogTopics: { name: 'LocalizedText' },
  catalogSubskills: { name: 'LocalizedText' },
  catalogTestSets: { title: 'LocalizedText' },
  catalogLessons: { title: 'LocalizedText', summary: 'LocalizedText' },
  catalogVocabLists: { title: 'LocalizedText' },
  learnAttemptAnswers: { answer: 'AnswerInput' },
  learnAttempts: { scoreBreakdown: 'ScoreBreakdown', draftState: 'AttemptDraftState' },
  billingPlans: { name: 'LocalizedText', description: 'LocalizedText' },
};

const schemaSrc = fs.readFileSync(path.join(pullDir, 'schema.ts'), 'utf8');
const relationsSrc = fs.readFileSync(path.join(pullDir, 'relations.ts'), 'utf8');

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const renameIdent = (s: string) =>
  s.replace(
    /\b([A-Za-z0-9_]+?)In(Iam|Catalog|Learn|Ai|Billing|Ops)\b/g,
    (_m, name: string, sch: string) => `${sch.toLowerCase()}${cap(name)}`,
  );

// 1) Tách khai báo top-level
interface Decl {
  name: string;
  body: string;
  schema: SchemaName | 'common';
  kind: 'schema' | 'enum' | 'sequence' | 'table' | 'view' | 'other';
}
const lines = schemaSrc.split('\n');
const decls: Decl[] = [];
const header: string[] = [];
let cur: string[] | null = null;
let curName = '';
const flush = () => {
  if (!cur) return;
  const body = cur.join('\n').trimEnd();
  const m = /^export const (\w+) = (\w+)\.(table|enum|sequence|view|materializedView)\(/.exec(body);
  let schema: Decl['schema'] = 'common';
  let kind: Decl['kind'] = 'other';
  if (/^export const \w+ = pgSchema\(/.test(body)) kind = 'schema';
  else if (m) {
    schema = m[2] as SchemaName;
    kind = m[3] === 'materializedView' ? 'view' : (m[3] as Decl['kind']);
  }
  decls.push({ name: curName, body, schema, kind });
  cur = null;
};
for (const line of lines) {
  const m = /^export const (\w+) =/.exec(line);
  if (m) {
    flush();
    cur = [line];
    curName = m[1]!;
  } else if (cur) cur.push(line);
  else header.push(line);
}
flush();

// 2) Đổi tên + sửa kiểu
const fixBody = (b: string) =>
  renameIdent(b)
    .replace(/\/\/ TODO: failed to parse database type 'citext'\n\s*(\w+): unknown\("(\w+)"\)/g, '$1: citext("$2")')
    .replace(/timestamp\(("[^"]*"|)\s*,?\s*\{ withTimezone: true, mode: 'string' \}\)/g, (_m, name: string) =>
      name
        ? `timestamp(${name}, { withTimezone: true, mode: 'date' })`
        : `timestamp({ withTimezone: true, mode: 'date' })`,
    )
    .replace(/\n\s*\/\/ You can use \{ mode: "bigint" \} if numbers are exceeding js number limitations/g, '');

const byName = new Map<string, Decl>();
for (const d of decls) {
  d.name = renameIdent(d.name);
  d.body = fixBody(d.body);
  byName.set(d.name, d);
}

// 3) Gắn kiểu JSONB
const typeImports = new Set<string>();
for (const d of decls) {
  const map = JSONB_TYPES[d.name];
  if (!map) continue;
  for (const [col, type] of Object.entries(map)) {
    const re = new RegExp(`(\\n\\s*${col}: jsonb\\([^)]*\\))`);
    if (!re.test(d.body)) {
      console.warn(`[organize] không thấy cột jsonb ${d.name}.${col}`);
      continue;
    }
    d.body = d.body.replace(re, `$1.$type<${type}>()`);
    const base = type.replace(/\[\]$/, '');
    if (/^[A-Z]/.test(base)) typeImports.add(base);
  }
}

// 3b) Phá vòng tham chiếu kiểu TypeScript (questions ↔ question_versions): chuyển FK sang
//     cột `.references((): AnyPgColumn => ...)` để TS không báo TS7022. Tên constraint trong DB vẫn do migration SQL quyết định.
const CYCLE_BREAKERS: Array<{ table: string; column: string; target: string }> = [
  { table: 'catalogQuestions', column: 'currentVersionId', target: 'catalogQuestionVersions.id' },
];
for (const cb of CYCLE_BREAKERS) {
  const d = byName.get(cb.table);
  if (!d) continue;
  const fkRe = new RegExp(
    `\\n\\s*foreignKey\\(\\{\\s*columns: \\[table\\.${cb.column}\\],\\s*foreignColumns: \\[${cb.target.replace('.', '\\.')}\\],\\s*name: "[^"]+"\\s*\\}\\)(\\.on\\w+\\("[^"]+"\\))*,`,
  );
  if (!fkRe.test(d.body)) {
    console.warn(`[organize] không thấy FK để phá vòng ${cb.table}.${cb.column}`);
    continue;
  }
  d.body = d.body.replace(fkRe, '');
  const colRe = new RegExp(`(\\n\\s*${cb.column}: uuid\\("[a-z_]+"\\))`);
  d.body = d.body.replace(colRe, `$1.references((): AnyPgColumn => ${cb.target})`);
}

// 4) Phân nhóm theo schema và tính import chéo
const allNames = new Set(decls.map((d) => d.name));
const fileOf = (d: Decl) => (d.kind === 'schema' || d.kind === 'sequence' ? '_common' : d.schema);
const groups = new Map<string, Decl[]>();
for (const d of decls) {
  const f = fileOf(d);
  if (!groups.has(f)) groups.set(f, []);
  groups.get(f)!.push(d);
}

const pgCoreImportLine = header.find((l) => l.startsWith('import {') && l.includes('drizzle-orm/pg-core')) ?? '';
const pgCoreSymbols = pgCoreImportLine
  .replace(/^import \{|\} from .*$/g, '')
  .split(',')
  .map((s) => s.trim().replace(/^type /, ''))
  .filter(Boolean);

const usedSymbols = (text: string, symbols: string[]) =>
  symbols.filter((s) => (s === 'AnyPgColumn' ? /\bAnyPgColumn\b/.test(text) : new RegExp(`(^|[^.\\w])${s}\\(`).test(text)));

// Xoá các tệp sinh tự động, giữ tệp viết tay (_partitioned.ts)
const HAND_WRITTEN = new Set(['_partitioned.ts']);
fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(outDir)) if (!HAND_WRITTEN.has(f)) fs.rmSync(path.join(outDir, f));

// _types.ts: citext customType
fs.writeFileSync(
  path.join(outDir, '_types.ts'),
  `import { customType } from 'drizzle-orm/pg-core';

/** Kiểu citext (email không phân biệt hoa thường) */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
`,
);

const banner = `// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.
`;

for (const [file, ds] of groups) {
  const text = ds.map((d) => d.body).join('\n\n');
  const refs = new Set<string>();
  for (const n of allNames) if (!ds.some((d) => d.name === n) && new RegExp(`(^|[^.\\w'"])${n}[.(]`).test(text)) refs.add(n);
  const importsByFile = new Map<string, string[]>();
  for (const r of refs) {
    const target = fileOf(byName.get(r)!);
    if (!importsByFile.has(target)) importsByFile.set(target, []);
    importsByFile.get(target)!.push(r);
  }
  const pg = usedSymbols(text, pgCoreSymbols);
  const needsSql = /\bsql`/.test(text);
  const needsCitext = /\bcitext\(/.test(text);
  const needsAny = /\bAnyPgColumn\b/.test(text);
  const typeOnly = pg.filter((s) => s === 'AnyPgColumn');
  const values = pg.filter((s) => s !== 'AnyPgColumn');
  const out: string[] = [banner];
  if (values.length || typeOnly.length)
    out.push(
      `import { ${[...values, ...(needsAny ? ['type AnyPgColumn'] : [])].join(', ')} } from 'drizzle-orm/pg-core';`,
    );
  if (needsSql) out.push(`import { sql } from 'drizzle-orm';`);
  if (needsCitext) out.push(`import { citext } from './_types.js';`);
  if (file !== '_common' && typeImports.size) {
    const used = [...typeImports].filter((t) => new RegExp(`\\b${t}\\b`).test(text));
    if (used.length) out.push(`import type { ${used.join(', ')} } from '@allingo/schemas';`);
  }
  for (const [target, names] of [...importsByFile.entries()].sort()) {
    out.push(`import { ${names.sort().join(', ')} } from './${target}.js';`);
  }
  out.push('', text, '');
  fs.writeFileSync(path.join(outDir, `${file}.ts`), out.join('\n'));
}

// relations.ts
let rel = renameIdent(relationsSrc).replace(/from "\.\/schema"/, "from './index.js'");
rel = `${banner}${rel}`;
fs.writeFileSync(path.join(outDir, 'relations.ts'), rel);

// index.ts
const files = [...groups.keys()].sort((a, b) => (a === '_common' ? -1 : b === '_common' ? 1 : a.localeCompare(b)));
fs.writeFileSync(
  path.join(outDir, 'index.ts'),
  `${banner}${files.map((f) => `export * from './${f}.js';`).join('\n')}\nexport * from './_partitioned.js';\nexport * from './relations.js';\nexport { citext } from './_types.js';\n`,
);

console.log(`[organize] ${decls.length} khai báo → ${files.map((f) => `${f}.ts`).join(', ')}, relations.ts, index.ts`);
