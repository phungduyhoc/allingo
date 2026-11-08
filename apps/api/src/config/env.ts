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
  // S11 – đo độ trễ mọi truy vấn (histogram db_query_duration_seconds) + log/counter truy vấn chậm hơn ngưỡng (0 = tắt log)
  DB_QUERY_METRICS: bool(true),
  DB_SLOW_QUERY_MS: z.coerce.number().int().min(0).max(60_000).default(200),

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
  // S11 – giới hạn tốc độ: IP bỏ qua (dấu phẩy; healthcheck nội bộ/test), store Redis cho giới hạn toàn cục, token bucket theo route
  RATE_LIMIT_ALLOWLIST: z.string().default('127.0.0.1,::1'),
  RATE_LIMIT_REDIS: bool(true),
  RATE_LIMIT_BUCKETS_ENABLED: bool(true),
  RATE_LIMIT_BUCKET_MULTIPLIER: z.coerce.number().min(0.01).max(1000).default(1),
  // S11 – CSRF cho cookie-auth (kiểm Origin/Sec-Fetch-Site/Referer cho phương thức ghi) + origin tin cậy bổ sung (dấu phẩy)
  CSRF_PROTECTION: bool(true),
  CSRF_TRUSTED_ORIGINS: z.string().optional(),
  SECURITY_HSTS_PRELOAD: bool(false),
  // S11 – chống dò mật khẩu: N lần sai / cửa sổ → khoá đăng nhập theo email (áp như nhau cho email không tồn tại)
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(100).default(10),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  // S11 – thời gian phản hồi tối thiểu (ms, + jitter ≤ 10 %) cho login/register/otp – chống enumerate theo thời gian; 0 = tắt
  AUTH_MIN_RESPONSE_MS: z.coerce.number().int().min(0).max(5000).default(400),
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
  /** B7/S26 – outbox: thử lại consumer lỗi theo backoff mũ (base·2^(n−1), trần MAX) tới OUTBOX_MAX_ATTEMPTS lần → dead-letter */
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(10),
  OUTBOX_RETRY_BASE_SECONDS: z.coerce.number().int().min(0).max(3600).default(10),
  OUTBOX_RETRY_MAX_SECONDS: z.coerce.number().int().min(1).max(86_400).default(3600),
  /** Thời gian giữ chỗ (lease) một sự kiện đang giao – relay khác (replica worker) không nhận trùng; quá hạn → nhận lại */
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),

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
  // Sprint 5: chỉ có hiệu lực khi APP_ENV = development | test (staging/production luôn bắt buộc eval đạt ngưỡng)
  ALLOW_UNEVALUATED_ACTIVATION: bool(false),
  // Sprint 5 – AI Gateway mức sản xuất: retry có jitter (chỉ lỗi tạm thời), circuit breaker theo provider
  AI_RETRY_MAX: z.coerce.number().int().min(0).max(5).default(2),
  AI_RETRY_BASE_MS: z.coerce.number().int().min(1).max(10_000).default(300),
  AI_BREAKER_FAILURES: z.coerce.number().int().min(1).max(100).default(5),
  AI_BREAKER_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  AI_BREAKER_OPEN_MS: z.coerce.number().int().min(1000).default(60_000),
  // Embedding (dedup câu sinh AI): auto = theo AI_PROVIDER và khoá có sẵn (openai → google → mock)
  AI_EMBEDDING_PROVIDER: z.enum(['auto', 'mock', 'google', 'openai']).default('auto'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_DEDUP_COSINE_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.92),
  // B2: lọc trùng câu khi tạo/nhập/AI soạn đề – ngưỡng pg_trgm (fallback khi chưa có embedding) + số câu tương tự lưu kèm cờ
  CONTENT_DEDUP_TRGM_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.85),
  CONTENT_DEDUP_SIMILAR_LIMIT: z.coerce.number().int().min(1).max(10).default(3),
  LANGFUSE_FLUSH_INTERVAL_MS: z.coerce.number().int().min(200).default(2000),
  // Job nền (content.generate, summary.attempt, eval.run): true = chạy trong process API (dev không chạy worker); false = BullMQ
  JOBS_INLINE: bool(false),
  // Bảo vệ GET /v1/metrics (Prometheus): Bearer METRICS_TOKEN; trống → dùng INTERNAL_API_TOKEN (ADR-0026)
  METRICS_TOKEN: z.string().optional(),
  // Sprint 6 – gia sư: ngân sách token (ước lượng ký tự/4) cho ngữ cảnh + lịch sử của tutor_chat
  AI_TUTOR_CONTEXT_TOKENS: z.coerce.number().int().min(300).max(16_000).default(1800),

  // Sprint 6 – Web Push (VAPID). Trống → push tắt (POST /me/push-subscriptions 503). Sinh khoá dev: pnpm --filter @allingo/api push:vapid
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:dev@allingo.vn'),
  // auto: web-push khi có khoá VAPID; memory: sender giả trong process (test/dev không có trình duyệt nhận)
  PUSH_SENDER: z.enum(['auto', 'webpush', 'memory']).default('auto'),
  PUSH_TTL_SECONDS: z.coerce.number().int().min(0).max(2_419_200).default(3600),

  SPEECH_PROVIDER: z.enum(['mock', 'azure']).default('mock'),
  AZURE_SPEECH_KEY: z.string().optional(),
  AZURE_SPEECH_REGION: z.string().optional(),
  /** Số lần thử lại khi Azure trả 429/503 (F0: 20 giao dịch TTS/60 s); script seed:media tự nâng lên 10 */
  AZURE_SPEECH_MAX_RETRIES: z.coerce.number().int().min(0).max(20).default(3),

  // Sprint 7 – thanh toán (ADR-0012 webhook-first). Danh sách cổng bật; cổng thiếu credential → `unavailable` (không liệt kê cho client).
  // mock chỉ hoạt động khi APP_ENV ≠ production.
  PAYMENT_PROVIDERS: z.string().default('mock'),
  // Gốc URL công khai cổng gọi IPN/return (mặc định API_PUBLIC_URL; sandbox cần tunnel https, vd ngrok)
  PAYMENT_CALLBACK_BASE_URL: z.string().optional(),
  ORDER_EXPIRE_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),
  PAYMENT_RECONCILE_AFTER_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  PAYMENT_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
  // Khoá ký webhook giả lập (dev/test); production từ chối mock
  PAYMENT_MOCK_SECRET: z.string().default('mock-dev-secret'),
  // VNPay 2.1.0 (sandbox: https://sandbox.vnpayment.vn) – vnp_TmnCode + vnp_HashSecret (HMAC-SHA512)
  VNPAY_TMN_CODE: z.string().optional(),
  VNPAY_HASH_SECRET: z.string().optional(),
  VNPAY_PAY_URL: z.string().default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_API_URL: z.string().default('https://sandbox.vnpayment.vn/merchant_webapi/api/transaction'),
  // MoMo AIO v2 (sandbox: https://test-payment.momo.vn) – partnerCode/accessKey/secretKey (HMAC-SHA256)
  MOMO_PARTNER_CODE: z.string().optional(),
  MOMO_ACCESS_KEY: z.string().optional(),
  MOMO_SECRET_KEY: z.string().optional(),
  MOMO_ENDPOINT: z.string().default('https://test-payment.momo.vn'),
  MOMO_REQUEST_TYPE: z.enum(['captureWallet', 'payWithMethod', 'payWithATM', 'payWithCC']).default('captureWallet'),
  // ZaloPay API v2 (sandbox: https://sb-openapi.zalopay.vn) – app_id + key1 (tạo/query) + key2 (callback)
  ZALOPAY_APP_ID: z.string().optional(),
  ZALOPAY_KEY1: z.string().optional(),
  ZALOPAY_KEY2: z.string().optional(),
  ZALOPAY_ENDPOINT: z.string().default('https://sb-openapi.zalopay.vn'),
  // Lịch job billing (order.expire, payment.reconcile, subscription.expire, credit.*, billing.reconcile): worker luôn chạy;
  // API chạy khi `true` hoặc khi JOBS_INLINE=true (dev không có worker – A59); test không bao giờ tự chạy
  BILLING_SCHEDULER_IN_API: bool(false),

  // Sprint 8 – hoá đơn điện tử (ADR-0030, Proposed): mock (dev/test, PDF tự dựng) | misa (MISA meInvoice) | viettel (khung, chưa dùng được)
  EINVOICE_PROVIDER: z.enum(['mock', 'misa', 'viettel']).default('mock'),
  // Thuế GTGT trên hoá đơn: KCT (không chịu thuế – mặc định, cần kế toán xác nhận) | 0 | 5 | 8 | 10 (giá bán đã gồm thuế)
  EINVOICE_VAT_RATE: z.enum(['KCT', '0', '5', '8', '10']).default('KCT'),
  EINVOICE_SELLER_NAME: z.string().default('CONG TY TNHH ALLINGO (DEV)'),
  EINVOICE_SELLER_TAX_CODE: z.string().default('0000000000'),
  EINVOICE_SELLER_ADDRESS: z.string().default('Ha Noi, Viet Nam'),
  EINVOICE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(20_000),
  // MISA meInvoice (API tích hợp v2 – test: https://testapi.meinvoice.vn/api/integration). Thiếu credential → provider `unavailable`
  MISA_MEINVOICE_BASE_URL: z.string().default('https://testapi.meinvoice.vn/api/integration'),
  MISA_MEINVOICE_APP_ID: z.string().optional(),
  MISA_MEINVOICE_TAX_CODE: z.string().optional(),
  MISA_MEINVOICE_USERNAME: z.string().optional(),
  MISA_MEINVOICE_PASSWORD: z.string().optional(),
  // Ký hiệu hoá đơn (vd 1C26TAA – hoá đơn GTGT có mã CQT, năm 26) và kiểu ký (2 = HSM của MISA)
  MISA_MEINVOICE_INV_SERIES: z.string().default('1C26TAA'),
  MISA_MEINVOICE_SIGN_TYPE: z.coerce.number().int().default(2),
  // Viettel SInvoice (khung – S8 chưa triển khai gọi thật)
  VIETTEL_SINVOICE_BASE_URL: z.string().default('https://api-vinvoice.viettel.vn/services/einvoiceapplication/api'),
  VIETTEL_SINVOICE_USERNAME: z.string().optional(),
  VIETTEL_SINVOICE_PASSWORD: z.string().optional(),
  VIETTEL_SINVOICE_TEMPLATE_CODE: z.string().default('1/001'),
  VIETTEL_SINVOICE_INV_SERIES: z.string().default('C26TAA'),
  S3_BUCKET_INVOICES: z.string().default('allingo-invoices'),

  // Sprint 8 – email đa kênh: auto (test → memory, còn lại smtp) | smtp (Mailpit dev) | resend | ses (SMTP của Amazon SES) | memory
  EMAIL_PROVIDER: z.enum(['auto', 'smtp', 'resend', 'ses', 'memory']).default('auto'),
  RESEND_API_KEY: z.string().optional(),
  RESEND_API_URL: z.string().default('https://api.resend.com'),
  SES_REGION: z.string().default('ap-southeast-1'),
  SES_SMTP_USER: z.string().optional(),
  SES_SMTP_PASS: z.string().optional(),
  EMAIL_REPLY_TO: z.string().optional(),
  // Khoá ký link huỷ đăng ký (HMAC); trống → dẫn xuất từ AUTH_SECRET
  NOTIFY_UNSUBSCRIBE_SECRET: z.string().optional(),
  // Email nhận cảnh báo vận hành (hoá đơn vào dead-letter…); trống → chỉ thông báo in-app cho admin
  OPS_ALERT_EMAIL: z.string().optional(),
  // Sprint 8 – referral: gốc link chia sẻ (trang OG + chuyển hướng; trống → `${API_PUBLIC_URL}/v1/r`) và ảnh OG
  REFERRAL_SHARE_BASE_URL: z.string().optional(),
  REFERRAL_OG_IMAGE_URL: z.string().optional(),

  // Sprint 10 – thống kê & phễu: cache GET /me/stats (giây), sự kiện phễu server-side sang PostHog (không PII, user id băm)
  STATS_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(3600),
  // auto: có POSTHOG_KEY → posthog, APP_ENV=test → memory, còn lại none | posthog | memory | none
  ANALYTICS_SINK: z.enum(['auto', 'posthog', 'memory', 'none']).default('auto'),
  POSTHOG_KEY: z.string().optional(),
  POSTHOG_HOST: z.string().default('https://us.i.posthog.com'),
  // Muối băm distinct_id (sha256(salt:user_id)); trống → dẫn xuất từ AUTH_SECRET
  ANALYTICS_HASH_SALT: z.string().optional(),
  // Giờ gửi tóm tắt tuần sáng thứ Hai (giờ VN)
  WEEKLY_SUMMARY_HOUR_VN: z.coerce.number().int().min(0).max(23).default(8),

  OTEL_ENABLED: bool(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().default('allingo-api'),
  // S11 – tỉ lệ lấy mẫu trace (0–1, ParentBased TraceIdRatio); metrics/log không bị ảnh hưởng
  OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(1),
  // S11 – Sentry (adapter Envelope HTTP, không SDK): trống → tắt; release = SENTRY_RELEASE | GIT_SHA | allingo@<version>
  SENTRY_DSN: z.string().optional(),
  SENTRY_RELEASE: z.string().optional(),
  SENTRY_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  // S11 – cổng HTTP metrics của worker (GET /metrics, cùng token với API); 0 = tắt
  WORKER_METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  // S11 – cache trong process câu theo question_version_id (giây; 0 = tắt) – Review/đề lớn không lặp truy vấn catalog
  CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  // S11 – feature flag: TTL cache Redis (giây; PUT /admin/flags xoá ngay + pub/sub tới replica khác) – kill-switch hiệu lực < 60 s
  FLAGS_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(300).default(15),
  // S11 – backpressure hàng đợi: khi grading có ≥ N job chờ → tạm dừng worker notify/analytics tới khi grading ≤ N/2
  QUEUE_BACKPRESSURE_GRADING_DEPTH: z.coerce.number().int().min(1).max(1_000_000).default(200),

  // Sprint 12 – MFA TOTP cho admin/superadmin: auto = bắt buộc ở staging/production (dev/test tắt); true/false ép buộc
  ADMIN_MFA_REQUIRED: z.enum(['auto', 'true', 'false']).default('auto'),
  // Khoá mã hoá secret TOTP (AES-256-GCM, dẫn xuất sha256); trống → dẫn xuất từ AUTH_SECRET. Đổi khoá = mọi admin đăng ký lại
  MFA_ENCRYPTION_KEY: z.string().optional(),
  MFA_ISSUER: z.string().default('Allingo'),
  // Step-up MFA còn hiệu lực bao lâu trên một phiên (refresh giữ claim mfa trong khoảng này)
  MFA_SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  // Sprint 12 – chính sách mật khẩu: độ dài tối thiểu + danh sách mật khẩu lộ offline (top-N trong repo); HIBP k-anonymity tuỳ chọn
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(64).default(12),
  PASSWORD_BREACH_CHECK: bool(true),
  PASSWORD_HIBP_ENABLED: bool(false),
  PASSWORD_HIBP_URL: z.string().default('https://api.pwnedpasswords.com/range'),
  PASSWORD_HIBP_TIMEOUT_MS: z.coerce.number().int().min(200).max(10_000).default(1500),
  // Sprint 12 – phiên bản văn bản pháp lý (placeholder chờ luật sư) – POLICY_VERSION dùng cho terms/privacy
  REFUND_POLICY_VERSION: z.string().default('2026-11'),
  VOICE_CONSENT_VERSION: z.string().default('2026-11'),
  // Sprint 12 – beta kín: lịch gửi mời theo đợt (giờ VN, mỗi ngày) – hạn mức/ngày nằm ở rules.config của ff.growth.beta_gate
  BETA_INVITE_SEND_HOUR_VN: z.coerce.number().int().min(0).max(23).default(9),
  // Sprint 12 – job vận hành: content.stats_nightly (giờ VN), cửa sổ dữ liệu (ngày), n tối thiểu để kết luận
  CONTENT_STATS_HOUR_VN: z.coerce.number().int().min(0).max(23).default(2),
  CONTENT_STATS_WINDOW_DAYS: z.coerce.number().int().min(7).max(3650).default(365),
  CONTENT_STATS_MIN_N: z.coerce.number().int().min(1).max(10_000).default(30),
  // Sprint 12 – ops.retention_cleanup (giờ VN) + chính sách lưu giữ (ngày); ghi âm theo expires_at (90/365 – CLAUDE.md §9)
  RETENTION_HOUR_VN: z.coerce.number().int().min(0).max(23).default(3),
  RETENTION_AI_TASKS_DAYS: z.coerce.number().int().min(30).max(3650).default(180),
  RETENTION_OUTBOX_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_NOTIFICATIONS_DAYS: z.coerce.number().int().min(30).max(3650).default(180),
  RETENTION_AUDIT_DAYS: z.coerce.number().int().min(365).max(3650).default(730),
  RETENTION_DEADLETTER_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  RETENTION_BATCH: z.coerce.number().int().min(10).max(100_000).default(1000),
  // Sprint 12 – email báo cáo đối soát hằng ngày + báo cáo beta tuần (dấu phẩy; trống → OPS_ALERT_EMAIL)
  BILLING_REPORT_EMAILS: z.string().optional(),
  BETA_REPORT_EMAILS: z.string().optional(),
  // Sprint 12 – PostHog API (đọc số liệu cho pnpm report:beta): personal API key + project id; trống → "chưa có"
  POSTHOG_API_HOST: z.string().default('https://us.posthog.com'),
  POSTHOG_PROJECT_ID: z.string().optional(),
  POSTHOG_PERSONAL_API_KEY: z.string().optional(),
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
