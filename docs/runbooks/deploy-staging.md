# Runbook: deploy staging (Azure Container Apps – ADR-0023)

Pipeline: `.github/workflows/deploy-staging.yml` · tiện ích: `infra/scripts/aca.sh` · IaC: `infra/terraform/envs/staging` ·
secret: [secrets.md](./secrets.md).

```
build (api, web, cms → GHCR, tag sha-<commit>) ─┐
terraform-plan (environment staging-plan) ──────┴─► terraform-apply* ─► migrate ─► deploy ─► smoke
                                                     * chỉ khi chạy tay với apply_infra = true
Phê duyệt (environment staging): terraform-apply*, migrate, deploy
```

Biến dùng trong runbook:

```bash
RG=allingo-staging-rg
P=allingo-staging            # tiền tố app: $P-api, $P-worker, $P-web, $P-cms, $P-meili, $P-otel, job $P-migrate, $P-dbtools
API=https://api-staging.allingo.vn; APP=https://app-staging.allingo.vn; CMS=https://cms-staging.allingo.vn
az extension add --name containerapp --upgrade --yes
```

## 1. Bootstrap lần đầu

1. Làm phần *Bootstrap* trong `infra/terraform/README.md` (resource provider, state, OIDC + role, token Cloudflare, Origin CA, PAT GHCR).
2. GitHub → Environments: tạo `staging-plan` (không reviewer) và `staging` (Required reviewers; *Deployment branches and tags*: `main`, `v*`).
   Đặt secrets/variables theo comment đầu `deploy-staging.yml`. `STAGING_*_ORIGIN` biết trước khi bật Cloudflare
   (`https://{app,api,cms}-staging.<zone>`), cần có **trước** lần build đầu vì image web nhúng URL API.
3. `TFVARS_STAGING`: nội dung `terraform.tfvars` (mẫu `terraform.tfvars.example`). Lần đầu đặt `cloudflare_proxied = false`
   nếu muốn chắc Azure xác minh được custom domain (xem bước 6).
4. Actions → *Deploy staging* → *Run workflow* trên `main` với `apply_infra = true`, `bootstrap_db_roles = true`.
   - `build` đẩy image `sha-<commit>`; `terraform-apply` (duyệt) tạo hạ tầng, app chạy image đó.
     Lần đầu mất ~25–40 phút (Postgres, Redis, environment). Postgres tự restart sau khi đặt `shared_preload_libraries`.
   - App khởi động trước khi có vai trò `allingo_app` → `/v1/health/ready` trả `degraded` (db = false) tới hết bước sau; bình thường.
   - `migrate` (duyệt): job `$P-migrate` chạy `node migrate.mjs` bằng vai trò admin; sau đó job `$P-dbtools` tạo vai trò `allingo_app`. CMS (schema `cms`) KHÔNG dùng push ở production: chạy `pnpm --filter @allingo/cms payload migrate` (thư mục `apps/cms/migrations`, bắt đầu từ `20261102_024739_initial`) trước khi deploy revision CMS mới; mỗi lần đổi collection/field phải `payload migrate:create <tên>` và commit migration
     (NOBYPASSRLS) + schema `cms` + quyền.
   - `deploy` (duyệt): tạo revision mới cho 4 app (lúc này DB đã có vai trò app) → `smoke`.
5. Seed dữ liệu lõi (`pnpm db:seed --set core`) chưa có job riêng: chạy từ máy có kết nối VNet hoặc bổ sung job seed (việc tiếp theo).
   **Không** chạy `--set demo` với dữ liệu người học thật.
6. Nếu `terraform-apply` lỗi ở `azurerm_container_app_custom_domain` (không xác minh được CNAME do proxied): đặt
   `cloudflare_proxied = false` trong `TFVARS_STAGING`, chạy lại `apply_infra`, rồi đổi về `true` và chạy lại lần nữa.
   Kiểm tra: `dig +short TXT asuid.api-staging.allingo.vn` trả đúng `custom_domain_verification_id`.
7. Payload CMS ở production mode (`push: false`) cần migration Payload để tạo bảng trong schema `cms` – chưa có trong pipeline
   (việc của nhóm CMS); tới khi có, CMS staging chưa dùng được.

## 2. Deploy thường lệ

1. Merge vào `main`, CI xanh.
2. Tạo tag: `git tag -a v0.2.0 -m "..." && git push origin v0.2.0` (chỉ maintainer; bật tag protection cho `v*`).
3. Theo dõi run: `build` + `terraform-plan` chạy song song. Đọc *Summary* của plan: tag push **không** apply hạ tầng – nếu plan có
   thay đổi cần áp dụng, chạy tay *Run workflow* với `apply_infra = true` (cùng commit/tag).
4. Duyệt `migrate` (kiểm tra migration mới trong PR: tương thích ngược – expand trước, contract ở release sau).
5. Duyệt `deploy`. Job tạo revision `<app>--r<run>-<attempt>-<sha7>` theo thứ tự api → worker → web → cms, chờ revision
   *Healthy*, chuyển 100% traffic, tắt revision cũ. Bảng revision mới/cũ nằm trong *Summary* (dùng để rollback).
6. `smoke` gọi `$API/v1/health/ready` (cần `status = ok`, db và redis = true), `$APP/vi`, `$CMS/admin/login`.

Deploy tay không qua pipeline (khẩn cấp, cần quyền Contributor trên RG):

```bash
img=ghcr.io/<owner>/allingo-api:sha-<commit>
infra/scripts/aca.sh job-run    $RG $P-migrate "$img"
infra/scripts/aca.sh app-deploy $RG $P-api "$img" hotfix-$(date +%m%d%H%M)
```

## 3. Kiểm tra sau deploy

```bash
infra/scripts/aca.sh status $RG $P-api            # revision, traffic, health, image
curl -s $API/v1/health/ready | jq                  # {"status":"ok","checks":{"db":true,"redis":true}}
az containerapp logs show -g $RG -n $P-api --tail 100            # log console (pino JSON)
az containerapp logs show -g $RG -n $P-worker --tail 100
```

Checklist tay (5 phút): đăng nhập email/OTP · làm 1 đề Practice + xem giải thích · ghi âm/upload (presigned R2, kiểm tra CORS) ·
CMS: đăng nhập, *Publish* 1 câu hỏi (CMS → API nội bộ) · worker xử lý job (log `submission.graded`/`grade.*`) ·
Socket.IO kết nối `/ws` qua Cloudflare · App Insights → *Transaction search* có trace mới.

KQL (Log Analytics `allingo-staging-law`):

```kusto
ContainerAppConsoleLogs_CL
| where ContainerAppName_s in ("allingo-staging-api", "allingo-staging-worker") and TimeGenerated > ago(30m)
| where Log_s has "\"level\":50" or Log_s has "\"level\":60"      // pino error/fatal
| project TimeGenerated, ContainerAppName_s, RevisionName_s, Log_s
| order by TimeGenerated desc

ContainerAppSystemLogs_CL                                          // pull image, probe, restart
| where ContainerAppName_s startswith "allingo-staging" and TimeGenerated > ago(30m)
| project TimeGenerated, ContainerAppName_s, RevisionName_s, Reason_s, Log_s
```

Cảnh báo cần theo dõi 30 phút đầu: tỉ lệ 5xx (Cloudflare Analytics + App Insights *Failures*), restart revision, kết nối DB
(`max_connections` B1ms = 50), độ dài hàng đợi BullMQ.

## 4. Rollback

Rollback ứng dụng **không** hoàn tác migration – vì vậy migration phải tương thích ngược với bản đang chạy trước đó.

**api / web / cms** (revision mode Multiple): revision cũ đã bị tắt nhưng còn giữ, bật lại trong ~1 phút.

```bash
infra/scripts/aca.sh status   $RG $P-api                                   # tìm revision trước (hoặc Summary của run)
infra/scripts/aca.sh rollback $RG $P-api $P-api--r41-1-1a2b3c4             # bật lại → chờ healthy → 100% → tắt revision lỗi
```

Tương đương lệnh tay:

```bash
az containerapp revision activate   -g $RG -n $P-api --revision $P-api--r41-1-1a2b3c4
az containerapp ingress traffic set -g $RG -n $P-api --revision-weight $P-api--r41-1-1a2b3c4=100
az containerapp revision deactivate -g $RG -n $P-api --revision $P-api--r42-1-9f8e7d6
```

Canary/chia traffic (ví dụ thử bản mới với 10%):

```bash
az containerapp ingress traffic set -g $RG -n $P-api --revision-weight $P-api--r41-1-1a2b3c4=90 $P-api--r42-1-9f8e7d6=10
az containerapp ingress traffic show -g $RG -n $P-api -o table
```

Sau rollback, traffic đang **ghim** vào revision cụ thể; lần deploy kế tiếp tự đặt lại `latest=100`.

**worker** (revision mode Single): tạo revision mới với image cũ:

```bash
az containerapp update -g $RG -n $P-worker --image ghcr.io/<owner>/allingo-api:sha-<commit-cũ> --revision-suffix rb-$(date +%m%d%H%M)
```

**Hạ tầng:** revert commit Terraform trên `main` → *Run workflow* `apply_infra = true`. Không có rollback tự động cho thay đổi
phá huỷ (đọc kỹ plan: `-/+ destroy and then create replacement` trên Postgres/Key Vault/storage là dấu hiệu dừng lại).

## 5. Migration lỗi

Job `migrate` lỗi ⇒ `deploy` không chạy ⇒ bản cũ vẫn phục vụ.

1. Xem log:
   ```bash
   az containerapp job execution list -g $RG -n $P-migrate -o table
   az containerapp job logs show -g $RG -n $P-migrate --execution <execution> --container migrate   # (extension containerapp mới)
   ```
   hoặc KQL `ContainerAppConsoleLogs_CL | where ContainerJobName_s == "allingo-staging-migrate"`.
2. Drizzle migrator chạy các migration đang chờ trong một transaction: lỗi SQL thường đã được rollback, bảng
   `drizzle.__drizzle_migrations` không ghi nhận bản lỗi. Sửa migration bằng commit mới → tag mới.
3. Câu lệnh không chạy được trong transaction (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE … ADD VALUE` trên PG cũ) hoặc migration chạy
   một phần: kiểm tra trạng thái bằng psql trong VNet qua một lần chạy job `dbtools` với lệnh ghi đè, ví dụ:
   ```bash
   az containerapp job start -g $RG -n $P-dbtools --image postgres:16-alpine --container-name dbtools \
     --command "/bin/sh" --args "-c" "psql \"\$DATABASE_URL_MIGRATE\" -c 'select id, hash, created_at from drizzle.__drizzle_migrations order by id desc limit 5'"
   # (kiểm tra cú pháp tham số ghi đè bằng: az containerapp job start --help)
   ```
   Sửa tay có ghi lại câu lệnh trong PR/ticket; không sửa dữ liệu người học trên staging khi chưa có phê duyệt.
4. Hỏng dữ liệu: khôi phục point-in-time sang server mới (giữ server cũ để đối chiếu):
   ```bash
   az postgres flexible-server restore -g $RG --source-server $P-pg --name $P-pg-restore \
     --restore-time "2026-11-01T03:00:00Z"
   ```
   Chuyển ứng dụng sang server khôi phục = cập nhật `database-url`/`database-url-migrate` trong Key Vault + revision mới; sau đó
   đưa lại vào Terraform (`terraform import` hoặc đổi tên) – làm cùng DevOps, ghi postmortem.
5. Không chạy lại workflow khi chưa hiểu nguyên nhân (`replica_retry_limit = 0` có chủ ý).

## 6. Sự cố thường gặp

| Triệu chứng | Nguyên nhân hay gặp | Xử lý |
| --- | --- | --- |
| Revision `Provisioning` → `Failed`, log hệ thống `ImagePullBackOff`/unauthorized | PAT GHCR hết hạn/thiếu quyền, sai tag | Xoay `GHCR_PULL_TOKEN`; kiểm tra tag `sha-<commit>` (web: `-staging`) trên GHCR |
| `Failed to provision revision… secret … keyvault` | Secret chưa có trong Key Vault (`external_secret_env`), RBAC chưa lan truyền | `az keyvault secret show --vault-name $KV -n <tên>`; thêm secret; chạy lại |
| Revision `Unhealthy` | Probe lỗi (Nest không lên: env sai – xem log Zod "Cấu hình môi trường không hợp lệ") | `az containerapp logs show`; sửa env/secret; rollback nếu đang có sự cố |
| Cloudflare 526 | Origin cert không hợp lệ/chưa bind custom domain | Kiểm tra `az containerapp hostname list -g $RG -n $P-api`; chứng chỉ Origin CA |
| 404 từ Azure (trang "Container App unavailable"/không tìm thấy host) | Custom domain chưa bind | Xem bước 6 Bootstrap |
| 403 trên `/admin` hoặc `/docs` | WAF chặn ngoài VN | Thêm IP vào `admin_allowed_ips` hoặc dùng VPN VN |
| 429 trên `/v1/auth/*` | Rate limit Cloudflare (20 yêu cầu/10 giây/IP) hoặc API | Kiểm tra Security → Events; điều chỉnh `auth_rate_limit` |
| CORS lỗi khi upload ghi âm | Origin web khác `cors_origins` của bucket R2 | Kiểm tra `STAGING_APP_ORIGIN` khớp hostname; `terraform apply` |
| `too many connections` | Tổng pool vượt 50 (B1ms) | Giảm `db_pool_max` hoặc `max_replicas`, hoặc tăng SKU |
| CMS publish lỗi 301/401 | Gọi nội bộ bị chuyển hướng HTTPS / token lệch | Xem `api_allow_insecure_connections` (module compute); revision mới cho api + cms sau khi xoay `internal-api-token` |
