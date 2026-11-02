# HANDOFF — Sprint 1 → Sprint 8 (02/11/2026)

Bàn giao sau phiên Claude Code chạy lần lượt Sprint 1–8 theo `docs/prompts/ALLINGO-SPRINT-PROMPTS.md`. Đọc cùng `README.md`, `CLAUDE.md`, `docs/ASSUMPTIONS.md` (A1–A39), `docs/SPEC-ISSUES.md` (S1–S29), ADR 0001–0025. Bàn giao Sprint 0 xem lịch sử git của tệp này (`git log -p docs/HANDOFF.md`).

Repo chưa push (theo yêu cầu: làm tiếp trên phiên, push sau). Mọi kiểm tra dưới đây chạy trong phiên cloud: Postgres 16 + pgvector, Valkey/Redis cục bộ, không Docker, không Meilisearch/MinIO/Azure/khoá AI thật (A1, A25).

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

## 2. Đã làm

**Sprint 1.** `iam`: OAuth Google/Apple/Facebook tự triển khai bằng `jose` + JWKS (ADR-0022, không Better Auth), liên kết tài khoản cần mật khẩu/xác nhận (409 `link_required`), OTP email/SMS/Zalo (HMAC trong Redis, 5′, 5 lần sai khoá 30′, 3 yêu cầu/15′), thu hồi phiên tức thời, phát hiện tái sử dụng refresh, consents theo `POLICY_VERSION`, Turnstile, `DELETE /me` + job `iam.purge`, RBAC admin cấp vai trò. `packages/schemas`: đủ 12 dạng câu + `grade()` partial credit + JSON Schema. Web: đăng nhập mã email, nút Google, đồng ý điều khoản, trang Điều khoản/Chính sách. Infra: Dockerfile api/web/cms, Terraform phương án B (ADR-0023 Proposed), deploy-staging, runbooks.

**Sprint 2.** Catalog là nguồn sự thật vòng đời nội dung (ADR-0024): máy trạng thái dùng chung API/CMS, `content_reviews` (ai_check/review1/review2), nguyên tắc 4 mắt, phiên bản chờ duyệt, outbox `content.published/retired`; `/admin/questions*`, `/internal/content/*`; CMS đồng bộ mọi lần lưu, báo trùng khi import; tìm kiếm `SearchProvider` (Meilisearch → fallback PG), `search:reindex`; trang Luyện tập theo Part + từ khoá. Media (ADR-0025): presign + PUT trực tiếp, `media.process` (ffmpeg mp3/webp, waveform 200 điểm, thumbnail 320 px), driver `fs` dev/test, TTS có cache, `/uploads/presign`, migration 0002 (`media_assets.status/metadata`). PoC GATE-1: harness `eval/poc` + `docs/poc/GATE-1-report.md` (mock).

**Sprint 3.** Practice/drill hiện đáp án + giải thích ngay (exam không bao giờ), chẩn đoán theo quy tắc sau nộp (`diagnoseAttempt`), lọc review sai/đánh dấu/Part, lọc lịch sử trạng thái/khoảng ngày, sự kiện phiên mở rộng, tối ưu `saveAnswers` (≈ 2× thông lượng), đề **TOEIC Reading đầy đủ 01** (100 câu tự biên soạn, 19 nhóm đoạn văn, 75 phút) + 3 bộ luyện Part 5/6/7. Giao diện Exam Mode: thanh Part + lưới câu, Part 6–7 đoạn văn | câu hỏi kéo đổi tỉ lệ (mobile xếp dọc, thu gọn đoạn văn), chế độ tập trung, 3 cỡ chữ, cảnh báo 10′/5′/1′ (toast + `aria-live`), nháp IndexedDB (fallback bộ nhớ) đồng bộ khi có mạng, khôi phục câu đang xem; practice phản hồi ngay và khoá câu đã kiểm tra; kết quả có khối chẩn đoán (Part/kỹ năng yếu, gợi ý luyện → trang Luyện tập chọn sẵn); xem lại lọc Tất cả/Sai/Đánh dấu + Part, nút câu sai tiếp theo/trước. Sửa 2 lỗi phát hiện với dữ liệu thật: tiêu đề đề full tràn ngang mobile, màn kết quả hiện "+0 XP".

**Sprint 4.** Đề **TOEIC Listening đầy đủ 01** (100 câu tự biên soạn, 23 hội thoại/bài nói, 6 ảnh SVG tự vẽ, script nhiều giọng us/uk/au/ca) + 4 bộ luyện, đề **L&R 200 câu/120 phút**, 2 đề mini tự sinh; script `seed:media` sinh TTS theo segment + ghép ffmpeg + transcript có mốc thời gian. API: không lộ transcript khi làm bài, `GET /attempts/{id}/media` gia hạn URL, `timed_drill`, nguồn câu luyện (chưa làm → sai gần đây, giữ nhóm), sinh đề mini, `audio_plays`, ảnh SVG nội dung (chặn SVG chủ động), điểm L/R/Tổng + `by_skill`, thống kê câu cập nhật khi nộp. Web: chuỗi phát Exam Mode, player luyện tập, gia hạn URL, transcript Review, kết quả L/R/Tổng. CMS: trường `listen_policy`/`pause_ms`.

**Sửa lỗi quan trọng phát hiện trong phiên.** `QueueService.enqueue` luôn thất bại âm thầm vì jobId chứa `:` (BullMQ ≥ 5) → `jobIdFor()`; Postgres jsonb đổi thứ tự khoá làm so sánh nội dung sai → so sánh chuẩn hoá; `@allingo/db` dist nhúng kiểu cũ → luôn build lại sau khi sửa schema.

## 3. Số liệu kiểm thử (lần chạy cuối)

| Gói | Test | Kết quả |
| --- | --- | --- |
| `packages/schemas` | 251 | xanh |
| `packages/scoring` | 21 | xanh |
| `db` | 57 (cấu trúc đề Reading 01, Listening 01, đề mini tự sinh, integration DB) | xanh |
| `apps/api` | 130 (unit + integration trên PG/Redis cục bộ) | xanh |
| `apps/cms` | 32 | xanh |
| `packages/api-client`, `packages/fsrs` | 8, 4 | xanh |
| `apps/web` | unit 70; E2E 28 (mock) + 28 (API thật) | xanh |

`pnpm api:diff`: 55/116 operation đã triển khai, 0 lệch. `pnpm db:diff`: 97 bảng, 189 index, 4 policy khớp DDL tham chiếu (v1.1).

## 4. Cách chạy

```bash
pnpm i && pnpm docker:up && pnpm db:migrate && pnpm db:seed --set core,demo
pnpm dev                                  # web :3000, api :4000, cms :3001, worker
pnpm --filter @allingo/api search:reindex # sau khi bật Meilisearch
STORAGE_DRIVER=fs pnpm --filter @allingo/api dev   # thử upload khi không có MinIO
pnpm lint && pnpm typecheck && pnpm test && pnpm db:diff && pnpm api:openapi && pnpm api:diff
E2E_REAL_API=1 E2E_CMS_URL=http://localhost:3001 pnpm --filter @allingo/web test:e2e
node tests/load/attempt-flow.autocannon.mjs   # đo cục bộ; k6 run tests/load/attempt-flow.js trên staging
```

Đề demo: `toeic-mini-part5-01`, `toeic-mini-part2-01`, `toeic-mini-lr-01/02` (tự sinh), `toeic-reading-full-01`, `toeic-listening-full-01`, `toeic-lr-full-01`, 7 bộ luyện `toeic-{reading,listening}-01-drill-part1…7`. Sau `db:seed --set demo` chạy `pnpm --filter @allingo/api seed:media` để sinh audio/ảnh. Tài khoản demo mật khẩu `Allingo@2026`: `learner_free@`, `learner_pro@`, `teacher@`, `admin@`, `org_admin@allingo.dev`.

## 5. Việc còn lại

| # | Việc | Sprint |
| --- | --- | --- |
| T1 | Push GitHub `phungduyhoc/allingo`, bật branch protection, xác nhận CI (gồm `terraform-validate`, ffmpeg trong job integration) | Khi anh sẵn sàng |
| T2 | Thử Google/Apple/Facebook thật với client id của anh; Zalo ZNS/eSMS thật | S1 dư |
| T3 | GATE-1 số liệu thật: dataset Writing/Speaking có điểm giáo viên + khoá AI/Azure → `pnpm --filter @allingo/api poc:w|poc:p` | Trước GATE-1 |
| T4 | Meilisearch + MinIO thật trên máy dev (`pnpm docker:up`), chạy lại test search/media với driver thật | S4 |
| T5 | k6 1.000 VU trên staging; tối ưu index nếu p95 > 150 ms | Trước GATE-2 |
| T6 | Outbox: retry + dead-letter cho consumer (S26) | S5 |
| T7 | Bảng `passage_parts` cho Part 7 đa đoạn (S24); custom view kéo thả test set trong CMS (A26) | v1.2 |
| T8 | Job xoá ghi âm hết hạn + lifecycle bucket; xử lý EXIF orientation ảnh | S6/S8 |
| T9 | Lighthouse mobile Performance ≥ 85: giảm JS client (messages next-intl theo trang, dashboard RSC, tải lười recharts/tutor) | S11 |

## 6. Rủi ro & lưu ý

- **Không có hạ tầng thật trong phiên**: Meilisearch, MinIO/R2, Azure Speech, OAuth thật, Terraform chưa chạy — mọi adapter có test với mock/fake; lần chạy thật đầu tiên có thể lộ lỗi cấu hình.
- **Thang điểm 5–495 là ước tính** do Allingo tự xây dựng, không phải bảng ETS — giao diện phải luôn ghi "ước tính".
- **Đề demo** tự biên soạn (`source = human`), tên riêng hư cấu, tên miền `.example`; trước khi bán cần biên tập viên rà soát.
- **ffmpeg bắt buộc** cho worker (image đã cài); thiếu ffmpeg thì test media tự skip — CI đã cài để không bỏ sót.
- **`INTERNAL_API_TOKEN`** dùng chung API ↔ CMS: đổi trên staging/prod (Key Vault).
