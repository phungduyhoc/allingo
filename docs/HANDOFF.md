# HANDOFF — Sprint 1 → Sprint 12 (08/11/2026)

Bàn giao sau phiên Claude Code chạy lần lượt Sprint 1–12 theo `docs/prompts/ALLINGO-SPRINT-PROMPTS.md`. Đọc cùng `README.md`, `CLAUDE.md`, `docs/ASSUMPTIONS.md` (A1–A214), `docs/SPEC-ISSUES.md` (S1–S142), ADR 0001–0035, `docs/gates/GATE-2-report.md`. Bàn giao Sprint 0 xem lịch sử git của tệp này (`git log -p docs/HANDOFF.md`).

Mọi kiểm tra dưới đây chạy trong phiên cloud: Postgres 16 + pgvector, Valkey/Redis cục bộ, không Docker, không Meilisearch/MinIO/Azure/khoá AI/cổng thanh toán thật (A1, A25). Quy trình cài trên máy mới đã chạy thử trên bản clone sạch (A214).

## 1. Nghiệm thu theo sprint

### Sprint 1 — IAM đầy đủ, 12 dạng câu, IaC

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Đăng nhập Google thật → tạo user, ghép khách, lần 2 không trùng | ĐẠT (mock) / CHƯA (Google thật) | Luồng đầy đủ qua `MockOAuthProvider` (cùng đường mã `jose` + JWKS); cần `GOOGLE_CLIENT_ID` của anh để thử thật |
| 2 | OTP email, sai 5 lần → khoá 30 phút | ĐẠT | Integration + E2E (`e2e/auth.spec.ts`); Mailpit thay bằng mailer memory trong phiên |
| 3 | `DELETE /me` → purge ẩn danh hoá, ledger còn | ĐẠT | `PURGE_DELAY_MINUTES`; từ S2 xoá cả tệp ảnh người học (`PersonalDataRegistry`) |
| 4 | Refresh token dùng lại → thu hồi toàn bộ phiên + audit | ĐẠT | Thu hồi commit ở transaction riêng; access token bị chặn ngay (denylist Redis, fallback DB) |
| 5 | ≥ 36 test schemas, `grade()` đúng fixture | ĐẠT | `packages/schemas` 242 test (12 dạng × ≥ 3 fixture) |
| 6 | `terraform validate` + `deploy-staging` tới bước build image | CHƯA | Phiên không có terraform/Docker; `infra/terraform/scripts/validate.sh` + job `terraform-validate` trong `preview.yml` chạy ở lần push đầu |
| 7 | `api:diff` nhóm Auth/Me, `db:diff` | ĐẠT | |

### Sprint 2 — Catalog & CMS workflow, media, tìm kiếm, PoC → GATE-1

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Editor → AI kiểm tra → teacher review1 → admin review2 → `GET /practice/questions`; reject review1 có ghi chú | ĐẠT | Integration + E2E thật CMS→API→web (`e2e/practice.spec.ts`). Reject → `rejected` (bắt buộc ghi chú); "cần sửa" → `draft` kèm ghi chú (ADR-0024) |
| 2 | Sửa câu published → v2; attempt cũ review vẫn v1 | ĐẠT | Phiên bản chờ duyệt không ảnh hưởng người học tới khi phát hành |
| 3 | Import 50 câu có 2 trùng → báo 2 dòng, nhập 48 | ĐẠT | Trùng trong lô + trùng catalog (pg_trgm ≥ 0,85) |
| 4 | Audio 5 MB → `ready`, duration, waveform, URL ký 10 phút | ĐẠT | Driver `fs` (không MinIO); job `media.process` qua BullMQ; S3 driver chỉ typecheck |
| 5 | Tìm "invoice" trong Meilisearch; draft không xuất hiện; index không có `answer_key` | ĐẠT một phần | Kiểm chứng với `PgSearchProvider`; adapter Meilisearch chưa chạy với server thật (A25) |
| 6 | `GATE-1-report.md` có số liệu thật | CHƯA | Harness PoC-W/PoC-P xong, chỉ có số chạy mock. Cần: 30–50 bài Writing có band giáo viên, 20–30 ghi âm có điểm, khoá Gemini/Claude/Azure |
| 7 | `api:diff`, `db:diff` xanh; ≥ 25 ca test mới | ĐẠT | ~ 60 ca mới (schemas content 10, CMS 3, API workflow 8, media 33…) |

### Sprint 3 — Test Engine TOEIC Reading & Exam Mode

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Đề 100 câu, tắt mạng giữa chừng, tải lại: không mất câu, đồng hồ đúng | ĐẠT | Playwright `exam-offline.spec.ts`: offline giữa bài → vẫn trả lời (banner) → online → tải lại → đúng câu đang xem và đáp án, đồng hồ theo `expires_at` server; thêm bước đóng tab khi offline, mở lại khôi phục từ IndexedDB. `exam-layout.spec.ts` chạy trên đề Reading full 100 câu thật. Mất mạng mô phỏng bằng `context.setOffline` (chưa thử wifi thật 2 phút) |
| 2 | Hết giờ tự nộp; nộp 2 lần cùng kết quả; `PUT /answers` sau hạn + 31 s → 409 | ĐẠT | Integration `test-engine-s3.test.ts` |
| 3 | Breakdown Part 5/6/7, ước tính thang điểm, review lọc "câu sai" | ĐẠT (API) | Đề `toeic-reading-full-01` trả đúng hết → 495, by_section 30/16/54 |
| 4 | k6 1.000 VU, p95 `PUT /answers` < 150 ms | CHƯA | Máy phiên 2 CPU dùng chung (API + PG + Redis cùng máy): 229–261 req/s, p97,5 ≈ 360 ms ở 50 kết nối, 0 lỗi, không deadlock. Script k6 `tests/load/attempt-flow.js` để chạy trên staging (A38) |
| 5 | `api:diff`, `db:diff` xanh; Playwright luồng thi trong CI | ĐẠT cục bộ | E2E 18/18 ở cả mock và API thật (4 bỏ qua có chủ đích: CMS ×2, ảnh màn hình ×2); job E2E trong CI chạy với mock – chờ push để thấy lần chạy đầu |

### Sprint 4 — Listening Part 1–4, practice & drill, quy đổi điểm L&R

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Đề L&R 200 câu: Listening phát liên tục một lần, không tua; sau nộp xem transcript, nghe lại từng câu | ĐẠT | `e2e/listening.spec.ts`: không thanh tua/`controls`, ←/→ và click không đổi `currentTime`, `pause()`/tua từ ngoài bị trả lại; tải lại → "Tiếp tục nghe" không lùi; hết Listening → Reading; Review có transcript tô dòng đang phát |
| 2 | Practice Part 3: tua, đổi tốc độ, lặp; đáp án hiện ngay | ĐẠT | Tua ±5 s, 0,75/1/1,25, lặp câu/nhóm |
| 3 | Mini 60 câu sinh ngẫu nhiên hợp lệ cấu trúc, lặp lại được bằng `seed` | ĐẠT | `generateMiniTest` (mulberry32): 100 seed đều hợp lệ; `POST /admin/test-sets/generate` + CLI; seed demo có `toeic-mini-lr-01/02` |
| 4 | Điểm L/R/Tổng + khoảng ước tính, test bảng quy đổi | ĐẠT | Thang tự xây dựng, luôn ghi "ước tính"; ±25 mỗi kỹ năng |
| 5 | Chrome/Safari/Firefox phát được audio | ĐẠT một phần | Chrome 153 (Playwright) phát MP3/WAV + SVG đúng; Safari/Firefox không có trong phiên – cần thử tay (mã đã mở khoá nhóm `<audio>` trong cùng cú bấm cho Safari) |
| 6 | `api:diff`, `db:diff` xanh; Playwright Listening chạy trong CI với audio mock | ĐẠT cục bộ | E2E 28/28 (mock và API thật); CI chờ push |

Audio đề Listening 01 hiện là MP3 im lặng đúng thời lượng (TTS mock): chạy `pnpm --filter @allingo/api seed:media --force` với `SPEECH_PROVIDER=azure` + khoá để có giọng thật (A54). Đo tải đề 200 câu: 188 req/s, `PUT /answers` p97,5 340 ms, 0 lỗi; sửa deadlock khi nhiều người nộp cùng lúc (S35).

### Sprint 5 — AI Gateway production, Explain, Diagnose, Summary, Metering & Quota

Phiên không có khoá AI/Langfuse thật – mọi kiểm chứng chạy với provider giả lập (MockProvider, `MockLanguageModelV4`).

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Tắt key Gemini → fallback theo `model_routes`, `fallback_used=true`; 5 lỗi → breaker mở, tự đóng sau 60 s | ĐẠT (mock) | Breaker theo provider, half-open, log cảnh báo |
| 2 | Eval `explain_mcq` ≥ 4/5 lưu `GET /admin/eval-runs`; kích hoạt prompt chưa eval → 409 | ĐẠT một phần | 409 `eval_required` ĐẠT; eval 179 câu chạy được nhưng với mock (`mock=true, passed=false`) – cần khoá thật + LLM giám khảo |
| 3 | Free: explain lần 11 → 429 còn 0; 00:00 giờ VN reset; `usage_counters` chốt đúng | ĐẠT | Đồng hồ giả lập; sửa lỗi chốt đêm mất số ngày hôm trước |
| 4 | Sinh 10 câu Part 5 "logistics" → 10 draft `source=ai`, có check, câu trùng bị gắn cờ | ĐẠT (mock) | Embedding mock không mang ngữ nghĩa – ngưỡng 0,92 cần đo với embedding thật |
| 5 | Dashboard chi phí AI khớp Langfuse ±1 % | CHƯA KIỂM CHỨNG | Cùng nguồn `cost_usd`; cần Langfuse thật |
| 6 | `api:diff`, `db:diff` xanh; không `console.log`; không PII trong trace | ĐẠT | Migration 0003; user_id băm |
| Web | Review → Explain SSE → 👍; chẩn đoán AI Pro; hạn mức + CTA | ĐẠT | E2E API thật 40/40, mock 42/42; sửa SSE thiếu header CORS (trình duyệt chặn) |

Chi phí ước tính ≈ 1,0 USD / 1.000 explain (Gemini 2.5 Flash, token ước lượng) – có thể 1,7–1,9 USD với đầu ra tiếng Việt dài và token "thinking"; cần đo thật. Sửa lỗi nghiêm trọng: adapter AI SDK 7 từ chối message `system` (adapter thật sẽ hỏng ngay khi có khoá).

### Sprint 6 — Tutor chat SSE, tra từ, ghi chú, PWA

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Review hỏi "Vì sao đáp án C sai?" → stream đúng câu, có trích dẫn; xin đáp án đề đang thi → 403 | ĐẠT (AI mock) | `e2e/tutor.spec.ts` mock + API thật; ma trận khoá Exam Mode 4 trạng thái × 13 endpoint |
| 2 | Prompt injection bị guard từ chối, `status=refused`, không gọi model chính | ĐẠT | Luật guard cục bộ + guard model; guard lỗi → chặn (fail-closed) |
| 3 | Tra "invoice" < 200 ms (cache); câu dài dịch AI, lần 2 cache hit | ĐẠT | Từ điển tự biên soạn 1.750 mục, phủ 98,5 % từ nội dung ngân hàng demo |
| 4 | Thêm 5 từ vào SRS từ passage; ghi chú hiện lại ở Review | ĐẠT | `e2e/dictionary.spec.ts`, `e2e/notes.spec.ts` |
| 5 | Cài PWA; tắt mạng → trang offline + đề đã xem; nhận push thử | ĐẠT một phần | Installable (Lighthouse 11.7), offline + đề đã xem ĐẠT trên bản production; push: Chrome headless không cấp subscription thật → kiểm bằng PushManager giả + CDP `deliverPushMessage`; push thật cần thiết bị |
| 6 | Lighthouse PWA installable, Performance ≥ 85, Accessibility ≥ 95 (`/toeic/dashboard`) | CHƯA (mobile) | Desktop: Perf 97, A11y 100; mobile: Perf 74–76 (TBT 1,2–1,6 s trên máy 2 vCPU dùng chung), A11y 100. Cần giảm JS client (giới hạn messages next-intl, dashboard RSC) – TODO T9 |
| 7 | `api:diff`, `db:diff` xanh | ĐẠT | Migration 0004 |

Phát hiện và sửa thêm: CMS production lỗi 500 khi tạo câu (schema `cms` thiếu cột mới vì production không push) → migration Payload ban đầu `apps/cms/migrations` + bước `payload migrate` trong runbook deploy.

### Sprint 7 — Billing: đơn hàng, 3 cổng thanh toán, subscription & entitlement gating

Phiên không có credential sandbox và không ra được mạng cổng: VNPay 2.1.0, MoMo AIO v2, ZaloPay v2 viết theo tài liệu chính thức, kiểm bằng vector chữ ký tính độc lập (openssl) + HTTP giả lập; luồng đầu-cuối chạy với `MockPaymentProvider` (trang thanh toán giả có nút paid/failed/cancelled/paid-drop).

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Mua Pro tháng qua VNPay/MoMo/ZaloPay sandbox → webhook → quyền < 5 s, credit tháng, ledger 2 dòng đúng `balance_after` | ĐẠT (mock + IPN tự ký) / CHƯA (sandbox thật) | E2E `checkout.spec.ts` mock + API thật; cần credential sandbox + tunnel https (`PAYMENT_CALLBACK_BASE_URL`) – runbook payments §2 |
| 2 | Gửi lại webhook 3 lần → 1 payment; sai chữ ký → 400 + audit | ĐẠT | Cả 3 webhook đồng thời (`Promise.all`) chỉ cấp 1 lần |
| 3 | Pending 31′ → expired; mất webhook → `payment.reconcile` cấp quyền | ĐẠT | `paid-drop` E2E |
| 4 | Free đề full lần 3/tháng → 429 đúng envelope; Pro không giới hạn | ĐẠT | Ma trận plan × feature qua `FeatureGateService` + `packages/config/entitlements.ts` |
| 5 | Huỷ subscription → giữ quyền tới hết kỳ → job hạ Free + thông báo | ĐẠT | Nhắc 7/3/1 ngày mỗi mốc một lần |
| 6 | Đối soát 20 giao dịch không lệch; báo cáo CSV | ĐẠT (giả lập) | Mẫu CSV sao kê tự định nghĩa – cần đối chiếu mẫu thật từng cổng |
| 7 | `api:diff`, `db:diff` xanh; không secret; ≥ 40 ca mới | ĐẠT | 66 ca mới |

### Sprint 8 — Hoá đơn điện tử, khuyến mãi, referral, thông báo đa kênh

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Mua gói → hoá đơn trong 60 s (sandbox nhà cung cấp), PDF tải được, email PDF; hoàn tiền → huỷ | ĐẠT (mock) / CHƯA (MISA thật) | ADR-0030 Proposed: MISA meInvoice mặc định. **Cần kế toán xác nhận** xử lý hoàn tiền (NĐ 123/2020, NĐ 70/2025 thường yêu cầu điều chỉnh/thay thế, không huỷ – S90) và thuế suất mặc định |
| 2 | `WELCOME20` 20 % user mới, lần 2 bị từ chối; trial 7 ngày một lần | ĐẠT | Không vượt `max_uses` khi đặt đồng thời |
| 3 | A giới thiệu B: joined → started → upgraded, thưởng đúng; B thứ 21/tháng không thưởng; cùng fingerprint không thưởng | ĐẠT (API) | Web gửi `X-Device-Fingerprint` – API đã được bổ sung header CORS ở Sprint 10 |
| 4 | Tắt email marketing → không nhận email tuần; push không gửi trong giờ yên lặng | ĐẠT | Giờ yên lặng theo giờ VN |
| 5 | Admin cấp 100 credit kèm lý do → ledger `admin_adjust`, audit có admin id | ĐẠT | E2E `admin-billing.spec.ts` |
| 6 | `api:diff`, `db:diff` xanh; dead-letter hoá đơn trong admin | ĐẠT | Trang admin billing 10 tab |

Web Sprint 7–8: bảng giá thật, checkout, kết quả thanh toán (polling + Socket.IO), lịch sử đơn/hoá đơn, sổ credit, huỷ gói, banner hết hạn, giới thiệu bạn bè + ảnh OG, chuông thông báo realtime, trang quản lý thông báo theo token, admin billing. Unit 200, E2E mock 86/86, API thật 81/82 (1 ca push chập chờn khi máy tải nặng).

### Sprint 9 — Diagnostic v1, lộ trình học (study plan), gamification

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Onboarding + chẩn đoán → plan 8 tuần, tuần cuối có full test, phút/tuần đúng cài đặt | ĐẠT (API) | Chẩn đoán thích ứng 61 câu dựng từ ngân hàng đề 01 (trùng đề full 01 – A131); PlanGenerator thuần, property test 5 × 500 ca |
| 2 | Drill từ task → task done, XP, streak; bỏ 3 ngày → expired, streak 0 (Pro đóng băng 1 ngày) | ĐẠT | Đồng hồ giả lập, theo múi giờ người học |
| 3 | Check-in "tuần này bận, chỉ 2 giờ" → đề xuất giảm tải hợp lệ, áp dụng, lịch sử; đề xuất sai bị từ chối | ĐẠT (AI mock) | Cần eval `plan_adjust_v1` với model thật |
| 4 | Nhắc học đúng 19:00 giờ người học; đã học → không nhắc | ĐẠT (giả lập) | Nhắc giữ chuỗi 20:00; push thật cần thiết bị |
| 5 | Huy hiệu "7 ngày liên tiếp" đúng ngày thứ 7 + in-app | ĐẠT | |
| 6 | `api:diff`, `db:diff` xanh; property test 500 ca | ĐẠT | Migration 0006, ADR-0031/0032 |
| Web | Onboarding 4 bước, plan kéo thả, Hôm nay, check-in, huy hiệu | ĐẠT | Unit 235; E2E S9 10/10 mock (desktop + mobile), 5/5 API thật; phát hiện `POST /submit` 500 khi truyền Date vào SQL thô (đã sửa ở API) |

### Sprint 10 — FSRS từ vựng, sổ lỗi, thống kê & dashboard, marketing & blog

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Thêm 20 từ → hôm nay 10 thẻ mới (Free); Again quay lại trong phiên; "Good → hôm sau"; mô phỏng 7 ngày khớp ts-fsrs | ĐẠT (có điều chỉnh) | FSRS-5 chuẩn: thẻ mới Good → 3 ngày (Again rồi Good → 1 ngày) – giữ thuật toán, đề xuất sửa tiêu chí (S120); 11 bộ TOEIC 600 từ |
| 2 | Sai 8 câu → 8 mục sổ lỗi, "làm lại 10 câu sai" đúng câu; đã hiểu → khỏi `review_errors` | ĐẠT (API) | Phân loại theo luật |
| 3 | Dashboard điểm, độ chính xác theo Part, percentile; `GET /me/stats` p95 < 300 ms (50 attempt) | ĐẠT (API) | Replica READ ONLY + cache 1 giờ |
| 4 | Blog Payload → web ≤ 5 phút (ISR + webhook), JSON-LD, OG, sitemap | ĐẠT (thành phần) | Web: ISR 300 s, `/api/revalidate` kiểm HMAC (đúng/sai/quá hạn → 200/401/401), sitemap + hreflang, JSON-LD, OG động; luồng đầu-cuối xuất bản từ admin CMS → webhook chưa thử tay |
| 5 | PostHog chỉ nhận sau đồng ý cookie; phễu 7 sự kiện | ĐẠT (sink giả) | Banner đồng ý; trước đồng ý không có request sự kiện (E2E); server phát 4 sự kiện còn lại; cần key PostHog thật |
| 6 | Lighthouse mobile landing ≥ 90/95/95/95; `api:diff`, `db:diff` | ĐẠT | Landing mobile Perf 96–100, A11y/BP/SEO 100 (trước tối ưu 79); dashboard mobile 75–77 (mục tiêu ≥ 85 – T9); web unit 281, E2E mock 58/58, API thật 55/57 (2 ca chập chờn) |

### Sprint 11 — Observability, hiệu năng, bảo mật, vận hành

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | Grafana 6 dashboard có dữ liệu; tắt Redis → alert Slack < 2′, link runbook; bật lại → resolve | ĐẠT một phần | Dashboard/alert as code, 71 biểu thức chạy trên dữ liệu :4000; diễn tập alert bằng Prometheus + Alertmanager thật (webhook giả thay Slack): kill Redis → cảnh báo 88 s, resolve 111 s. Stack compose Grafana/Loki/Tempo chưa chạy (không Docker) |
| 2 | k6 5.000 VU/30′ đạt ngưỡng; báo cáo trước/sau | CHƯA (staging) | Máy phiên ≈ 1.500 VU thời gian thực: p95 PUT /answers 50 ms, submit 116 ms, review 49 ms, lỗi 0 % (trước: timeout, 8,3 % lỗi) – `docs/perf/report-S11.md`; sửa deadlock pool (Critical) |
| 3 | Log không email/phone/token | ĐẠT | Test redaction + log trong lượt tải |
| 4 | ZAP baseline 0 high; 10 kịch bản pentest tay đã vá + test hồi quy; CSP không lỗi | ĐẠT | ZAP cục bộ 0 High/Medium/Low; vá XSS ghi chú (High), quota race, khoá đăng nhập, CSRF; web: CSP nonce + `strict-dynamic`, bản production 0 vi phạm CSP trên landing → exam → kết quả → review/giải thích, listening, checkout, blog, 17 trang app (`e2e/csp.spec.ts`); 3 bảng billing có `org_id` chưa bật RLS (Medium, S124) |
| 5 | Restore PITR về 10′ trước < 60′; runbook ghi thời gian thật | ĐẠT (cục bộ) | RTO kỹ thuật 3,2 s, RPO 0 trên PG cục bộ; quy trình có người ước 15–25′; Azure đo trên staging |
| 6 | Kill-switch `ff.ai.explain` → UI ẩn, API 503 i18n < 60 s | ĐẠT | Pub/sub tới các replica; web làm mới cờ 30 s + khi focus, 503 → notice + toast i18n và làm mới cờ ngay (`e2e/flags.spec.ts`, API thật); thêm kill-switch `ff.ai.diagnose` (A213) |
| 7 | lint/typecheck/test xanh, CI có security jobs, diff xanh | ĐẠT | 905 test (không tính web); gitleaks, audit high, Semgrep, Trivy, ZAP nightly, migration guard |

**Giao diện Sprint 11.** Cờ tính năng phía client (SSR + làm mới 30 s, `FeatureGate`), xử lý 429/503 (toast đếm ngược, `login_locked`), chính sách mật khẩu ≥ 12, telemetry Sentry Envelope tự viết (lỗi, phiên crash-free, Web Vitals, che PII, `traceparent`), message i18n theo trang (HTML dashboard 142 → 68 KB), ESLint `no-jsx-literal-text`, axe WCAG 2.1 AA luồng thi bằng bàn phím: 0 vi phạm serious/critical. Lighthouse dashboard mobile: trung vị **86** khi máy rảnh (trước 78–81), **82** khi máy chia tải với API/CMS (trước 73–76); CLS 0, A11y 100, BP 100 – đo lại trên staging (S141). Web unit 339, E2E mock 130 (12 skip chỉ chạy thật), E2E API thật 130 (12 skip).

### Sprint 12 — Beta kín, admin & vận hành, phân tích, GATE-2

Phiên không có người dùng/SMTP/PostHog/Sentry thật: cơ chế đã xây đủ, KPI chỉ có từ seed `beta-demo` (giả lập). Báo cáo GATE-2: `docs/gates/GATE-2-report.md` (kết luận **chưa đủ điều kiện**).

| # | Tiêu chí | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| 1 | 300 lời mời theo đợt; không mã → không vào app; tester nhận Pro trial + credit | ĐẠT (cơ chế) | Gate `ff.growth.beta_gate` (403 `beta_required`), mời theo lô 50/ngày, mã dùng một lần → trial 60 ngày + 2.000 credit; chưa gửi email thật |
| 2 | Góp ý kèm trace_id + ảnh; báo lỗi câu vào CMS; ticket trả lời từ admin, người dùng nhận email/in-app | ĐẠT | Content reports đồng bộ hai chiều API ↔ CMS; ticket SLA 24 giờ, credit bù; web: nút Góp ý (ảnh dán/chọn, trace_id gần nhất), Báo lỗi câu ở Xem lại/Practice, `/support` hội thoại 2 chiều; E2E API thật luồng tester đầy đủ |
| 3 | Admin khoá tài khoản → thu hồi phiên ≤ 60 s; impersonate chỉ đọc có audit; DLQ replay | ĐẠT | Integration test |
| 4 | `pnpm report:beta` đủ KPI, khớp PostHog/DB ±2 % | ĐẠT một phần | Chạy ra số từ dữ liệu giả lập (`docs/gates/beta-weekly-2026-W45.md`); đối chiếu PostHog cần key thật |
| 5 | 2 tuần beta: SLO, crash-free ≥ 99,5 %, không lỗi chặn học > 48 giờ; i18n 0 chuỗi cứng; a11y luồng thi | CHƯA (beta) / ĐẠT (i18n, a11y) | Cần beta thật cho SLO/crash-free; lint i18n `no-jsx-literal-text` xanh, axe luồng thi 0 serious/critical (giao diện S11) |
| 6 | GATE-2 report số liệu thật, đề xuất GĐ2, checklist; tag `v0.9.0-beta`; CI xanh | CHƯA | Báo cáo bản kỹ thuật đã có; tag sau khi CI GitHub xanh |

Bổ sung bảo mật: MFA TOTP step-up cho admin (RFC 6238), mật khẩu ≥ 12 ký tự + danh sách mật khẩu lộ, `InternalTokenGuard` hằng thời gian, OpenAPI đủ path params, override GHSA.

**Giao diện Sprint 12.** `/beta` (đổi mã `ALG-XXXX-XXXX`, xử lý 403 `beta_required` toàn cục), onboarding beta 5 câu + hướng dẫn 60 s, thẻ NPS ngày 7/14, góp ý, báo lỗi câu, trung tâm hỗ trợ, `/settings/security` (TOTP, mã khôi phục, step-up toàn cục cho `/admin/*`), `/admin` 8 mục (beta, góp ý, nội dung, hỗ trợ, người dùng, AI, hệ thống/DLQ, audit) có hộp xác nhận thao tác phá huỷ, `/legal/*` từ `/legal/policies` (nhãn bản nháp chờ luật sư), chân trang có tuyên bố không liên kết ETS, KPI sau mini một kỹ năng (S142). axe 0 serious/critical trên trang/hộp thoại S12 và 14 màn admin; không tràn ở 360 px. Giả định A216–A222; vấn đề API S144–S153.

## 2. Đã làm

**Sprint 1.** `iam`: OAuth Google/Apple/Facebook tự triển khai bằng `jose` + JWKS (ADR-0022, không Better Auth), liên kết tài khoản cần mật khẩu/xác nhận (409 `link_required`), OTP email/SMS/Zalo (HMAC trong Redis, 5′, 5 lần sai khoá 30′, 3 yêu cầu/15′), thu hồi phiên tức thời, phát hiện tái sử dụng refresh, consents theo `POLICY_VERSION`, Turnstile, `DELETE /me` + job `iam.purge`, RBAC admin cấp vai trò. `packages/schemas`: đủ 12 dạng câu + `grade()` partial credit + JSON Schema. Web: đăng nhập mã email, nút Google, đồng ý điều khoản, trang Điều khoản/Chính sách. Infra: Dockerfile api/web/cms, Terraform phương án B (ADR-0023 Proposed), deploy-staging, runbooks.

**Sprint 2.** Catalog là nguồn sự thật vòng đời nội dung (ADR-0024): máy trạng thái dùng chung API/CMS, `content_reviews` (ai_check/review1/review2), nguyên tắc 4 mắt, phiên bản chờ duyệt, outbox `content.published/retired`; `/admin/questions*`, `/internal/content/*`; CMS đồng bộ mọi lần lưu, báo trùng khi import; tìm kiếm `SearchProvider` (Meilisearch → fallback PG), `search:reindex`; trang Luyện tập theo Part + từ khoá. Media (ADR-0025): presign + PUT trực tiếp, `media.process` (ffmpeg mp3/webp, waveform 200 điểm, thumbnail 320 px), driver `fs` dev/test, TTS có cache, `/uploads/presign`, migration 0002 (`media_assets.status/metadata`). PoC GATE-1: harness `eval/poc` + `docs/poc/GATE-1-report.md` (mock).

**Sprint 3.** Practice/drill hiện đáp án + giải thích ngay (exam không bao giờ), chẩn đoán theo quy tắc sau nộp (`diagnoseAttempt`), lọc review sai/đánh dấu/Part, lọc lịch sử trạng thái/khoảng ngày, sự kiện phiên mở rộng, tối ưu `saveAnswers` (≈ 2× thông lượng), đề **TOEIC Reading đầy đủ 01** (100 câu tự biên soạn, 19 nhóm đoạn văn, 75 phút) + 3 bộ luyện Part 5/6/7. Giao diện Exam Mode: thanh Part + lưới câu, Part 6–7 đoạn văn | câu hỏi kéo đổi tỉ lệ (mobile xếp dọc, thu gọn đoạn văn), chế độ tập trung, 3 cỡ chữ, cảnh báo 10′/5′/1′ (toast + `aria-live`), nháp IndexedDB (fallback bộ nhớ) đồng bộ khi có mạng, khôi phục câu đang xem; practice phản hồi ngay và khoá câu đã kiểm tra; kết quả có khối chẩn đoán (Part/kỹ năng yếu, gợi ý luyện → trang Luyện tập chọn sẵn); xem lại lọc Tất cả/Sai/Đánh dấu + Part, nút câu sai tiếp theo/trước. Sửa 2 lỗi phát hiện với dữ liệu thật: tiêu đề đề full tràn ngang mobile, màn kết quả hiện "+0 XP".

**Sprint 4.** Đề **TOEIC Listening đầy đủ 01** (100 câu tự biên soạn, 23 hội thoại/bài nói, 6 ảnh SVG tự vẽ, script nhiều giọng us/uk/au/ca) + 4 bộ luyện, đề **L&R 200 câu/120 phút**, 2 đề mini tự sinh; script `seed:media` sinh TTS theo segment + ghép ffmpeg + transcript có mốc thời gian. API: không lộ transcript khi làm bài, `GET /attempts/{id}/media` gia hạn URL, `timed_drill`, nguồn câu luyện (chưa làm → sai gần đây, giữ nhóm), sinh đề mini, `audio_plays`, ảnh SVG nội dung (chặn SVG chủ động), điểm L/R/Tổng + `by_skill`, thống kê câu cập nhật khi nộp. Web: chuỗi phát Exam Mode, player luyện tập, gia hạn URL, transcript Review, kết quả L/R/Tổng. CMS: trường `listen_policy`/`pause_ms`.

**Sprint 5.** AI Gateway mức sản xuất (timeout/retry jitter, circuit breaker, fallback, chi phí theo bảng giá, OTel + Langfuse – ADR-0026), `JobsService` chạy inline khi không có worker (ADR-0027), giải thích AI stream SSE + cache + đánh giá 👍/👎, chẩn đoán AI trên màn kết quả (Pro, 10 credit), metering/quota; CMS sinh câu hỏi bằng AI (draft `source = ai`); bộ eval explain 179 câu. Web: giải thích stream, phân tích AI (Free thấy thẻ khoá + CTA).

**Sprint 6.** Gia sư AI theo ngữ cảnh (threads SSE, ContextBuilder cắt ngân sách token, khoá Exam Mode – ADR-0028, guard trước model), tra từ < 200 ms + từ điển TOEIC Anh–Việt tự biên soạn 1.750 mục, SRS/ghi chú, Web Push. Web: panel gia sư, tra từ khi bôi đen, ghi chú.

**Sprint 7–8.** Thanh toán webhook-first VNPay/MoMo/ZaloPay + mock (ADR-0029), gating `FEATURE_GATES` dùng chung, credit ledger append-only, đối soát; hoá đơn điện tử MISA + mock (ADR-0030), khuyến mãi, referral, thông báo đa kênh. Web: bảng giá, checkout, đơn hàng/hoá đơn, giới thiệu bạn, admin billing.

**Sprint 9.** Chẩn đoán thích ứng, lộ trình đến ngày thi (`@allingo/planner`, ADR-0031/0032), task tự hoàn thành qua `attempt.graded`. Web: onboarding 4 bước, chẩn đoán, lộ trình tuần, Hôm nay.

**Sprint 10.** FSRS-5 + optimizer (ADR-0033), bộ từ TOEIC 600, sổ lỗi, stats/forecast; CMS marketing (pages/posts/redirects, revalidate ký HMAC). Web: ôn thẻ, sổ lỗi, dashboard/thống kê, landing/blog SEO, cookie consent.

**Sprint 11.** Quan sát (redaction PII, trace_id, metrics RED/BullMQ/DB, Sentry không SDK), rate limit + khoá đăng nhập, CSRF theo Origin, migration guard, độ phủ partition, stack quan sát as code + 18 alert có runbook, job bảo mật CI, pentest-1, diễn tập PITR, tối ưu tải (deadlock pool – Critical, N+1) – ADR-0034. Web: CSP nonce, cờ tính năng/kill-switch UI, 429/503, telemetry, i18n theo trang, axe.

**Sprint 12.** Beta gate + mời theo lô + Pro trial, khảo sát onboarding/NPS, góp ý, báo lỗi câu (đồng bộ CMS), ticket hỗ trợ SLA 24 giờ, admin (người dùng, nội dung, AI, hệ thống, DLQ, audit), MFA TOTP step-up, mật khẩu ≥ 12 + danh sách lộ, sự kiện analytics + `pnpm report:beta`, seed `beta-demo` giả lập (ADR-0035), báo cáo GATE-2 bản kỹ thuật. Web: xem mục giao diện Sprint 12 ở bảng nghiệm thu.

**Sửa lỗi quan trọng phát hiện trong phiên.** `QueueService.enqueue` luôn thất bại âm thầm vì jobId chứa `:` (BullMQ ≥ 5) → `jobIdFor()`; Postgres jsonb đổi thứ tự khoá làm so sánh nội dung sai → so sánh chuẩn hoá; `@allingo/db` dist nhúng kiểu cũ → luôn build lại sau khi sửa schema; SSE thiếu header CORS làm trình duyệt chặn explain/gia sư (S6); CMS production thiếu migration Payload (S6); deadlock pool kết nối dưới tải (S11); `POST /submit` 500 khi truyền Date vào SQL thô (S11); `seed:media` không dựng được context và thoát im lặng, `db:migrate` không đọc `.env`, compose dev thiếu bucket hoá đơn (phát hiện khi chạy thử cài máy mới).

## 3. Số liệu kiểm thử (lần chạy cuối, 08/11/2026)

| Bộ | Kết quả |
| --- | --- |
| `pnpm turbo run lint typecheck test` | xanh toàn repo (lint `@allingo/api` chạy lại riêng vì hết RAM khi chạy song song – exit 137, không phải lỗi lint) |
| api (unit + integration Postgres/Redis thật) | 473 |
| web unit | 370 |
| schemas | 275 |
| db | 92 |
| cms | 49 |
| scoring / planner / fsrs / api-client | 32 / 28 / 10 / 8 |
| **Tổng unit + integration** | **1.337** |
| E2E API thật (desktop + mobile, 168 ca) | 147 pass, 21 skip có chủ đích (chỉ mock / chỉ desktop), 0 fail – 38,8 phút |
| E2E mock (lượt cuối giao diện S12) | 149 pass, 19 skip, 0 fail |
| `db:diff` | 105 bảng, 236 index, 4 policy khớp spec |
| `api:diff` | 195/219 operation đã triển khai, 0 lệch hợp đồng |
| `pnpm install --frozen-lockfile` | lockfile khớp |
| Cài máy mới (bản clone sạch) | install → build → migrate → seed core+demo → seed:media → API đăng nhập + 15 đề (A214) |

## 4. Cách chạy

```bash
pnpm i
cp .env.example .env                                   # mặc định AI/thanh toán/giọng nói giả lập
pnpm docker:up                                         # postgres, redis, meilisearch, minio (+ bucket media/recordings/invoices), mailpit
pnpm --filter './packages/*' --filter @allingo/db build
pnpm db:migrate
pnpm db:seed --set core,demo                           # + beta-demo: dữ liệu beta GIẢ LẬP cho report:beta (chặn production)
pnpm --filter @allingo/api seed:media                  # audio Listening + ảnh Part 1 (cần ffmpeg)
pnpm --filter @allingo/cms exec tsx scripts/seed-cms.ts
pnpm dev                                               # web :3000, api :4000 (/docs), cms :3001/admin, worker
pnpm lint && pnpm typecheck && pnpm test && pnpm db:diff && pnpm api:openapi && pnpm api:diff
E2E_REAL_API=1 E2E_CMS_URL=http://localhost:3001 pnpm --filter @allingo/web test:e2e
pnpm report:beta                                       # báo cáo beta tuần (Markdown)
k6 run tests/load/exam-day.js                          # trên staging (5.000 VU / 30 phút)
```

Windows: chạy trong WSL2 (Ubuntu), mã nguồn đặt trong thư mục nhà của Ubuntu. Tài khoản demo mật khẩu `Allingo@2026`: `learner_free@`, `learner_pro@`, `teacher@`, `admin@`, `org_admin@allingo.dev`.

## 5. Việc còn lại

| # | Việc | Khi nào |
| --- | --- | --- |
| T1 | Push GitHub, bật branch protection, CI xanh (gồm `terraform-validate`, ffmpeg trong job integration), tag `v0.9.0-beta` | Ngay |
| T2 | Credential thật: OAuth Google/Apple/Facebook, VNPay/MoMo/ZaloPay sandbox, MISA, khoá AI (Gemini/Claude/OpenAI), Azure Speech, PostHog, Sentry, SMTP/Zalo ZNS/eSMS | Tuần 1–2 trước beta |
| T3 | Staging theo ADR-0023 (Terraform), Payload `migrate`, Meilisearch/MinIO/R2 thật; k6 5.000 VU/30′; SLO 2 tuần | Tuần 1–3 |
| T4 | Nội dung: ≥ 3.000 câu, ≥ 10 đề full, 30 mini, 60 drill (AI nháp + duyệt 2 lớp), rà ngẫu nhiên không sao chép | Tuần 1–6 |
| T5 | Eval AI thật (explain ≥ 4/5, guard recall ≥ 98 %), GATE-1 số liệu thật (Writing/Speaking có điểm giáo viên) | Tuần 2 / trước GĐ2 |
| T6 | Pháp lý: luật sư duyệt điều khoản/riêng tư/hoàn tiền/xử lý giọng nói; kế toán xác nhận huỷ/điều chỉnh hoá đơn khi hoàn tiền (S90) | Tuần 3–4 |
| T7 | Beta kín thật 300 người, 2 tuần; điền lại `GATE-2-report.md` bằng số thật | Tuần 5–6 |
| T8 | Bật RLS 3 bảng billing có `org_id` (S124) trước khi bán B2B | Trước B2B |
| T9 | Hiệu năng: tree-shake `@allingo/schemas` (S141), đo Lighthouse dashboard trên staging | GĐ2 |
| T10 | Outbox retry + dead-letter cho consumer (S26); xếp hạng tìm kiếm (S140) | GĐ2 |
| T11 | Bảng `passage_parts` cho Part 7 đa đoạn (S24); custom view kéo thả test set trong CMS (A26) | v1.2 |
| T12 | Theo dõi GHSA bắc cầu đã override (hạn 30/11/2026, Renovate) | 30/11/2026 |

## 6. Rủi ro & lưu ý

- **Chưa có hạ tầng/credential thật**: Meilisearch, MinIO/R2, Azure Speech, OAuth, cổng thanh toán, MISA, AI thật, Terraform chưa chạy với môi trường thật — adapter đều có test với mock/fake; lần chạy thật đầu tiên có thể lộ lỗi cấu hình.
- **Số liệu beta trong báo cáo là giả lập** (`beta-demo`), chỉ để kiểm công cụ đo; không dùng để ra quyết định GATE-2.
- **Thang điểm 5–495 là ước tính** do Allingo tự xây dựng, không phải bảng ETS — giao diện luôn ghi "ước tính".
- **Đề demo** tự biên soạn (`source = human`), tên riêng hư cấu, tên miền `.example`; trước khi bán cần biên tập viên rà soát.
- **ffmpeg bắt buộc** cho worker và `seed:media`; thiếu ffmpeg thì test media tự skip — CI đã cài.
- **`INTERNAL_API_TOKEN`, `AUTH_SECRET`, `MFA_ENCRYPTION_KEY`, `PAYLOAD_SECRET`**: đặt riêng trên staging/prod (Key Vault), không dùng giá trị dev.
- **Hoá đơn khi hoàn tiền**: đang huỷ hoá đơn; quy định thường yêu cầu điều chỉnh/thay thế — chờ kế toán (S90).
