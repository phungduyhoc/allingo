import { defineConfig } from 'drizzle-kit';

// Dùng cho drizzle-kit pull/studio. Migration áp dụng bằng scripts/migrate.ts (SQL thuần có partition/RLS).
export default defineConfig({
  dialect: 'postgresql',
  schema: './drizzle/schema/index.ts',
  out: './.pull',
  dbCredentials: { url: process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo' },
  schemaFilter: ['iam', 'catalog', 'learn', 'ai', 'billing', 'ops'],
  // Bỏ qua partition con (vd: attempt_answers_2026_11) và bảng của drizzle
  tablesFilter: ['!*_20[0-9][0-9][0-9][0-9]', '!__drizzle_migrations'],
  entities: { roles: { provider: 'none', exclude: ['allingo', 'allingo_app', 'postgres'] } },
  strict: true,
  verbose: false,
});
