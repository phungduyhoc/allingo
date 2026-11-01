import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Biến môi trường được validate một lần lúc khởi động (CLAUDE.md §9, master prompt §5.4).
 * Không giá trị thật ở đây; xem .env.example ở gốc repo.
 */
const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1'));

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  TZ: z.string().default('Asia/Ho_Chi_Minh'),

  DATABASE_URL: z.string().min(1),
  DATABASE_URL_REPLICA: z.string().optional(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  REDIS_URL: z.string().default('redis://localhost:6379'),
  QUEUE_PREFIX: z.string().default('allingo'),

  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('ap-southeast-1'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_BUCKET_MEDIA: z.string().default('allingo-media'),
  S3_BUCKET_RECORDINGS: z.string().default('allingo-recordings'),
  S3_FORCE_PATH_STYLE: bool(true),
  S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  S3_PUBLIC_BASE_URL: z.string().optional(),
  // Sprint 2 – driver lưu trữ: rỗng = tự chọn (APP_ENV=test → fs, còn lại → s3). fs chỉ dùng cho dev/test (ADR-0025)
  STORAGE_DRIVER: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['s3', 'fs']).optional()),
  STORAGE_FS_DIR: z.string().default('./.storage'),
  // Sprint 2 – media pipeline (ffmpeg/ffprobe trong image worker) và TTS
  FFMPEG_PATH: z.string().default('ffmpeg'),
  FFPROBE_PATH: z.string().default('ffprobe'),
  MEDIA_FFMPEG_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  TTS_DEFAULT_VOICE: z.string().default('en-US-JennyNeural'),

  MEILISEARCH_HOST: z.string().default('http://localhost:7700'),
  MEILISEARCH_API_KEY: z.string().optional(),
  /** auto: Meilisearch khi sẵn sàng, nếu không dùng PostgreSQL (pg_trgm/ILIKE); meili | pg: ép buộc */
  SEARCH_PROVIDER: z.enum(['auto', 'meili', 'pg']).default('auto'),
  SEARCH_INDEX_PREFIX: z.string().default('allingo_'),

  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().default('http://localhost:3000'),
  CMS_PUBLIC_URL: z.string().default('http://localhost:3001'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  TRUST_PROXY: bool(false),
  RATE_LIMIT_MAX: z.coerce.number().int().default(300),
  BODY_LIMIT_BYTES: z.coerce.number().int().default(2 * 1024 * 1024),
  INTERNAL_API_TOKEN: z.string().default('dev-internal-token'),

  AUTH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().default(30 * 24 * 3600),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  FACEBOOK_CLIENT_ID: z.string().optional(),
  FACEBOOK_CLIENT_SECRET: z.string().optional(),
  OTP_DEV_FIXED_CODE: z.string().optional(),
  OTP_SENDER: z.enum(['auto', 'memory', 'console']).default('auto'),
  OTP_TTL_SECONDS: z.coerce.number().int().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  OTP_LOCK_MINUTES: z.coerce.number().int().default(30),
  OTP_REQUEST_LIMIT: z.coerce.number().int().default(3),
  OTP_REQUEST_WINDOW_MINUTES: z.coerce.number().int().default(15),
  ESMS_API_KEY: z.string().optional(),
  ZALO_ZNS_ACCESS_TOKEN: z.string().optional(),
  OAUTH_MOCK: bool(false),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  TURNSTILE_SECRET: z.string().optional(),
  POLICY_VERSION: z.string().default('2026-11'),
  PURGE_DELAY_MINUTES: z.coerce.number().int().default(72 * 60),
  PURGE_SCAN_INTERVAL_SECONDS: z.coerce.number().int().default(600),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('Allingo <no-reply@allingo.vn>'),

  AI_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  AI_TRACE_CONTENT: bool(false),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_FLASH_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_PRO_MODEL: z.string().default('gemini-2.5-pro'),
  CLAUDE_SONNET_MODEL: z.string().default('claude-sonnet-4-5'),
  CLAUDE_HAIKU_MODEL: z.string().default('claude-haiku-4-5'),
  OPENAI_GPT_MODEL: z.string().default('gpt-5'),
  OPENAI_GPT_MINI_MODEL: z.string().default('gpt-5-mini'),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
  ALLOW_UNEVALUATED_ACTIVATION: bool(true),

  SPEECH_PROVIDER: z.enum(['mock', 'azure']).default('mock'),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),

  PAYMENT_PROVIDERS: z.string().default('mock'),

  OTEL_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().default('allingo-api'),
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Đọc & validate env (memo). Ném lỗi rõ ràng liệt kê biến sai. */
/** Nạp .env (cwd rồi gốc repo) bằng process.loadEnvFile (Node ≥ 20.12) – biến đã có trong process.env không bị ghi đè */
export function loadDotEnv(): void {
  for (const candidate of [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')]) {
    if (fs.existsSync(candidate)) {
      try {
        process.loadEnvFile(candidate);
      } catch {
        /* bỏ qua */
      }
      return;
    }
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  if (source === process.env) loadDotEnv();
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCache(): void {
  cached = null;
}

export const ENV = Symbol('ENV');
