import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres, { type Sql } from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql } from 'drizzle-orm';
import { createDb, ensureMonthPartitions, PARTITIONED_TABLES, withRls, type Db } from '../src/index.js';
import * as schema from '../drizzle/schema/index.js';
import { seedBilling, seedCatalog, seedPrompts } from '../seed/index.js';

/**
 * Test tích hợp lớp dữ liệu trên PostgreSQL thật (DB riêng `allingo_dbtest`, tạo lại mỗi lần chạy):
 * migration 0001 áp dụng sạch, partition theo tháng idempotent, seed core idempotent,
 * withRls + vai trò không BYPASSRLS chặn dữ liệu khác tổ chức (CLAUDE.md §5.10).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../drizzle/migrations');
const base = process.env.TEST_DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo_test';

const dbUrl = (() => {
  const u = new URL(base);
  u.pathname = '/allingo_dbtest';
  return u.toString();
})();

let db: Db;
let raw: Sql;

beforeAll(async () => {
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`DROP DATABASE IF EXISTS allingo_dbtest WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE allingo_dbtest`);
  await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'allingo_app') THEN CREATE ROLE allingo_app LOGIN PASSWORD 'allingo_app' NOSUPERUSER NOBYPASSRLS; END IF; END $$;`);
  await admin.end();

  const m = postgres(dbUrl, { max: 1, onnotice: () => undefined });
  await migrate(drizzle(m), { migrationsFolder, migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' });
  await m.end();

  const c = createDb({ url: dbUrl, max: 3, applicationName: 'db-test' });
  db = c.db;
  raw = c.sql;
});

afterAll(async () => {
  await raw?.end();
});

describe('migration 0001', () => {
  it('tạo đủ 6 schema và 99 bảng như docs/spec/allingo-schema.sql (v1.1 – S6: + ops.push_subscriptions; S8: + billing.promotion_redemptions)', async () => {
    const rows = await raw<{ n: string }[]>`
      select count(*)::text as n from pg_tables
      where schemaname in ('iam','catalog','learn','ai','billing','ops')
        and tablename !~ '_20[0-9]{4}$'`;
    expect(Number(rows[0]?.n)).toBe(99);
    const ext = await raw<{ extname: string }[]>`select extname from pg_extension`;
    const names = ext.map((e) => e.extname);
    expect(names).toEqual(expect.arrayContaining(['vector', 'citext', 'pg_trgm']));
  });

  it('bật RLS đúng 4 bảng B2B với policy org_scope_*', async () => {
    const rows = await raw<{ t: string }[]>`
      select schemaname||'.'||tablename as t from pg_tables
      where rowsecurity and schemaname in ('iam','catalog','learn','ai','billing','ops') order by 1`;
    expect(rows.map((r) => r.t)).toEqual(['iam.classes', 'iam.org_memberships', 'learn.assignment_submissions', 'learn.assignments']);
    const pol = await raw<{ n: string }[]>`select count(*)::text as n from pg_policies where policyname like 'org_scope_%'`;
    expect(Number(pol[0]?.n)).toBe(4);
  });
});

describe('partition theo tháng', () => {
  it('ensureMonthPartitions idempotent, ghi được vào bảng partition', async () => {
    const first = await ensureMonthPartitions(db, 1);
    const second = await ensureMonthPartitions(db, 1);
    expect(first).toEqual(second);
    expect(first).toHaveLength(PARTITIONED_TABLES.length * 2);

    const ym = new Date().toISOString().slice(0, 7).replace('-', '');
    const parts = await raw<{ tablename: string }[]>`select tablename from pg_tables where tablename like ${'%_' + ym}`;
    expect(parts.map((p) => p.tablename).sort()).toEqual(PARTITIONED_TABLES.map((t) => `${t.table}_${ym}`).sort());

    const [row] = await db
      .insert(schema.opsOutbox)
      .values({ eventType: 'test.created', aggregateType: 'test', aggregateId: '00000000-0000-0000-0000-000000000001', payload: { ok: true } })
      .returning({ id: schema.opsOutbox.id, createdAt: schema.opsOutbox.createdAt });
    expect(row?.id).toBeTruthy();
    const found = await db.select().from(schema.opsOutbox).where(eq(schema.opsOutbox.id, row!.id));
    expect(found).toHaveLength(1);
  });
});

describe('seed core', () => {
  it('seed catalog/billing/prompts chạy 2 lần không nhân đôi dữ liệu', async () => {
    await seedCatalog(db);
    await seedBilling(db);
    await seedPrompts(db);
    const count = async () => ({
      programs: (await db.select().from(schema.catalogPrograms)).length,
      plans: (await db.select().from(schema.billingPlans)).length,
      roles: (await db.select().from(schema.iamRoles)).length,
      prompts: (await db.select().from(schema.aiPromptVersions)).length,
    });
    const a = await count();
    await seedCatalog(db);
    await seedBilling(db);
    await seedPrompts(db);
    const b = await count();
    expect(a).toEqual(b);
    expect(a.programs).toBe(4);
    expect(a.prompts).toBeGreaterThanOrEqual(14);
    expect(a.roles).toBeGreaterThanOrEqual(5);
    const free = await db.select().from(schema.billingPlans).where(eq(schema.billingPlans.code, 'free'));
    expect(free[0]?.kind).toBe('free');
  });
});

describe('withRls + vai trò allingo_app', () => {
  let orgA = '';
  let orgB = '';
  let appDb: ReturnType<typeof createDb> | null = null;

  beforeAll(async () => {
    await raw.unsafe(`GRANT USAGE ON SCHEMA iam, learn TO allingo_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA iam, learn TO allingo_app;`);
    const [a] = await db.insert(schema.iamOrganizations).values({ name: 'Trường A', type: 'school' }).returning({ id: schema.iamOrganizations.id });
    const [b] = await db.insert(schema.iamOrganizations).values({ name: 'Trung tâm B', type: 'center' }).returning({ id: schema.iamOrganizations.id });
    orgA = a!.id;
    orgB = b!.id;
    await db.insert(schema.iamClasses).values([
      { orgId: orgA, name: 'A-01', programCode: 'toeic' },
      { orgId: orgA, name: 'A-02', programCode: 'toeic' },
      { orgId: orgB, name: 'B-01', programCode: 'ielts' },
    ]);
    const u = new URL(dbUrl);
    u.username = 'allingo_app';
    u.password = 'allingo_app';
    appDb = createDb({ url: u.toString(), max: 2, applicationName: 'db-test-app' });
  });

  afterAll(async () => {
    await appDb?.sql.end();
  });

  it('vai trò allingo_app không có BYPASSRLS', async () => {
    const r = await raw<{ rolbypassrls: boolean; rolsuper: boolean }[]>`select rolbypassrls, rolsuper from pg_roles where rolname = 'allingo_app'`;
    expect(r[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it('org_admin chỉ thấy lớp của tổ chức mình; không SET LOCAL thì không thấy gì', async () => {
    const mine = await withRls(appDb!.db, { orgId: orgA, role: 'org_admin' }, (tx) => tx.select({ name: schema.iamClasses.name }).from(schema.iamClasses));
    expect(mine.map((c) => c.name).sort()).toEqual(['A-01', 'A-02']);

    const other = await withRls(appDb!.db, { orgId: orgB, role: 'org_admin' }, (tx) => tx.select().from(schema.iamClasses));
    expect(other.map((c) => c.name)).toEqual(['B-01']);

    const none = await appDb!.db.select().from(schema.iamClasses);
    expect(none).toHaveLength(0);
  });

  it('role admin/service thấy toàn bộ; SET LOCAL không rò sang transaction khác', async () => {
    const all = await withRls(appDb!.db, { role: 'service' }, (tx) => tx.select().from(schema.iamClasses));
    expect(all).toHaveLength(3);
    const after = await appDb!.db.execute(sql`select current_setting('app.role', true) as role`);
    expect((after[0] as { role: string | null }).role ?? '').toBe('');
  });

  it('owner (allingo) không bị RLS vì là chủ bảng – chỉ dùng cho migrate/seed', async () => {
    const all = await db.select().from(schema.iamClasses);
    expect(all).toHaveLength(3);
  });
});
