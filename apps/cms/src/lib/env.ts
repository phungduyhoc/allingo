import { z } from 'zod';

/**
 * Biến môi trường của apps/cms – validate lúc khởi động (CLAUDE.md §9: không secret trong mã).
 * Giá trị mặc định chỉ dành cho dev cục bộ; production phải đặt đầy đủ.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1).default('postgres://allingo:allingo@localhost:5432/allingo'),
  CMS_DATABASE_SCHEMA: z.string().min(1).default('cms'),
  PAYLOAD_SECRET: z.string().min(8).default('dev-payload-secret-change-me'),
  CMS_PUBLIC_URL: z.string().url().default('http://localhost:3001'),
  INTERNAL_API_URL: z.string().url().default('http://localhost:4000/v1'),
  INTERNAL_API_TOKEN: z.string().min(1).default('dev-internal-token'),
  CMS_MEDIA_DIR: z.string().optional(),
  /** Thời gian chờ gọi API nội bộ (ms) */
  INTERNAL_API_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(15_000),
});

export type CmsEnv = z.infer<typeof envSchema>;

let cached: CmsEnv | null = null;

export function getEnv(): CmsEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Biến môi trường apps/cms không hợp lệ: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
