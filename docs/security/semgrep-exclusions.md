# Chính sách xử lý phát hiện Semgrep (SAST) – v1, 08/11/2026

Job `Security` trong `.github/workflows/ci.yml` chạy Semgrep với các ruleset `p/typescript`, `p/nodejsscan`, `p/react`, `p/nextjs`, `p/jwt`, `p/secrets` và luật riêng `.semgrep/allingo.yml`, chặn CI khi có phát hiện (`--error`). Lần chạy đầu trên GitHub (08/11/2026) báo 57 phát hiện. Chủ dự án duyệt chính sách dưới đây (phương án "loại trừ có lý do", SPEC-ISSUES S154).

## 1. Nguyên tắc

1. **Sửa trước, loại trừ sau.** Phát hiện là lỗi thật thì sửa mã kèm test.
2. **Loại trừ từng dòng** bằng `// nosemgrep: <rule-id> – <lý do>` (bắt buộc ghi rule-id và lý do cụ thể); không dùng `nosemgrep` trống.
3. **Loại trừ cả luật hoặc cả thư mục** chỉ khi luật là heuristic nhiễu trên diện rộng hoặc thư mục là mã kiểm thử, và phải ghi ở bảng mục 3.
4. Thêm loại trừ mới = sửa tệp này trong cùng PR; reviewer bảo mật duyệt.
5. Rà lại danh sách mỗi quý hoặc khi nâng phiên bản Semgrep/ruleset.

## 2. Đã sửa (lỗi thật)

| Luật | Vị trí | Cách sửa |
| --- | --- | --- |
| `gcm-no-tag-length` | `apps/api/src/modules/iam/mfa/mfa.service.ts` | AES-256-GCM cố định `authTagLength: 16`, từ chối tag ngắn |
| `node_insecure_random_generator` | web: `checkout-session.ts` (Idempotency-Key), `fingerprint.ts`, `analytics/consent.ts` | Dùng Web Crypto (`lib/random.ts`), có test |

## 3. Loại trừ cả luật / thư mục

| Phạm vi | Lý do | Kiểm soát bù |
| --- | --- | --- |
| Thư mục `apps/web/src/mock/**` | Test double cho chế độ `NEXT_PUBLIC_API_MOCK=1` (dev/E2E): dữ liệu giả, `Math.random`, mật khẩu mẫu | Không dùng ở production; E2E chạy cả chế độ API thật |
| Luật `ajinabraham.njsscan.dos.regex_dos.regex_dos` | Heuristic báo mọi regex áp lên biến (28 vị trí). Đã rà: tất cả là mẫu neo `^…$` hoặc lớp ký tự đơn, không có lượng từ lồng nhau; `SUFFIX_RE` của chính sách mật khẩu có `.*?` nhưng đầu vào bị giới hạn độ dài | Review regex mới trong PR; đề xuất thêm lint `regexp/no-super-linear-backtracking` (backlog) |

## 4. Ngoại lệ từng dòng (`nosemgrep`)

| Luật | Vị trí | Lý do |
| --- | --- | --- |
| `handlebars_noescape` | `ai-gateway/core/prompt-renderer.ts` (3) | Template là prompt văn bản gửi LLM, không render HTML; nội dung người học bọc `<user_input>` (CLAUDE.md §5.4) |
| `raw-html-format` | `billing/webhooks.controller.ts` (2) | Trang cổng thanh toán giả, chỉ bật ở dev/test (`assertMock`); giá trị động đã `esc()` |
| `node_sha1` | `iam/password/password-policy.ts` | Giao thức k-anonymity Have I Been Pwned bắt buộc SHA-1, chỉ gửi 5 ký tự đầu; mật khẩu lưu bằng Argon2id |
| `node_md5` | `shared/storage/fs.driver.ts` (2) | ETag kiểu S3 cho driver lưu trữ dev, không phải mục đích bảo mật |
| `node_insecure_random_generator` | `shared/telemetry/error-reporter.ts` | Lấy mẫu sự kiện lỗi theo tỉ lệ, không sinh bí mật |
| `node_password` | `apps/cms/scripts/seed-cms.ts`, `db/seed/demo/index.ts` | Mật khẩu tài khoản demo cục bộ (công khai trong README); script/seed chặn chạy khi `APP_ENV=production` |
| `node_secret` | `shared/telemetry/redact.ts`, `web/lib/telemetry/scrub.ts` | Chính là bộ che bí mật (thay token bằng nhãn), không chứa bí mật |

Bí mật thật vẫn được chặn bởi `gitleaks` (toàn lịch sử git) và ruleset `p/secrets`.
