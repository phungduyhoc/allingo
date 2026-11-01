# ADR

Mẫu Context – Decision – Consequences; thay đổi ADR cần Tech Lead duyệt.

- [ADR-0001](./0001-typescript-monorepo.md) — TypeScript end-to-end trong monorepo Turborepo + pnpm
- [ADR-0002](./0002-modular-monolith-nestjs.md) — Modular monolith NestJS (Fastify adapter)
- [ADR-0003](./0003-postgres-6-schema.md) — Một cụm PostgreSQL, chia 6 schema (`iam`, `catalog`, `learn`, `ai`, `billing`, `ops`)
- [ADR-0004](./0004-drizzle-orm.md) — Drizzle ORM + migration SQL (0001 = DDL gốc, các migration sau do drizzle-kit sinh và rà soát tay)
- [ADR-0005](./0005-question-content-jsonb.md) — Nội dung câu hỏi là JSONB có phiên bản (`question_versions.content`) kiểm tra bằng Zod theo `question_type.code`
- [ADR-0006](./0006-bullmq-outbox.md) — BullMQ trên Redis cho job
- [ADR-0007](./0007-ai-gateway.md) — AI Gateway là module trong `api`/`worker` với adapter theo nhà cung cấp
- [ADR-0008](./0008-azure-speech.md) — Azure AI Speech cho STT, Pronunciation Assessment, TTS qua interface `SpeechProvider`
- [ADR-0009](./0009-auth-better-auth.md) — Better Auth (self-host): JWT access 15 phút + refresh xoay vòng — *thay thế một phần bởi ADR-0022*
- [ADR-0010](./0010-entitlements-quota.md) — Entitlement vật chất hoá trong `billing.entitlements`
- [ADR-0011](./0011-credit-ledger.md) — Credit ledger append-only (`billing.credit_ledger`) + bảng số dư
- [ADR-0012](./0012-payments-webhook-first.md) — Thanh toán webhook-first qua `PaymentProvider` adapter (VNPay, MoMo, ZaloPay, PayOS, Stripe)
- [ADR-0013](./0013-b2b-rls.md) — B2B đa tenant: shared schema + cột `org_id` + Row Level Security cho vai trò tổ chức
- [ADR-0014](./0014-infra-container-terraform.md) — Container + Terraform
- [ADR-0015](./0015-observability.md) — OpenTelemetry → Grafana stack
- [ADR-0016](./0016-media-youtube-s3.md) — Video shadowing chỉ nhúng YouTube
- [ADR-0017](./0017-i18n.md) — i18n: next-intl (ICU) cho UI
- [ADR-0018](./0018-mobile-expo.md) — Mobile bằng Expo dùng chung `packages/*`
- [ADR-0019](./0019-payload-cms-sync.md) — Payload CMS giữ dữ liệu soạn thảo trong schema `cms` (bảng do Payload quản lý) và đồng bộ sang `catalog`/`ai` qua hook + job `content.sync` khi phát hành
- [ADR-0020](./0020-auth-core-sprint0.md) — Sprint 0 triển khai lõi xác thực trong module `iam` (Argon2id, JWT HS256 access 15 phút, refresh xoay vòng băm trong `iam.sessions`, phiên khách) khớp DDL
- [ADR-0021](./0021-versions-pinning.md) — Ghim TypeScript 5.9.x, ESLint 9.x, Vitest 4.x (không lấy TypeScript 7 / ESLint 10 / Vitest 5 dù đã phát hành) cho tới khi NestJS CLI, drizzle-kit, Payload và typescript-eslint công bố hỗ trợ đầy đủ
- [ADR-0022](./0022-auth-oauth-otp-native.md) — OAuth (Google/Apple/Facebook) + OTP tự triển khai trong `iam` bằng `jose`, không dùng Better Auth; liên kết tài khoản cần xác nhận; thu hồi phiên tức thời
- [ADR-0023](./0023-infra-azure-container-apps.md) — (Proposed, chốt tại GATE-1) Phương án B: Azure Container Apps Southeast Asia + PostgreSQL Flexible/Redis/Key Vault, Cloudflare R2 + DNS/WAF, GitHub Actions OIDC
- [ADR-0024](./0024-catalog-content-lifecycle.md) — Catalog là nguồn sự thật vòng đời nội dung + lịch sử duyệt; CMS đồng bộ mọi lần lưu; máy trạng thái dùng chung; tìm kiếm Meilisearch/PG; trùng lặp pg_trgm
- [ADR-0025](./0025-media-pipeline-tts.md) — Pipeline media (presign → PUT trực tiếp → job `media.process` ffmpeg: mp3/webp, waveform, thumbnail), driver lưu trữ `fs` cho dev/test, TTS qua `SpeechProvider` có cache theo script
