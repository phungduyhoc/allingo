# Phiên bản toolchain & framework (Sprint 0, 01/11/2026)

| Thành phần | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | 22.x LTS (>= 22.12) | `require(esm)` dùng cho gói ESM trong NestJS |
| pnpm | 10.28.0 | `packageManager` trong package.json |
| Turborepo | 2.11.x | |
| TypeScript | 5.9.3 | Ghim theo ADR-0021 (TS 7 chưa dùng) |
| ESLint | 9.39.x + typescript-eslint 8.72 | ESLint 10 chưa dùng (ADR-0021) |
| Prettier | 3.9.x | |
| Vitest | 4.1.x | |
| Zod | 4.6.x | |
| Drizzle ORM / Kit | 0.45.x / 0.31.x | |
| postgres (postgres-js) | 3.4.x | |
| PostgreSQL | 16.x + pgvector 0.6 | compose: `pgvector/pgvector:pg16` |
| Redis/Valkey | 7.x / 8.x | |
| ts-fsrs | 6.0.x | |
| NestJS | 12.3.x | Fastify adapter (xem apps/api/package.json) |
| Next.js / React | 16.4.x / 19.3.x | |
| Payload CMS | 3.92.x | |
| Vercel AI SDK | 7.0.x | |
| Playwright | 1.64.x | |
| web-push | 3.6.x | Sprint 6 – Web Push VAPID (aes128gcm) trong `apps/api` (growth); khoá qua env `VAPID_*` |
| handlebars / nodemailer | 4.7.x / 10.3.x | Sprint 8 dùng lại (đã có từ S0/S1): mẫu thông báo vi/en, email SMTP/SES; Resend gọi HTTP bằng fetch; PDF hoá đơn mock tự dựng – không thêm thư viện |

Cập nhật khi nâng cấp; thay đổi major cần ADR.
