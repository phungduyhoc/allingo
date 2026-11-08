// Áp dụng migration SQL trong drizzle/migrations theo meta/_journal.json (drizzle migrator)
//
// S11 – bước "concurrent-safe" trước drizzle migrate: với migration CHƯA áp, mỗi câu lệnh có chú thích `-- concurrent-safe`
// dạng `CREATE [UNIQUE] INDEX IF NOT EXISTS <tên> ON <schema.bảng> …` mà bảng đã tồn tại (DB đang chạy, có dữ liệu) được
// chạy trước bằng `CREATE INDEX CONCURRENTLY` NGOÀI transaction (drizzle chạy mọi migration trong một transaction – CONCURRENTLY
// không được phép trong đó). Lệnh trong migration sau đó là no-op. Index INVALID còn sót (lần trước lỗi) → DROP CONCURRENTLY rồi
// tạo lại. Bảng partition (cha) không hỗ trợ CONCURRENTLY → để migration tạo trong transaction (ghi chú runbook deploy).
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { splitStatements } from '../src/migration-guard.js';

// Chạy cục bộ: nạp .env (thư mục db/ rồi gốc repo) như API – biến đã có trong process.env (CI/staging) không bị ghi đè
for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../.env')]) {
  if (fs.existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const url = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Thiếu DATABASE_URL_MIGRATE/DATABASE_URL');
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../drizzle/migrations');

const sql = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle(sql);
const started = Date.now();

const INDEX_RE = /^\s*CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+("?[\w]+"?)\s+ON\s+(?!ONLY\b)("?[\w]+"?\.?"?[\w]*"?)/i;

async function preCreateConcurrentIndexes(): Promise<void> {
  const [t] = await sql<{ ok: boolean }[]>`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
  if (!t?.ok) return; // DB mới: không có dữ liệu – để migration tạo như thường
  const [last] = await sql<{ at: string | null }[]>`select max(created_at)::text as at from drizzle.__drizzle_migrations`;
  const appliedUntil = Number(last?.at ?? 0);
  const journal = JSON.parse(fs.readFileSync(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as { entries: Array<{ tag: string; when: number }> };
  for (const e of journal.entries.filter((x) => x.when > appliedUntil)) {
    const text = fs.readFileSync(path.join(migrationsFolder, `${e.tag}.sql`), 'utf8');
    for (const st of splitStatements(text)) {
      if (!st.comments.some((c) => /--\s*concurrent-safe\b/i.test(c))) continue;
      const m = INDEX_RE.exec(st.sql);
      if (!m) continue;
      const name = m[2]!.replace(/"/g, '');
      const table = m[3]!.replace(/"/g, '');
      const [rel] = await sql<{ kind: string | null }[]>`select (select relkind::text from pg_class where oid = to_regclass(${table})) as kind`;
      if (!rel?.kind) continue; // bảng chưa có → migration tạo cùng bảng
      if (rel.kind === 'p') {
        console.log(`  · ${e.tag}: ${name} trên bảng partition ${table} – tạo trong transaction migration (không CONCURRENTLY)`);
        continue;
      }
      const schemaName = table.includes('.') ? table.split('.')[0]! : 'public';
      const [idx] = await sql<{ valid: boolean }[]>`
        select i.indisvalid as valid from pg_index i join pg_class c on c.oid = i.indexrelid join pg_namespace n on n.oid = c.relnamespace
        where c.relname = ${name} and n.nspname = ${schemaName}`;
      if (idx?.valid) continue;
      if (idx && !idx.valid) {
        console.log(`  · ${name} INVALID (lần trước lỗi) → DROP INDEX CONCURRENTLY`);
        await sql.unsafe(`DROP INDEX CONCURRENTLY IF EXISTS "${schemaName}"."${name}"`);
      }
      const t0 = Date.now();
      await sql.unsafe(st.sql.replace(/INDEX\s+IF\s+NOT\s+EXISTS/i, 'INDEX CONCURRENTLY IF NOT EXISTS'));
      console.log(`  ✔ ${e.tag}: CREATE INDEX CONCURRENTLY ${name} ON ${table} (${Date.now() - t0} ms)`);
    }
  }
}

try {
  await preCreateConcurrentIndexes();
  await migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  console.log(`✔ migration xong trong ${Date.now() - started} ms (${migrationsFolder})`);
} catch (err) {
  console.error('✘ migration lỗi:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
