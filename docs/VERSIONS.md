# Phiên bản toolchain & framework (Sprint 0, 01/11/2026)

| Thành phần | Phiên bản | Ghi chú |
| --- | --- | --- |
| Node.js | 22.x LTS (>= 22.12; image Docker ghim `22.23.4-alpine`, 08/11/2026) | `require(esm)` dùng cho gói ESM trong NestJS; image cũ 22.12 mang CVE openssl/musl/zlib (Trivy) |
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
| fast-check | 4.10.x | Sprint 9 – devDependency `packages/planner` (property-based test PlanGenerator, 500 ca/thuộc tính) |
| @axe-core/playwright (axe-core) | 4.14.0 (4.14.0) | Sprint 11 web – devDependency `apps/web`: `e2e/a11y.spec.ts` (WCAG 2.0/2.1 A+AA, 0 serious/critical) |
| esbuild | 0.28.2 | devDependency trực tiếp của `apps/web` (09/11/2026) cho `scripts/build-sw.mjs` (đóng gói `public/sw.js` ở `prebuild`/`predev`); trước đó chỉ là phụ thuộc bắc cầu của vite nên cài sạch (CI, Docker) không có `node_modules/.bin/esbuild` → SW bị bỏ qua. MIT, cùng phiên bản vite đang dùng |
| happy-dom | 21.0.4 | Sprint 11 web – devDependency `apps/web` (môi trường DOM cho test FlagsProvider – `// @vitest-environment happy-dom`); cùng phiên bản override S12 |

Sprint 11 web không thêm SDK Sentry: báo lỗi + phiên (crash-free) + Web Vitals gửi Envelope HTTP tự viết (`apps/web/src/lib/telemetry/sentry.ts`, như `SentryReporter` của API); Web Vitals qua `next/web-vitals` có sẵn trong Next.

## Sprint 12 – không thêm thư viện; overrides bảo mật (`package.json` gốc `pnpm.overrides`)

| Gói (bắc cầu) | Ép lên | Lý do |
| --- | --- | --- |
| dompurify (monaco của Payload admin) | 3.4.17 | GHSA high – pentest-1 F11 |
| zod (`@serwist/next` build) | 4.6.7 | GHSA – cùng dòng 4.6.x của repo |
| happy-dom (peer vitest) | 21.0.4 | GHSA critical (chỉ dev/test) |

TOTP (RFC 6238/4226), base32, AES-256-GCM tự viết bằng `node:crypto` (không thêm `otplib`/`speakeasy`); danh sách mật khẩu lộ offline
trong mã nguồn (`apps/api/src/modules/iam/password/common-passwords.ts`); HIBP qua `fetch`.

## Công cụ vận hành/bảo mật (Sprint 11 – không phải phụ thuộc npm runtime)

| Công cụ | Phiên bản | Dùng ở |
| --- | --- | --- |
| k6 | 1.3.0 | `tests/load/exam-day.js` (máy dev/staging) |
| Prometheus / promtool | 3.5.0 | `infra/observability/compose.yml`, CI `observability` (check/test rules) |
| Alertmanager / amtool | 0.28.1 | compose, CI `amtool check-config` |
| Grafana | 12.1.1 | compose, 6 dashboard JSON (`grafana/dashboards.py --check`) |
| Loki / Promtail | 3.5.3 | compose |
| Tempo | 2.8.2 | compose |
| OpenTelemetry Collector contrib | 0.132.0 | compose (xoá `db.statement`, `drizzle.query.params`) |
| node-exporter / postgres-exporter / redis_exporter / blackbox-exporter | 1.9.1 / 0.17.1 / 1.75.0 / 0.27.0 | compose |
| Semgrep | 1.183.0 | CI `security` (`pipx install semgrep==1.183.0`) + `.semgrep/allingo.yml` |
| gitleaks | 8.28.0 (action v2) | CI `security`, `.gitleaks.toml` |
| Trivy action | 0.28.0 | CI `security` (fs báo cáo, image chặn HIGH/CRITICAL) |
| OWASP ZAP | 2.16.1 (action-baseline 0.14.0, action-api-scan 0.9.0) | `.github/workflows/zap-nightly.yml`, `.zap/rules.tsv` |
| Renovate | config `renovate.json` (app GitHub) | gom nhóm minor/patch, major cần ADR |
| OpenTofu | 1.10.6 | `tofu fmt -check` cho `infra/terraform` (provider azurerm/cloudflare như S0) |

Cập nhật khi nâng cấp; thay đổi major cần ADR.
