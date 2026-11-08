/**
 * Migration an toàn (S11 – expand/contract): chặn câu lệnh phá huỷ / khoá bảng lâu trong migration MỚI khi không có cờ cho phép.
 *
 * Cờ cho phép: dòng chú thích ngay trên câu lệnh (≤ 3 dòng)
 *   `-- migration-guard: allow <lý do ≥ 10 ký tự>`
 * Ví dụ hợp lệ: bước "contract" sau khi code đã ngừng dùng cột ở bản phát hành trước.
 *
 * Quy tắc (mỗi câu lệnh SQL):
 *  - destructive: DROP TABLE|COLUMN|SCHEMA|TYPE|VIEW|FUNCTION|TRIGGER|POLICY|CONSTRAINT|INDEX|SEQUENCE, TRUNCATE,
 *    RENAME (bảng/cột/constraint), ALTER COLUMN … TYPE (ghi lại bảng), DELETE/UPDATE không WHERE.
 *  - lock: ALTER COLUMN … SET NOT NULL (quét toàn bảng, khoá ACCESS EXCLUSIVE), ADD COLUMN … NOT NULL không DEFAULT,
 *    CREATE [UNIQUE] INDEX không CONCURRENTLY và không theo quy ước `IF NOT EXISTS` + `-- concurrent-safe`
 *    (migrate.ts tạo trước bằng CREATE INDEX CONCURRENTLY khi bảng đã tồn tại – xem db/scripts/migrate.ts).
 * Migration đã phát hành (baseline sha256) bị sửa nội dung → lỗi `modified_baseline`.
 */
import { createHash } from 'node:crypto';

export interface GuardViolation {
  file: string;
  line: number;
  rule: string;
  statement: string;
}

const ALLOW_RE = /--\s*migration-guard:\s*allow\s+(.{10,})/i;
const CONCURRENT_SAFE_RE = /--\s*concurrent-safe\b/i;

const RULES: Array<{ rule: string; re: RegExp; unless?: RegExp }> = [
  { rule: 'drop', re: /\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|TRIGGER|POLICY|CONSTRAINT|INDEX|SEQUENCE|EXTENSION)\b/i },
  { rule: 'truncate', re: /\bTRUNCATE\b/i },
  { rule: 'rename', re: /\bRENAME\s+(TO|COLUMN|CONSTRAINT)\b|\bALTER\s+TABLE\s+\S+\s+RENAME\s+\S+\s+TO\b/i },
  { rule: 'alter_type', re: /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i },
  { rule: 'set_not_null', re: /\bALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i },
  { rule: 'add_column_not_null_no_default', re: /\bADD\s+COLUMN\b(?![^;]*\bDEFAULT\b)[^;]*\bNOT\s+NULL\b/i },
  { rule: 'delete_without_where', re: /^\s*DELETE\s+FROM\s+[^\s;]+\s*;?\s*$/i },
  { rule: 'update_without_where', re: /^\s*UPDATE\s+[^\s;]+\s+SET\b(?![\s\S]*\bWHERE\b)/i },
  { rule: 'create_index_blocking', re: /\bCREATE\s+(UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i },
];

/** Tách câu lệnh theo `--> statement-breakpoint` (drizzle) hoặc `;` cuối dòng; giữ số dòng bắt đầu + chú thích phía trên */
export function splitStatements(text: string): Array<{ line: number; sql: string; comments: string[] }> {
  const lines = text.split('\n');
  const out: Array<{ line: number; sql: string; comments: string[] }> = [];
  let buf: string[] = [];
  let start = 0;
  let pendingComments: string[] = [];
  let comments: string[] = [];
  let inDollar = false;
  const flush = () => {
    const s = buf.join('\n').trim();
    if (s) out.push({ line: start + 1, sql: s, comments });
    buf = [];
    comments = [];
  };
  lines.forEach((raw, i) => {
    const l = raw.replace(/-->\s*statement-breakpoint/, '');
    const trimmed = l.trim();
    if (!buf.length && (trimmed.startsWith('--') || trimmed === '')) {
      if (trimmed.startsWith('--')) pendingComments.push(trimmed);
      else if (pendingComments.length > 3) pendingComments = pendingComments.slice(-3);
      if (raw.includes('statement-breakpoint')) flush();
      return;
    }
    if (!buf.length) {
      start = i;
      comments = pendingComments.slice(-3);
      pendingComments = [];
    }
    buf.push(l);
    const dollars = (l.match(/\$\$/g) ?? []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && (/;\s*(--.*)?$/.test(l) || raw.includes('statement-breakpoint'))) flush();
  });
  flush();
  return out;
}

/** Bỏ chú thích dòng `--` và chuỗi '…' để regex không bắt nhầm trong comment/literal */
function codeOnly(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Kiểm một tệp migration (thuần) */
export function checkMigrationSql(file: string, text: string): GuardViolation[] {
  const v: GuardViolation[] = [];
  for (const st of splitStatements(text)) {
    const allowed = st.comments.some((c) => ALLOW_RE.test(c)) || st.sql.split('\n').some((l) => ALLOW_RE.test(l));
    if (allowed) continue;
    const code = codeOnly(st.sql);
    for (const r of RULES) {
      if (!r.re.test(code)) continue;
      if (r.rule === 'create_index_blocking') {
        const concurrentSafe = /\bIF\s+NOT\s+EXISTS\b/i.test(code) && (st.comments.some((c) => CONCURRENT_SAFE_RE.test(c)) || CONCURRENT_SAFE_RE.test(st.sql));
        // Chỉ áp cho index trên bảng đã tồn tại: CREATE INDEX ngay sau CREATE TABLE cùng tệp được coi là bảng mới (xem guardFile)
        if (concurrentSafe) continue;
      }
      v.push({ file, line: st.line, rule: r.rule, statement: st.sql.replace(/\s+/g, ' ').slice(0, 160) });
    }
  }
  return v;
}

/** Bảng được tạo trong chính tệp (index trên bảng mới không khoá dữ liệu sẵn có) */
export function tablesCreatedIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of codeOnly(text).matchAll(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w]+"?\."?[\w]+"?|"?[\w]+"?)/gi)) out.add(m[1]!.replace(/"/g, '').toLowerCase());
  return out;
}

/** Kiểm tệp có xét bảng mới: CREATE INDEX trên bảng tạo cùng tệp → bỏ qua `create_index_blocking` */
export function guardFile(file: string, text: string): GuardViolation[] {
  const fresh = tablesCreatedIn(text);
  return checkMigrationSql(file, text).filter((x) => {
    if (x.rule !== 'create_index_blocking') return true;
    const m = /\bON\s+(?:ONLY\s+)?("?[\w]+"?\."?[\w]+"?|"?[\w]+"?)/i.exec(x.statement);
    return !(m && fresh.has(m[1]!.replace(/"/g, '').toLowerCase()));
  });
}

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
