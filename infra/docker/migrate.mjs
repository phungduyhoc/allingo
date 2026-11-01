#!/usr/bin/env node
/**
 * Chạy migration Drizzle trong image runtime của apps/api (không có pnpm/tsx ở runtime).
 * Tương đương `pnpm db:migrate` (db/scripts/migrate.ts) nhưng chỉ dùng dependency production
 * (`drizzle-orm`, `postgres`) đã có trong node_modules của api. Image copy thư mục
 * `db/drizzle/migrations` vào `/app/db/drizzle/migrations` (xem apps/api/Dockerfile).
 *
 * Dùng: `node /app/migrate.mjs`  (Container Apps Job `allingo-<env>-migrate`, hoặc compose.staging-like.yml)
 * Biến: DATABASE_URL_MIGRATE (ưu tiên) hoặc DATABASE_URL.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const url = process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Thiếu DATABASE_URL_MIGRATE/DATABASE_URL');
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR ?? path.resolve(here, 'db/drizzle/migrations');

// Không in chuỗi kết nối (chứa mật khẩu) ra log
const sql = postgres(url, { max: 1, onnotice: () => undefined, ssl: url.includes('sslmode=require') ? 'require' : undefined });
const db = drizzle(sql);
const started = Date.now();
try {
  await migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  console.log(`migration xong trong ${Date.now() - started} ms (${migrationsFolder})`);
} catch (err) {
  console.error('migration lỗi:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
