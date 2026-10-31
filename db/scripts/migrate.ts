 
// Áp dụng migration SQL trong drizzle/migrations theo meta/_journal.json (drizzle migrator)
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
const migrationsFolder = path.resolve(here, '../drizzle/migrations');

const sql = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle(sql);
const started = Date.now();
try {
  await migrate(db, { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  console.log(`✔ migration xong trong ${Date.now() - started} ms (${migrationsFolder})`);
} catch (err) {
  console.error('✘ migration lỗi:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
