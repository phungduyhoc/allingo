import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, ensureMonthPartitions } from '@allingo/db';
import { seedBilling, seedCatalog, seedDemo, seedPrompts } from '@allingo/db/seed';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { loadEnv, resetEnvCache } from '../../src/config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../../../db/drizzle/migrations');

/** DB test riêng (allingo_test) – tạo nếu chưa có, migrate + seed core/demo (idempotent) */
export async function prepareTestDatabase(): Promise<string> {
  const base = process.env.TEST_DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo_test';
  const u = new URL(base);
  const dbName = u.pathname.slice(1);
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists) await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const sql = postgres(base, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(sql), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  await sql.end();
  const { db, sql: s2 } = createDb({ url: base, max: 2 });
  await ensureMonthPartitions(db, 1);
  await seedCatalog(db);
  await seedBilling(db);
  await seedPrompts(db);
  await seedDemo(db);
  await s2.end();
  return base;
}

export async function bootTestApp(): Promise<NestFastifyApplication> {
  const url = await prepareTestDatabase();
  process.env.DATABASE_URL = url;
  process.env.DATABASE_URL_MIGRATE = url;
  process.env.APP_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.AI_PROVIDER = 'mock';
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-secret-at-least-32-characters-long-ok';
  process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
  resetEnvCache();
  const env = loadEnv();
  const { createApp } = await import('../../src/bootstrap.js');
  const app = await createApp(env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** Tiện ích gọi API bằng inject + cookie jar đơn giản */
export function client(app: NestFastifyApplication) {
  const fastify = app.getHttpAdapter().getInstance();
  let cookies: Record<string, string> = {};
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fastify.inject({ method, url: `/v1${url}`, payload: body === undefined ? undefined : (body as Record<string, unknown>), headers: { 'content-type': 'application/json', ...headers }, cookies });
    for (const c of res.cookies as Array<{ name: string; value: string }>) cookies[c.name] = c.value;
    let json: unknown = null;
    try {
      json = res.json();
    } catch {
      json = res.body;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- body kiểm tra động trong test
    return { status: res.statusCode, body: json as any, headers: res.headers, raw: res.body };
  };
  return { call, reset: () => (cookies = {}), cookies: () => cookies };
}
