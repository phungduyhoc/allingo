# Runbook — Xoay secret & chứng chỉ

Danh mục secret/ENV và cách đặt trong Key Vault: `docs/runbooks/secrets.md`. Tài liệu này là quy trình XOAY định kỳ/sự cố (S11).

| Secret | Chu kỳ | Cách xoay không gián đoạn |
| --- | --- | --- |
| `AUTH_SECRET` (ký JWT HS256 + cookie) | 6 tháng / khi lộ | Hiện dùng một khoá: xoay = mọi access token (15′) hết hiệu lực → người dùng refresh. Refresh token lưu băm SHA-256 trong DB nên KHÔNG mất phiên. Lộ khoá: xoay ngay + thu hồi mọi phiên (`update iam.sessions set revoked_at = now()`). Hỗ trợ 2 khoá (kid) – đề xuất S12. |
| `INTERNAL_API_TOKEN`, `METRICS_TOKEN` | 3 tháng | Đặt giá trị mới cho CMS/Prometheus trước, rồi API (API so khớp hằng thời gian) – cửa sổ vài phút 401 cho CMS sync chấp nhận được. |
| `PAYMENT_*` (VNPay hash secret, MoMo secret key, ZaloPay key1/key2) | khi cổng yêu cầu / lộ | Đổi trên cổng merchant → Key Vault → revision mới; IPN đến giữa chừng ký bằng khoá cũ sẽ `invalid_signature` (alert) → cổng retry → `payment.reconcile`. |
| Khoá AI (Gemini/Anthropic/OpenAI), Azure Speech, Resend, MISA | 6 tháng / lộ | Tạo khoá mới, cập nhật Key Vault, deploy, thu hồi khoá cũ sau 24 giờ. |
| DB password (`allingo_app`) | 6 tháng | `ALTER ROLE allingo_app PASSWORD …` qua job `dbtools` → Key Vault `database-url` → restart revision. |
| `SENTRY_DSN`, `LANGFUSE_*`, `POSTHOG_KEY` | khi lộ | DSN không phải bí mật cao nhưng đổi được trong Sentry. |

Mỗi lần xoay: ghi `ops.audit_logs` (`secret.rotated`, tên secret – không giá trị), kiểm `gitleaks` không có giá trị trong repo.

<a id="chung-chi"></a>
## Chứng chỉ (alert CertificateExpiringSoon < 14 ngày)
- Edge: Cloudflare Universal SSL tự gia hạn; Origin CA (15 năm) gắn custom domain Container Apps – gia hạn bằng Terraform
  `modules/cdn-waf` (`cloudflare_origin_ca_certificate`) + `az containerapp ssl upload`.
- Kiểm: `echo | openssl s_client -connect api.allingo.vn:443 -servername api.allingo.vn 2>/dev/null | openssl x509 -noout -enddate`.
