# Runbook: biến môi trường & secret (phương án B – ADR-0023)

Áp dụng cho `envs/dev` và `envs/staging` (`infra/terraform`). Nguyên tắc (CLAUDE.md §9):
- Không commit secret; `.env.example` chỉ có giá trị mẫu. `gitleaks` chạy trong CI.
- Secret runtime nằm trong **Azure Key Vault** (RBAC); Container Apps đọc bằng tham chiếu versionless qua user-assigned identity
  `allingo-<env>-apps-id` (vai trò *Key Vault Secrets User*). Container App chỉ khai báo những secret nó dùng.
- Secret **do Terraform sinh** (mật khẩu DB, khoá Redis, token R2, khoá random) được Terraform ghi vào Key Vault → cũng nằm trong
  Terraform state ⇒ state là dữ liệu bí mật (Azure Storage, Entra ID, chỉ CI + DevOps đọc được).
- Secret **bên thứ ba** (khoá AI, OAuth secret, SMTP, thanh toán…) **đặt tay** trong Key Vault, không đi qua Terraform/GitHub;
  Terraform chỉ tham chiếu tên qua `external_secret_env` (ENV → tên secret).
- Giá trị `NEXT_PUBLIC_*` là public và được nhúng vào image web lúc build (GitHub Variables).

Tên secret Key Vault = tên ENV viết thường, `_` → `-` (`DATABASE_URL` → `database-url`).

## 1. Bảng biến

Cột **Loại**: `config` (không bí mật) · `public` (định danh/khoá công khai) · `secret`.
Cột **Nơi lưu (staging)**: `TF` = Terraform đặt env thường (`envs/*/main.tf`, `terraform.tfvars`) · `KV:<tên>` = Key Vault, *(TF)* do
Terraform ghi, *(tay)* đặt tay + khai báo `external_secret_env` · `GH var` / `GH secret` = GitHub Actions · `mặc định` = không đặt,
dùng mặc định trong `apps/*/src/**/env.ts`. Cột **Dùng ở**: a = api, w = worker, c = cms, b = build web, j = job.

### Chung, dữ liệu, hạ tầng

| Biến | Loại | Nơi lưu (staging) | Dùng ở | Ghi chú |
| --- | --- | --- | --- | --- |
| `APP_ENV` | config | TF (`development` ở dev, `staging`) | a w | |
| `LOG_LEVEL` | config | TF `log_level` (debug dev / info staging) | a w | |
| `TZ` | config | TF `Asia/Ho_Chi_Minh` | a w c | Image cũng đặt sẵn |
| `DATABASE_URL` | secret | KV:`database-url` *(TF)* | a w c | Vai trò `allingo_app` (NOBYPASSRLS), `sslmode=require`; có hiệu lực sau job `dbtools` |
| `DATABASE_URL_MIGRATE` | secret | KV:`database-url-migrate` *(TF)* | j migrate, dbtools | Vai trò admin; **không** cấp cho app |
| `DATABASE_URL_REPLICA` | secret | chưa dùng (KV:`database-url-replica` *(tay)* khi có replica) | a | |
| `TEST_DATABASE_URL` | config | chỉ CI (`ci.yml`, Postgres service) | test | Không có trên cloud |
| `DB_POOL_MAX` | config | TF `db_pool_max` (5 dev / 6 staging) | a w | B1ms tối đa 50 kết nối |
| `REDIS_URL` | secret | KV:`redis-url` *(TF)* | a w | `rediss://:<key>@<host>:6380` |
| `QUEUE_PREFIX` | config | TF `allingo` | a w | |
| `S3_ENDPOINT` | config | TF (`https://<account>.r2.cloudflarestorage.com`) | a w | |
| `S3_REGION` | config | TF `auto` | a w | R2 |
| `S3_ACCESS_KEY_ID` | secret | KV:`s3-access-key-id` *(TF)* | a w | ID token R2 |
| `S3_SECRET_ACCESS_KEY` | secret | KV:`s3-secret-access-key` *(TF)* | a w | SHA-256 của giá trị token R2 |
| `S3_BUCKET_MEDIA`, `S3_BUCKET_RECORDINGS` | config | TF (`allingo-<env>-media/recordings`) | a w | Bucket `exports` đã tạo, chưa có biến |
| `S3_FORCE_PATH_STYLE` | config | TF `true` | a w | |
| `S3_PRESIGN_TTL_SECONDS` | config | TF `600` | a w | URL ký 10 phút (§9) |
| `S3_PUBLIC_BASE_URL` ¹ | config | TF (`https://media<suffix>.<zone>` khi bật Cloudflare) | a w | |
| `MEILISEARCH_HOST` | config | TF `http://allingo-<env>-meili` | a w | Mạng nội bộ environment |
| `MEILISEARCH_API_KEY` | secret | KV:`meilisearch-api-key` *(TF)* | a w | Hiện = master key; production: tạo key giới hạn quyền |

### API, xác thực, email

| Biến | Loại | Nơi lưu (staging) | Dùng ở | Ghi chú |
| --- | --- | --- | --- | --- |
| `API_PORT`, `API_HOST` | config | TF `4000`, `0.0.0.0` | a | |
| `API_PUBLIC_URL`, `WEB_PUBLIC_URL`, `CMS_PUBLIC_URL` | config | TF (hostname Cloudflare hoặc FQDN ACA) | a w (c: `CMS_PUBLIC_URL`) | |
| `CORS_ORIGINS` | config | TF (web + cms) | a | |
| `TRUST_PROXY` | config | TF `true` | a | Sau Cloudflare + envoy |
| `RATE_LIMIT_MAX`, `BODY_LIMIT_BYTES` | config | TF `300` / mặc định | a | Edge còn rate limit `/v1/auth/*` |
| `INTERNAL_API_TOKEN` ¹ | secret | KV:`internal-api-token` *(TF)* | a w c | CMS → API nội bộ; WAF chặn `/v1/internal/*` từ Internet |
| `AUTH_SECRET` | secret | KV:`auth-secret` *(TF, 48 ký tự)* | a w | Ký JWT; xoay vòng = mọi phiên đăng nhập lại |
| `AUTH_BASE_URL` | config | TF `<API_PUBLIC_URL>/v1/auth` | a | |
| `JWT_ACCESS_TTL_SECONDS`, `JWT_REFRESH_TTL_SECONDS` | config | mặc định (900 / 2592000) | a | |
| `COOKIE_DOMAIN` | config | không đặt (cookie host-only trên host api) | a | Không đặt `allingo.vn` (lộ cookie sang môi trường khác) |
| `COOKIE_SECURE` | config | TF `true` | a | |
| `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID`, `FACEBOOK_CLIENT_ID` | public | TF `api_extra_env` | a | |
| `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_SECRET`, `FACEBOOK_CLIENT_SECRET` | secret | KV:`google-client-secret`… *(tay)* | a | |
| `APPLE_TEAM_ID`, `APPLE_KEY_ID` | public | TF `api_extra_env` | a | |
| `APPLE_PRIVATE_KEY` | secret | KV:`apple-private-key` *(tay)* | a | PEM `.p8`, xuống dòng `\n` |
| `OTP_DEV_FIXED_CODE` | config | **chỉ dev** (`api_extra_env`); rỗng ở staging/prod | a | |
| `OTP_SENDER` | config | TF `auto` | a | |
| `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, `OTP_LOCK_MINUTES`, `OTP_REQUEST_LIMIT`, `OTP_REQUEST_WINDOW_MINUTES` | config | mặc định (300 / 5 / 30 / 3 / 15) | a | §9 |
| `ESMS_API_KEY` | secret | KV:`esms-api-key` *(tay)* | a w | |
| `ZALO_ZNS_ACCESS_TOKEN` | secret | KV:`zalo-zns-access-token` *(tay)* | a w | Access token Zalo hết hạn ngắn → cần job làm mới (chưa có) |
| `OAUTH_MOCK` | config | TF `false` | a | |
| `POLICY_VERSION`, `PURGE_DELAY_MINUTES`, `PURGE_SCAN_INTERVAL_SECONDS` | config | mặc định | a w | Xoá tài khoản 72 giờ |
| `TURNSTILE_SECRET` | secret | KV:`turnstile-secret` *(tay)* | a | |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` | config | TF `smtp_*` | a w | |
| `SMTP_PASS` | secret | KV:`smtp-pass` *(tay)* | a w | |

### AI, speech, thanh toán, quan sát

| Biến | Loại | Nơi lưu (staging) | Dùng ở | Ghi chú |
| --- | --- | --- | --- | --- |
| `AI_PROVIDER` | config | TF `ai_provider` (`mock` tới khi có khoá) | a w | |
| `AI_TRACE_CONTENT` | config | TF `false` (cố định) | a w | Không ghi nội dung bài làm vào trace |
| `GOOGLE_GENERATIVE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | secret | KV:`google-generative-ai-api-key`, `anthropic-api-key`, `openai-api-key` *(tay)* | a w | Xoay 90 ngày |
| `GEMINI_FLASH_MODEL`, `GEMINI_PRO_MODEL`, `CLAUDE_SONNET_MODEL`, `OPENAI_GPT_MODEL` (+ `CLAUDE_HAIKU_MODEL`, `OPENAI_GPT_MINI_MODEL` ¹) | config | mặc định / `api_extra_env` | a w | |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL` | public | TF `api_extra_env` | a w | |
| `LANGFUSE_SECRET_KEY` | secret | KV:`langfuse-secret-key` *(tay)* | a w | |
| `ALLOW_UNEVALUATED_ACTIVATION` | config | TF (`true` dev / `false` staging) | a | |
| `SPEECH_PROVIDER` | config | TF `speech_provider` | a w | |
| `AZURE_SPEECH_KEY` | secret | KV:`azure-speech-key` *(tay)* | a w | |
| `AZURE_SPEECH_REGION` | config | TF (= `location`, `southeastasia`) | a w | |
| `PAYMENT_PROVIDERS` | config | TF `mock` (Sprint 7) | a | |
| `VNPAY_TMN_CODE`, `MOMO_PARTNER_CODE`, `ZALOPAY_APP_ID` | public | TF `api_extra_env` | a | Mã merchant |
| `VNPAY_HASH_SECRET`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY`, `ZALOPAY_KEY1`, `ZALOPAY_KEY2` | secret | KV *(tay)*: `vnpay-hash-secret`, `momo-access-key`, `momo-secret-key`, `zalopay-key1`, `zalopay-key2` | a | Sandbox ở staging |
| `OTEL_ENABLED` | config | TF (`false` dev / `true` staging) | a w | |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | config | TF `http://allingo-<env>-otel` | a w | Collector → App Insights |
| `OTEL_SERVICE_NAME` | config | TF `allingo-api` / `allingo-worker` | a w | |
| `SENTRY_DSN` | secret | KV:`sentry-dsn` *(tay)* | a w | DSN không hẳn bí mật nhưng tránh lạm dụng quota |
| `POSTHOG_KEY` | public | TF `api_extra_env` | a | |
| `POSTHOG_HOST` | config | mặc định/`api_extra_env` | a | |

### Web, CMS

| Biến | Loại | Nơi lưu (staging) | Dùng ở | Ghi chú |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | public | GH var `STAGING_API_ORIGIN` (+ `/v1`) → build-arg | b | Nhúng lúc build → image web theo môi trường (`-staging`) |
| `NEXT_PUBLIC_APP_URL` | public | GH var `STAGING_APP_ORIGIN` → build-arg | b | |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | public | cố định `vi` trong workflow | b | |
| `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | public | GH var cùng tên → build-arg | b | |
| `PAYLOAD_SECRET` | secret | KV:`payload-secret` *(TF, 48 ký tự)* | c | Lúc build dùng giá trị giả (Dockerfile) – không vào image |
| `CMS_PORT`, `CMS_DATABASE_SCHEMA` | config | TF `3001`, `cms` | c | |
| `INTERNAL_API_URL` ¹, `CMS_MEDIA_DIR` ¹ | config | TF `http://allingo-<env>-api/v1`, `/app/media` | c | Media trên Azure Files `cms-media` |

¹ Biến ứng dụng đọc nhưng chưa có trong `.env.example` (đề xuất bổ sung ở lần sửa `.env.example` kế tiếp).

### Secret phục vụ hạ tầng (không phải ENV của app)

| Tên | Nơi lưu | Dùng bởi | Ghi chú |
| --- | --- | --- | --- |
| `db-bootstrap-sql` | KV *(TF)* | job `dbtools` (`BOOTSTRAP_SQL`) | SQL tạo vai trò `allingo_app` – chứa mật khẩu |
| `applicationinsights-connection-string` | KV *(TF)* | app `otel` | |
| `ghcr-pull-token` | KV *(TF, từ GH secret `GHCR_PULL_TOKEN`)* | registry của mọi app/job | PAT classic `read:packages` |
| `CLOUDFLARE_API_TOKEN` | GH environment secret (`staging-plan`, `staging`) | Terraform | Quyền: `infra/terraform/README.md` |
| `GHCR_PULL_TOKEN` | GH environment secret | Terraform → KV | |
| `ORIGIN_CERT_PFX_BASE64`, `ORIGIN_CERT_PASSWORD` | GH environment secret | Terraform → Container Apps certificate | Cloudflare Origin CA |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | GH variable | OIDC `azure/login`, Terraform | Không phải secret; không có client secret |
| `TFSTATE_*`, `TFVARS_STAGING`, `STAGING_*` | GH variable | workflow | `TFVARS_STAGING` không được chứa secret |
| `GITHUB_TOKEN` | tự cấp | push GHCR | `packages: write` chỉ ở job build |

## 2. Thao tác thường gặp

```bash
KV=$(terraform -chdir=infra/terraform/envs/staging output -raw key_vault_name)
RG=allingo-staging-rg; P=allingo-staging

# Thêm secret bên thứ ba (read -s: không hiện, không vào shell history)
read -rs SECRET_VALUE
az keyvault secret set --vault-name "$KV" --name google-generative-ai-api-key --value "$SECRET_VALUE" -o none; unset SECRET_VALUE
# rồi khai báo trong TFVARS_STAGING: external_secret_env = { GOOGLE_GENERATIVE_AI_API_KEY = "google-generative-ai-api-key" }
# và chạy deploy-staging (apply_infra = true). Thiếu secret trong Key Vault → revision mới không khởi tạo được.

# Xem metadata (không in giá trị)
az keyvault secret list --vault-name "$KV" --query "[].{name:name, updated:attributes.updated}" -o table
```

**Origin CA → PFX:** Cloudflare → SSL/TLS → Origin Server → *Create Certificate* (`*.allingo.vn`, `allingo.vn`, RSA 2048, 15 năm),
lưu `origin.pem` (cert) và `origin.key` (khoá – chỉ hiện một lần), rồi:

```bash
openssl pkcs12 -export -inkey origin.key -in origin.pem -out origin.pfx -passout pass:"$PFX_PASSWORD"
base64 -w0 origin.pfx   # → GH secret ORIGIN_CERT_PFX_BASE64; $PFX_PASSWORD → ORIGIN_CERT_PASSWORD
shred -u origin.key origin.pfx   # không giữ bản sao trên máy
```

**Áp dụng giá trị secret mới:** Container Apps đồng bộ tham chiếu Key Vault versionless trong vòng ~30 phút, nhưng biến môi trường chỉ
đọc khi container khởi động → sau khi đổi giá trị: tạo revision mới (deploy lại, hoặc
`az containerapp update -g $RG -n $P-api --revision-suffix rot-$(date +%m%d%H%M)`) hoặc `az containerapp revision restart`
sau khi đồng bộ. Áp dụng cho api **và** worker (dùng chung secret), cms nếu liên quan.

## 3. Quy trình xoay vòng

| Secret | Chu kỳ | Cách xoay | Ảnh hưởng |
| --- | --- | --- | --- |
| Khoá AI, Speech, OAuth secret, SMTP, eSMS, Langfuse, Sentry | 90 ngày hoặc khi nghi lộ / nhân sự nghỉ | Tạo khoá mới ở nhà cung cấp → `az keyvault secret set` → revision mới cho api + worker → thu hồi khoá cũ | Không gián đoạn nếu thu hồi sau khi revision mới healthy |
| Thanh toán (VNPay/MoMo/ZaloPay) | Theo hợp đồng / khi nghi lộ | Như trên; phối hợp nhà cung cấp (có nơi cấp khoá mới thay ngay khoá cũ) | Webhook lỗi trong khoảng chuyển đổi |
| `auth-secret` | Khi nghi lộ (hoặc 12 tháng) | `terraform apply -replace=random_password.auth_secret` → revision mới api + worker | Mọi access/refresh token mất hiệu lực → người dùng đăng nhập lại |
| `payload-secret` | Khi nghi lộ | `-replace=random_password.payload_secret` → revision mới cms | Biên tập viên đăng nhập lại |
| `internal-api-token` | 6 tháng / khi nghi lộ | `-replace=random_password.internal_api_token` → revision mới api, worker **và** cms liền nhau | CMS lỗi 401 vài phút trong lúc đổi |
| Mật khẩu `allingo_app` | 6 tháng / khi nghi lộ | `-replace=module.postgres.random_password.app` (KV `database-url`, `db-bootstrap-sql` đổi) → workflow `bootstrap_db_roles = true` (ALTER ROLE) → deploy | Gián đoạn ngắn giữa ALTER ROLE và revision mới; làm ngoài giờ |
| Mật khẩu admin Postgres | 6 tháng / khi nghi lộ | `-replace=module.postgres.random_password.admin` (Terraform đổi mật khẩu server + KV `database-url-migrate`) | Chỉ ảnh hưởng job migrate/dbtools |
| Khoá Redis | 12 tháng / khi nghi lộ | `az redis regenerate-keys -g $RG -n $P-redis --key-type Primary` → `terraform apply` (đọc khoá mới, ghi KV `redis-url`) → revision mới api + worker | Kết nối lỗi tới khi revision mới chạy; làm ngoài giờ |
| Token R2 | 12 tháng / khi nghi lộ | `terraform apply -replace='module.storage.cloudflare_api_token.r2[0]'` → revision mới api + worker | Upload/presign lỗi vài phút |
| Meilisearch master key | Khi nghi lộ | `-replace=random_password.meili_master_key` (Meilisearch và KV cùng đổi) → revision mới api + worker | Tìm kiếm lỗi vài phút |
| `GHCR_PULL_TOKEN` | Trước hạn PAT (≤ 1 năm) | PAT mới → GH secret → workflow `apply_infra = true` | Không (image đã kéo vẫn chạy) |
| `CLOUDFLARE_API_TOKEN` | 12 tháng / nhân sự nghỉ | Tạo token mới cùng quyền → GH secret (cả 2 environment) → thu hồi token cũ | Không |
| Origin CA | Trước hạn (15 năm) / khi lộ khoá | Chứng chỉ mới → GH secret → `apply_infra = true` → thu hồi chứng chỉ cũ trên Cloudflare | Không (binding cập nhật tại chỗ) |
| Azure (OIDC) | – | Không có secret; rà soát federated credential/role assignment hằng quý | – |

Sau mỗi lần xoay: ghi vào nhật ký vận hành (ai, khi nào, secret nào, lý do) – không ghi giá trị.

## 4. Ai được xem / sửa

| Phạm vi | Đọc giá trị | Ghi/xoay | Cơ chế |
| --- | --- | --- | --- |
| Key Vault **staging** | Identity `allingo-staging-apps-id` (runtime); DevOps/Tech Lead khi cần (break-glass, PIM nếu có) | DevOps/Tech Lead (*Key Vault Secrets Officer*), principal CI | Azure RBAC; nhật ký truy cập qua Diagnostic settings (bật khi lên production) |
| Key Vault **dev** | Identity app; developer có thể được cấp *Key Vault Secrets User* | DevOps | |
| Terraform state (chứa secret sinh ra) | Principal CI, DevOps | Principal CI, DevOps | *Storage Blob Data Contributor* trên container `tfstate`; tắt shared key |
| GitHub environment secrets | Không ai đọc lại được; chỉ job thuộc environment dùng (staging cần reviewer) | Admin repo | Environment protection rules |
| GitHub variables | Mọi người có quyền đọc repo | Admin repo | Không chứa secret |
| Cloudflare | Super Admin (CIO), Admin (DevOps) | như bên | 2FA bắt buộc; token Terraform giới hạn zone/account |
| Developer | Secret trong `.env` cục bộ (giá trị dev) | – | Không có quyền đọc Key Vault staging mặc định |
