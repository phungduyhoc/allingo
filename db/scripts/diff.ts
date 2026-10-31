 
/**
 * pnpm db:diff — kiểm tra 3 điều:
 *  1) db/drizzle/migrations (áp dụng vào DB tạm "mig") tương đương docs/spec/allingo-schema.sql (áp dụng vào DB tạm "spec")
 *  2) Drizzle schema TS (db/drizzle/schema) khớp bảng/cột/kiểu với DB "mig"
 *  3) (tuỳ chọn, --live) DB đang chạy (DATABASE_URL) tương đương "mig" – phát hiện drift do sửa tay
 * Thoát mã 1 nếu có khác biệt. Cần quyền CREATE DATABASE trên server dev/CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import * as schema from '../drizzle/schema/index.js';
import { diffSnapshots, snapshotSchema } from '../src/schema-snapshot.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const baseUrl =
  process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
const specPath = path.resolve(here, '../../docs/spec/allingo-schema.sql');
const migrationsFolder = path.resolve(here, '../drizzle/migrations');
const live = process.argv.includes('--live');

const withDb = (name: string) => {
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  return u.toString();
};

async function recreate(admin: postgres.Sql, name: string) {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
}

const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
const specDb = 'allingo_diff_spec';
const migDb = 'allingo_diff_mig';
let failures = 0;
try {
  await recreate(admin, specDb);
  await recreate(admin, migDb);

  // 1a) spec
  const specSql = postgres(withDb(specDb), { max: 1, onnotice: () => undefined });
  await specSql.unsafe(fs.readFileSync(specPath, 'utf8'));
  // 1b) migrations
  const migSql = postgres(withDb(migDb), { max: 1, onnotice: () => undefined });
  await migrate(drizzle(migSql), {
    migrationsFolder,
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations',
  });

  const specSnap = await snapshotSchema(specSql);
  const migSnap = await snapshotSchema(migSql);
  const d1 = diffSnapshots(specSnap, migSnap);
  if (d1.length) {
    failures += d1.length;
    console.error(`✘ [1] migrations ≠ docs/spec/allingo-schema.sql: ${d1.length} khác biệt`);
    for (const d of d1.slice(0, 40))
      console.error(`   - ${d.path}\n       spec: ${JSON.stringify(d.left)}\n       mig : ${JSON.stringify(d.right)}`);
  } else
    console.log(
      `✔ [1] migrations tương đương spec (${Object.keys(migSnap.tables).length} bảng, ${Object.keys(migSnap.indexes).length} index, ${Object.keys(migSnap.policies).length} policy)`,
    );

  // 2) Drizzle TS vs mig DB
  const normalizeType = (t: string) =>
    t
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace('timestamp with time zone', 'timestamptz')
      .replace('timestamp (\\d+) with time zone', 'timestamptz')
      .replace(/^character varying/, 'varchar')
      .replace(/^character\((\d+)\)$/, 'char($1)')
      .replace(/^double precision$/, 'float8')
      .replace(/^integer$/, 'int4')
      .replace(/^int$/, 'int4')
      .replace(/^bigint$/, 'int8')
      .replace(/^smallint$/, 'int2')
      .replace(/^boolean$/, 'bool')
      .replace(/^real$/, 'float4')
      .replace(/^serial$/, 'int4')
      .replace(/^bigserial$/, 'int8')
      .replace(/^numeric\((\d+), (\d+)\)$/, 'numeric($1,$2)')
      .replace(/\[\]$/, '[]')
      .replace(/^"?(\w+)"?\."?(\w+)"?$/, '$1.$2');
  const d2: string[] = [];
  const seenTables = new Set<string>();
  for (const [exportName, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    if (!cfg.schema) continue;
    const key = `${cfg.schema}.${cfg.name}`;
    seenTables.add(key);
    const dbTable = migSnap.tables[key];
    if (!dbTable) {
      d2.push(`${exportName}: bảng ${key} không có trong migrations`);
      continue;
    }
    const dbCols = new Set(Object.keys(dbTable.columns));
    for (const col of cfg.columns) {
      const dbDef = dbTable.columns[col.name];
      if (!dbDef) {
        d2.push(`${key}.${col.name}: cột có trong Drizzle, không có trong DB`);
        continue;
      }
      dbCols.delete(col.name);
      const dbType = normalizeType(dbDef.split(' NOT NULL')[0]!.split(' NULL')[0]!);
      let tsType = normalizeType(col.getSQLType());
      // Drizzle enum trả tên enum không có schema → so phần tên
      if (!tsType.includes('.') && dbType.includes('.'))
        tsType = dbType.split('.')[0] + '.' + tsType.replace(/^"|"$/g, '');
      if (
        dbType !== tsType &&
        !(tsType === 'citext' && dbType === 'citext') &&
        !(tsType.startsWith('vector') && dbType.startsWith('vector'))
      )
        d2.push(`${key}.${col.name}: kiểu Drizzle "${tsType}" ≠ DB "${dbType}"`);
      const dbNotNull = dbDef.includes(' NOT NULL');
      if (col.notNull !== dbNotNull) d2.push(`${key}.${col.name}: notNull Drizzle=${col.notNull} ≠ DB=${dbNotNull}`);
    }
    for (const extra of dbCols) d2.push(`${key}.${extra}: cột có trong DB, thiếu trong Drizzle`);
  }
  for (const key of Object.keys(migSnap.tables))
    if (!seenTables.has(key)) d2.push(`${key}: bảng có trong DB, thiếu trong Drizzle schema`);
  if (d2.length) {
    failures += d2.length;
    console.error(`✘ [2] Drizzle schema ≠ DB: ${d2.length} khác biệt`);
    for (const line of d2.slice(0, 60)) console.error(`   - ${line}`);
  } else console.log(`✔ [2] Drizzle schema khớp ${seenTables.size} bảng`);

  // 3) live drift
  if (live) {
    const liveSnap = await snapshotSchema(admin);
    const d3 = diffSnapshots(migSnap, liveSnap);
    if (d3.length) {
      failures += d3.length;
      console.error(`✘ [3] DB đang chạy lệch migrations: ${d3.length} khác biệt`);
      for (const d of d3.slice(0, 40))
        console.error(`   - ${d.path}: mig=${JSON.stringify(d.left)} live=${JSON.stringify(d.right)}`);
    } else console.log('✔ [3] DB đang chạy khớp migrations');
  }

  await specSql.end();
  await migSql.end();
  await admin.unsafe(`DROP DATABASE IF EXISTS "${specDb}" WITH (FORCE)`);
  await admin.unsafe(`DROP DATABASE IF EXISTS "${migDb}" WITH (FORCE)`);
} catch (err) {
  console.error('✘ db:diff lỗi:', err);
  failures++;
} finally {
  await admin.end();
}
process.exit(failures ? 1 : 0);
