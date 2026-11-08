# Runbook — Deploy & rollback (API/worker/web/CMS)

Bổ sung `docs/runbooks/deploy-staging.md` (quy trình deploy chuẩn qua `deploy-staging.yml`, ADR-0023). Revision mode **Multiple** cho
api/web/cms → rollback = chuyển traffic về revision trước, không build lại.

## 1. Trước deploy (checklist)
- CI xanh: lint · typecheck · test · `db:diff` · `api:diff` · **security** (Semgrep, `pnpm audit --audit-level high`, gitleaks,
  Trivy image) · **migration-guard** (chặn DROP/RENAME/khoá bảng không có cờ `-- migration-guard: allow <lý do>`).
- Migration mới theo expand/contract: thêm cột/bảng/index trước (index lớn: `-- concurrent-safe` → `migrate.ts` tạo bằng
  `CREATE INDEX CONCURRENTLY`), code dùng cột mới, bản sau mới xoá cột cũ (cần cờ allow).
- Không deploy trong giờ thi cao điểm (19:00–22:00 giờ VN) trừ hotfix; error budget < 25 % → chỉ hotfix (docs/slo.md).

## 2. Deploy
1. `deploy-staging` (hoặc `deploy-production` khi có): build image (tag = git sha, `SENTRY_RELEASE` = sha) → job `migrate` → revision mới
   0 % traffic → smoke (`/v1/health/ready`, `GET /v1/flags`, đăng nhập thử) → 10 % 10′ → 100 %.
2. Theo dõi 15′: dashboard "API SLO" (5xx, p95), "Thi" (lưu nháp p95), "Hàng đợi" (DLQ), Sentry release mới.

<a id="api-5xx"></a>
## 3. API 5xx > 1 % (alert ApiHighErrorRate)
1. Dashboard "API SLO" → panel "Tỉ lệ 5xx theo route" xác định route; Loki: `{service="allingo-api"} | json | level >= 50` lấy `trace_id`
   → Tempo xem span lỗi (DB? AI? cổng?). Sentry: lỗi mới theo release.
2. Trùng thời điểm deploy (annotation "Deploy") → **rollback ngay** (mục 4), điều tra sau.
3. Lỗi phụ thuộc ngoài: AI → `ai-provider.md`; cổng thanh toán → `payments.md`; DB → `db-slow.md`; Redis → `redis-down.md`.
4. Tính năng mới hỏng mà không muốn rollback → kill-switch `PUT /v1/admin/flags/<ff…>` `{ "enabled": false }` (hiệu lực < 60 s).

<a id="api-down"></a>
## 4. API không phản hồi (ApiDown / EndpointProbeFailed) & rollback
```bash
az containerapp revision list -g rg-allingo-staging -n allingo-stg-api -o table          # revision + traffic
az containerapp ingress traffic set -g rg-allingo-staging -n allingo-stg-api --revision-weight <revision-cũ>=100
az containerapp revision deactivate -g rg-allingo-staging -n allingo-stg-api --revision <revision-lỗi>
az containerapp logs show -g rg-allingo-staging -n allingo-stg-api --revision <revision-lỗi> --tail 200
```
- Worker (revision Single): `az containerapp update --image ghcr.io/…/api:<sha-cũ>` (worker dùng image api).
- Migration đã chạy không đảo được tự động: chỉ rollback code khi migration tương thích ngược (expand/contract); nếu không → khôi phục
  theo `restore.md` mục 3 (quyết định của on-call lead).
- Probe `/v1/health/ready` lỗi db/redis → xem `db-slow.md` / `redis-down.md` trước khi rollback.

## 5. Sau sự cố
Ghi timeline (UTC), nguyên nhân gốc, hành động; cập nhật test hồi quy; postmortem không đổ lỗi trong 3 ngày làm việc (`on-call.md`).
