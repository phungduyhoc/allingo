# OWASP ASVS 4.0.3 – Level 2 checklist (API Allingo, Sprint 11)

Phạm vi: `apps/api` (NestJS/Fastify), dữ liệu PostgreSQL/Redis/R2, CI/CD. Web (`apps/web`) và CMS (`apps/cms`) chỉ ghi phần liên quan
API (CSP nonce, Sentry web, flags client do sprint web). Trạng thái: ✅ đạt (có bằng chứng) · ⚠️ một phần/chấp nhận rủi ro có hạn · ❌ chưa
· N/A. Bằng chứng = test tự động (đường dẫn) hoặc cấu hình. Hồi quy pentest 1: `apps/api/test/integration/s11-pentest.test.ts` (#1–#10).

## V1 Kiến trúc
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 1.1.2 | Threat model cho thay đổi lớn | ⚠️ | STRIDE rút gọn trong pentest 1; chưa có tài liệu threat model riêng (S12) |
| 1.4.1 | Kiểm soát truy cập ở server, điểm thực thi tập trung | ✅ | `AuthGuard` + `@Roles` toàn cục, `KillSwitchGuard`, `RateLimitGuard` (app.module.ts); IDOR #1 |
| 1.4.5 | Kiểm soát theo thuộc tính/dữ liệu (tenant) | ✅ | RLS 4 bảng B2B + `withRls` SET LOCAL; #2 (vai trò `allingo_app` NOBYPASSRLS) |
| 1.5.3 | Validate input ở lớp tin cậy | ✅ | Zod mọi body/query/param (`ZodBody`/`ZodParams`), strict ở admin |
| 1.6.2 | Khoá bí mật không trong mã | ✅ | Key Vault + env; gitleaks CI (allowlist chỉ giá trị test giả) |
| 1.7.1 | Log/telemetry nhất quán, không PII | ✅ | `redact.ts` (pino formatters + hooks), `s11-observability.test.ts` |
| 1.14.6 | Không dùng công nghệ client không an toàn | N/A | |

## V2 Xác thực
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 2.1.1 / 2.1.7 | Mật khẩu ≥ 12 ký tự / kiểm mật khẩu lộ | ⚠️ | Schema hiện ≥ 8 ký tự; chưa kiểm HIBP (đề xuất S12, cần quyết định sản phẩm) |
| 2.2.1 | Chống brute force / credential stuffing | ✅ | Khoá theo email 10 lần sai/15′ (cả email không tồn tại), bucket `login_ip`, WAF `/v1/auth/*`, Turnstile; `s11-ops-security.test.ts` |
| 2.2.3 | Thông báo người dùng khi đổi xác thực | ⚠️ | Audit `auth.login_locked`; email cảnh báo đăng nhập lạ chưa có |
| 2.5.2 | Không gợi nhớ mật khẩu / câu hỏi bí mật | ✅ | Không có |
| 2.7.x | OTP: 6 số, 5′, 5 lần sai khoá 30′, lưu băm HMAC | ✅ | S1 `otp.test.ts`, `iam-sprint1.test.ts` |
| 2.8.x | TOTP/MFA | ❌ | Ngoài phạm vi GĐ1 (S1) |
| 2.10.x | Bí mật dịch vụ (INTERNAL_API_TOKEN) so khớp hằng thời gian | ✅ | `metrics.controller.ts` `timingSafeEqual`; InternalTokenGuard dùng `!==` ⚠️ (đề xuất đổi sang timingSafeEqual – S12) |

## V3 Quản lý phiên
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 3.2.1 | Token mới khi đăng nhập | ✅ | Phiên mới mỗi login; refresh xoay vòng |
| 3.3.1 / 3.3.3 | Logout/thu hồi có hiệu lực ngay | ✅ | Denylist Redis + fallback DB (S1) |
| 3.4.1–3.4.3 | Cookie `Secure` (theo env), `HttpOnly`, `SameSite=Lax`, path hẹp cho refresh | ✅ | `AuthService.cookieOptions`; Semgrep `allingo-cookie-without-httponly` |
| 3.5.2 / 3.5.3 | JWT ký + kiểm thuật toán/audience/hạn | ✅ | `jwtVerify` `algorithms: ['HS256']`, iss/aud; #7 (alg none, HS512, sai khoá, hết hạn, nhầm audience) |
| 3.7.1 | Xác thực lại cho thao tác nhạy cảm | ⚠️ | Liên kết OAuth cần mật khẩu (S1); xoá tài khoản chưa yêu cầu nhập lại mật khẩu |

## V4 Kiểm soát truy cập
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 4.1.1 / 4.1.3 | Deny by default, least privilege | ✅ | Guard toàn cục, `@Public` tường minh |
| 4.2.1 | IDOR | ✅ | #1 attempt/order/notes; ownership ở service |
| 4.2.2 | CSRF | ✅ | Kiểm Origin/Sec-Fetch-Site/Referer cho cookie-auth + mọi POST `/auth/*` (`security.ts`); SameSite=Lax; `s11-ops-security.test.ts` |
| 4.3.1 | Admin cần MFA | ❌ | Chưa có MFA; bù: WAF geo/IP cho `/v1/admin` (Terraform cdn-waf) |

## V5 Validation, sanitization, encoding
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 5.1.x | Validate kiểu/độ dài/allowlist | ✅ | Zod |
| 5.2.1 | Sanitize HTML/markdown không tin cậy | ✅ | `sanitizeNoteMarkdown` (vá S11 – thẻ lồng, entity/percent/control trong `javascript:`), #10, `note-sanitize.test.ts` |
| 5.2.6 | SSRF | ✅ | Không fetch URL người dùng; ffmpeg `-protocol_whitelist file` + nhận dạng magic bytes; presign allowlist MIME; #9 |
| 5.3.3 | Escape theo ngữ cảnh (HTML) | ✅ | Trang OG referral escape + CSP `default-src 'none'` (S11) |
| 5.3.4 | SQL tham số hoá | ✅ | Drizzle/`sql` tag; Semgrep `allingo-sql-raw-interpolation` |
| 5.3.8 | OS command injection | ✅ | `execFile`/`spawn` mảng tham số; Semgrep `allingo-shell-exec-template` |
| 5.5.x | Deserialization an toàn | ✅ | JSON.parse + Zod; không YAML/pickle từ người dùng |

## V7 Lỗi & log
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 7.1.1 / 7.1.2 | Không log thông tin xác thực/PII | ✅ | Redaction sâu theo khoá + giá trị (email/phone/JWT/Bearer/query bí mật); log request dùng route mẫu, bỏ query |
| 7.2.x | Log sự kiện xác thực/quyền | ✅ | `ops.audit_logs` (login_locked, flag.update, webhook_rejected, refund…) |
| 7.4.1 | Thông báo lỗi chung + trace_id | ✅ | Envelope `{error:{code,message,details,trace_id}}`; 500 không lộ chi tiết (unit test filter) |
| 7.1.4 | Chống chèn log | ✅ | `x-request-id` chỉ nhận `[A-Za-z0-9._-]{8,64}` (S11) |

## V8 Bảo vệ dữ liệu
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 8.1.1 | Không cache dữ liệu nhạy cảm ở proxy | ✅ | `Cache-Control: no-store` cho phản hồi có phiên (S11) |
| 8.3.4 | Xoá dữ liệu theo yêu cầu | ✅ | `DELETE /me` + `iam.purge` 72 giờ; runbook `data-deletion.md` |
| 8.3.x | Dữ liệu nhạy cảm không trong URL | ✅ | ZAP local: chỉ "Informational" về tên tham số (order_id/status) |

## V9 Truyền thông
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 9.1.1 | TLS mọi kết nối ngoài | ✅ | Cloudflare Full (strict), TLS ≥ 1.2, HSTS 1 năm includeSubDomains |
| 9.2.x | TLS nội bộ (DB/Redis) | ✅ | PG Flexible TLS, Redis 6380 TLS; Semgrep chặn `rejectUnauthorized: false` |

## V10 Mã độc / chuỗi cung ứng
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 10.3.2 | Phụ thuộc có lỗ hổng | ⚠️ | `pnpm audit --audit-level high` chặn CI; 5 GHSA bắc cầu không xử lý input runtime được chấp nhận tới 30/11/2026 (pnpm-workspace.yaml); Renovate; Trivy image |

## V11 Nghiệp vụ
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 11.1.2 / 11.1.4 | Giới hạn tốc độ nghiệp vụ, chống lạm dụng tự động | ✅ | Token bucket explain/tutor/submit/orders/pay, quota Free; #6 (8 request đồng thời → ≤ 3, không 500 – vá race enrollment) |
| 11.1.5 | Ràng buộc tuần tự (thanh toán) | ✅ | Webhook-first, idempotent, chữ ký; #5 replay/tamper |

## V12 Tệp & tài nguyên
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 12.1.1 | Giới hạn kích thước | ✅ | `BODY_LIMIT_BYTES` 2 MB; presign `size_bytes` ≤ MAX; URL ký ràng buộc content-type + kích thước |
| 12.2.1 | Kiểm loại tệp thật | ✅ (media) / ⚠️ (ghi âm) | Media: magic bytes trước ffmpeg; ghi âm người học chưa có bước xử lý (GĐ2 speaking) – phải thêm sniff khi tiêu thụ |
| 12.4.1 | Lưu ngoài web root, URL ký 10′ | ✅ | R2/S3 private + presign |

## V13 API
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 13.1.3 | Không lộ dữ liệu thừa | ✅ | #3 không `answer_key`/`explanation` khi thi; `/flags` chỉ boolean |
| 13.2.5 | Content-Type kiểm | ✅ | Parser JSON + form (chỉ cho callback cổng); CSRF kiểm Origin nên form cross-site không đăng nhập được |
| 13.2.6 | Header bảo mật | ✅ | CSP JSON `default-src 'none'`, HSTS, nosniff, frame DENY, no-referrer (test) |

## V14 Cấu hình
| ID | Yêu cầu | TT | Bằng chứng / ghi chú |
| --- | --- | --- | --- |
| 14.1.x | Build tái lập, CI bảo mật | ✅ | `ci.yml`: gitleaks, audit, Semgrep, Trivy image, migration-guard; ZAP nightly (`zap-nightly.yml`) |
| 14.2.x | Quản lý phụ thuộc | ✅ | Renovate (`renovate.json`) |
| 14.3.2 | Không bật debug/docs ở production | ✅ | Swagger `/docs` chỉ khi APP_ENV ≠ production |
| 14.4.x | Header HTTP | ✅ | Như V13.2.6; web CSP nonce: sprint web |
| 14.5.3 | CORS allowlist | ✅ | `CORS_ORIGINS` tường minh, credentials |

Tổng: L2 áp dụng cho API – đạt phần lớn; mở: MFA admin (❌), mật khẩu ≥ 12/HIBP (⚠️), email cảnh báo đăng nhập (⚠️), sniff ghi âm khi
tiêu thụ (⚠️ GĐ2), phụ thuộc bắc cầu chấp nhận có hạn (⚠️), threat model riêng (⚠️), InternalTokenGuard so khớp hằng thời gian (⚠️).
