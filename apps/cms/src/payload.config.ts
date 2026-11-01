import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { en } from 'payload/i18n/en';
import { vi } from 'payload/i18n/vi';
import sharp from 'sharp';
import { buildMedia, Lessons, Passages, PromptTemplates, PromptVersions, Questions, TestSets, Users, VocabItems } from './collections/index';
import { getEnv } from './lib/env';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const env = getEnv();

/**
 * Payload CMS 3 – soạn thảo nội dung Allingo. Bảng của Payload nằm trong schema PostgreSQL `cms`
 * (ADR-0019), tách biệt 6 schema nghiệp vụ; phát hành đi qua API nội bộ, không ghi catalog.* trực tiếp.
 */
export default buildConfig({
  serverURL: env.CMS_PUBLIC_URL,
  secret: env.PAYLOAD_SECRET,
  cors: ['http://localhost:3000', 'http://localhost:3001', env.CMS_PUBLIC_URL],
  csrf: ['http://localhost:3000', 'http://localhost:3001', env.CMS_PUBLIC_URL],
  routes: { admin: '/admin', api: '/api' },
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    meta: { titleSuffix: ' – Allingo CMS' },
    components: {
      afterNavLinks: ['/components/import-nav-link#ImportNavLink'],
      views: {
        importQuestions: { Component: '/components/import-view#ImportView', path: '/import-questions', exact: true },
        aiGenerate: { Component: '/components/ai-generate-view#AiGenerateView', path: '/ai-generate', exact: true },
      },
    },
    dateFormat: 'dd/MM/yyyy HH:mm',
  },
  i18n: { supportedLanguages: { vi, en }, fallbackLanguage: 'en' },
  editor: lexicalEditor(),
  collections: [Users, buildMedia(env.CMS_MEDIA_DIR ?? path.resolve(dirname, '../media')), Passages, Questions, TestSets, Lessons, VocabItems, PromptTemplates, PromptVersions],
  graphQL: { disable: true },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URL },
    schemaName: env.CMS_DATABASE_SCHEMA,
    idType: 'uuid',
    // Dev: Payload tự đồng bộ bảng (drizzle push) trong schema cms; prod dùng migration
    push: env.NODE_ENV !== 'production',
    migrationDir: path.resolve(dirname, '../migrations'),
    beforeSchemaInit: [
      // Bảo đảm schema `cms` tồn tại trước khi drizzle push (adapter không tự tạo schema ở mọi phiên bản)
      async ({ adapter, schema }) => {
        // Kiểu công khai của hook không lộ `pg`/`poolOptions` nhưng adapter db-postgres luôn có (xem dist/types.d.ts)
        const a = adapter as unknown as { pg: { Pool: new (opts: unknown) => { query(sql: string): Promise<unknown>; end(): Promise<void> } }; poolOptions: unknown };
        const pool = new a.pg.Pool(a.poolOptions);
        try {
          await pool.query(`CREATE SCHEMA IF NOT EXISTS "${env.CMS_DATABASE_SCHEMA.replace(/"/g, '')}"`);
        } catch (err) {
          // Không chặn khởi động: nếu thiếu quyền, drizzle push sẽ báo lỗi rõ hơn
          console.warn('[cms] không tạo được schema cms:', err instanceof Error ? err.message : err);
        } finally {
          await pool.end();
        }
        return schema;
      },
    ],
  }),
  upload: { limits: { fileSize: 25 * 1024 * 1024 } },
  sharp,
  telemetry: false,
});
