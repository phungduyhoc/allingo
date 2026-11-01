# ADR-0023: Hạ tầng phương án B – Azure Container Apps (Southeast Asia) + Cloudflare (R2, DNS, WAF)

- **Trạng thái:** Proposed — chốt tại GATE-1 sau kết luận pháp chế về lưu trữ dữ liệu trong nước (NĐ 53/2022)
- **Ngày:** 2026-11-01
- **Nguồn:** ADR-0014 (Container + Terraform, phương án A/B chọn tại GATE-1); Sprint 1 – T4 (`docs/HANDOFF.md`)
- **Liên quan:** ADR-0006 (BullMQ), ADR-0008 (Azure Speech), ADR-0013 (RLS), ADR-0015 (OpenTelemetry), ADR-0019 (Payload CMS)

## Context
- ADR-0014 chốt "container + Terraform", để ngỏ A (Kubernetes managed trên cloud trong nước) hoặc B (Azure Container Apps, Southeast Asia).
- Khối lượng cần chạy: `api` (NestJS/Fastify, Socket.IO), `worker` (BullMQ, cùng image), `web` (Next.js standalone), `cms` (Payload 3),
  PostgreSQL 16 + pgvector/citext/pg_trgm, Redis (BullMQ cần `noeviction`), Meilisearch, object storage S3-compatible
  (code dùng `@aws-sdk/client-s3` + presigned URL), OpenTelemetry.
- Đội nhỏ, cần staging ngay Sprint 1, ưu tiên ít công vận hành và chi phí thấp ở dev/staging (scale-to-zero).
- Speech đã chọn Azure AI Speech region `southeastasia` (ADR-0008) → cùng region giảm độ trễ.
- Pháp lý: Luật An ninh mạng 2018 và NĐ 53/2022/NĐ-CP có yêu cầu lưu trữ một số loại dữ liệu người dùng tại Việt Nam;
  dữ liệu cá nhân chuyển ra nước ngoài cần hồ sơ đánh giá tác động theo quy định bảo vệ dữ liệu cá nhân hiện hành.
  Azure Southeast Asia đặt tại Singapore. Pháp chế chưa kết luận → ADR ở trạng thái **Proposed**.

## Decision (đề xuất)
1. **Compute:** Azure Container Apps, environment kiểu *workload profiles* (profile Consumption) gắn VNet, region `southeastasia`.
   App: `api` (ingress external :4000, probe `/v1/health/live|ready`), `worker` (`node dist/worker.js`, không ingress, min 1),
   `web` (:3000), `cms` (:3001, media trên Azure Files), `meili` và `otel` (ingress internal).
   Container Apps Jobs: `migrate` (image api, `node migrate.mjs`) và `dbtools` (psql tạo vai trò `allingo_app` không BYPASSRLS).
   Dev: api/web/cms scale-to-zero; staging: min 1 replica; HA/zone redundancy tắt ở cả hai.
2. **Dữ liệu:** PostgreSQL Flexible Server 16 (VNet-integrated, B1ms, HA tắt, backup 7 ngày), Azure Cache for Redis Basic C0
   qua private endpoint (TLS 6380), Meilisearch chạy trên Container Apps + Azure Files.
3. **Object storage:** Cloudflare R2 (API S3, không phí egress, lifecycle): `recordings` (xoá sau 90 ngày), `media`, `exports` (365 ngày)
   – khớp CLAUDE.md §9. Không cần adapter mới trong `storage.module.ts`.
4. **Edge:** Cloudflare DNS + proxy + WAF (custom rules: chặn `/v1/internal/*`, đường dẫn quản trị chỉ từ VN/IP cho phép;
   rate limit `/v1/auth/*`), SSL **Full (strict)** với chứng chỉ Cloudflare Origin CA gắn làm custom domain trên Container Apps;
   ingress Container Apps chỉ nhận dải IP Cloudflare (+ subnet ACA). Hostname một cấp (`api-staging.allingo.vn`) để Universal SSL phủ được.
5. **Secret:** Key Vault (RBAC) + user-assigned identity (`Key Vault Secrets User`); Container Apps dùng tham chiếu Key Vault
   versionless. Secret do Terraform sinh (chuỗi kết nối, khoá random) ghi vào Key Vault; secret bên thứ ba đặt tay
   (không đi qua Terraform state).
6. **CI/CD:** image trên GHCR; GitHub Actions xác thực Azure bằng OIDC (không có secret Azure dài hạn); state Terraform trên
   Azure Storage xác thực Entra ID. Terraform sở hữu hạ tầng/cấu hình; pipeline sở hữu image và traffic revision
   (`ignore_changes`), revision mode Multiple cho api/web/cms để rollback bằng `revision activate` + traffic split.
7. **Quan sát:** Log Analytics + Application Insights qua OTel Collector nội bộ; Grafana stack (ADR-0015) vẫn là đích dài hạn –
   collector có thể fan-out OTLP sang Grafana Cloud/Tempo mà không đổi code.

Hiện thực: `infra/terraform` (module `network`, `observability`, `postgres`, `redis`, `storage`, `secrets`, `compute`, `search`,
`cdn-waf`, `dns`; env `dev`, `staging`), `.github/workflows/deploy-staging.yml`, `docs/runbooks/{deploy-staging,secrets}.md`.

## Alternatives considered
- **A – Kubernetes managed trong nước** (VNG Cloud, Viettel IDC, FPT Smart Cloud…): đáp ứng lưu trữ trong nước; đổi lại phải tự
  vận hành ingress/cert-manager/autoscaler/observability, dịch vụ managed (Postgres có pgvector, Redis) và Terraform provider
  không đồng đều, chi phí node chạy thường trực. Vẫn là phương án dự phòng nếu pháp chế yêu cầu.
- **AKS:** kiểm soát cao hơn nhưng công vận hành và chi phí cố định (node pool) lớn so với quy mô hiện tại.
- **App Service for Containers:** không scale-to-zero, không có mô hình job, worker kém tự nhiên.
- **Azure Blob thay R2:** không có API S3 (phải viết adapter hoặc chạy gateway), tính phí egress.
- **Azure Front Door + WAF thay Cloudflare:** phí nền và phí rule cao hơn; Cloudflare đã dùng cho DNS.
- **Azure Container Registry thay GHCR:** kéo image trong Azure không tốn băng thông ngoài, ~5 USD/tháng (Basic); giữ GHCR để
  gắn với GitHub Actions, đánh giá lại nếu chính sách tính phí GHCR thay đổi.
- **Meilisearch Cloud:** bớt vận hành, thêm nhà cung cấp; cân nhắc cho production.
- **Vercel + Supabase:** đã loại ở ADR-0014.

## Consequences
**Tích cực**
- Không quản lý cluster; deploy = tạo revision; rollback/canary bằng traffic split; job migration chạy trong VNet.
- Dev rẻ (scale-to-zero), staging ước tính 115–200 USD/tháng (bảng chi phí: `infra/terraform/README.md`).
- Không có secret Azure dài hạn trong GitHub; secret runtime tập trung ở Key Vault, ứng dụng không đổi code (chỉ env).

**Rủi ro / việc phải theo dõi**
1. **Lưu trữ dữ liệu (NĐ 53):** nếu pháp chế yêu cầu lưu trong nước, B không dùng được cho production; dev/staging chỉ dùng dữ liệu
   mẫu/tổng hợp (không dữ liệu người học thật) cho tới GATE-1. Module R2/Cloudflare dùng lại được với phương án A.
2. **Azure Cache for Redis** (Basic/Standard/Premium) ngừng hoạt động ngày 30/09/2028 (Microsoft Learn – retirement FAQ); có thể bị
   hạn chế tạo mới sớm hơn → kiểm tra trên subscription trước khi apply. Đường thoát: Azure Managed Redis (chỉ đổi module
   `redis` và `REDIS_URL`) hoặc Valkey container cho dev.
3. **Meilisearch trên SMB (LMDB):** chấp nhận cho dev/staging (index dựng lại được từ Postgres); production cân nhắc lại.
4. **Socket.IO nhiều replica:** sticky session của Container Apps chỉ có ở revision mode Single, trong khi api dùng Multiple để rollback
   → client cần transport WebSocket-only (+ Redis adapter khi > 1 replica). Việc của nhóm app.
5. **CMS gọi API nội bộ qua `http://<prefix>-api`:** ingress api bật `allow_insecure_connections` để tránh chuyển hướng 301 sang HTTPS;
   đã giới hạn ingress chỉ Cloudflare + subnet ACA. Cần xác minh hành vi trên môi trường thật; nếu không cần thì tắt.
6. **Zone Cloudflare dùng chung:** zone settings và entrypoint ruleset mỗi phase là duy nhất trên một zone → chỉ một state quản lý
   (biến `cloudflare_manage_zone_settings` / `cloudflare_manage_waf`). Gói Free: rate limit chỉ theo path + IP, chu kỳ 10s, 1 rule.
7. **Custom domain với CNAME proxied:** Azure có thể không xác minh được CNAME khi đã bật proxy → lần đầu apply với `cloudflare_proxied = false`.
8. **Image web theo môi trường:** `NEXT_PUBLIC_*` nhúng lúc build → mỗi môi trường một image (`-staging`, `-dev`).
9. **Payload:** media đang ở Azure Files (chưa dùng `@payloadcms/storage-s3` sang R2); migration Payload cho production (`push: false`)
   chưa có trong pipeline. Việc của nhóm CMS.
10. Chưa chạy `terraform validate`/`plan` trên tài khoản thật lúc viết ADR – job `terraform-validate` (preview.yml) và `terraform-plan`
    (deploy-staging.yml) là cửa kiểm tra đầu tiên.

**Checklist GATE-1:** kết luận pháp chế; xác nhận ngân sách; quota Container Apps/Postgres B-series ở Southeast Asia; khả năng tạo
Azure Cache for Redis; gói Cloudflare (Free/Pro); chủ sở hữu zone `allingo.vn`; người duyệt environment `staging`.
