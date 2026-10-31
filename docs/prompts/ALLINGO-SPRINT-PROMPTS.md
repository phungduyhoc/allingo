# Allingo — Bộ prompt sprint cho Claude Code (S1–S12, GĐ0–GĐ1 → GATE-2)

> **Cách dùng.** Mỗi sprint = một (hoặc vài) phiên Claude Code mới trong repo `allingo` đã hoàn thành Sprint 0 theo `ALLINGO-MASTER-PROMPT.md`. Với mỗi sprint: (1) mở phiên mới ở gốc repo, bật plan mode; (2) dán **Khung chung** (mục A) rồi dán **prompt của sprint** (mục C); (3) duyệt kế hoạch Claude Code đưa ra; (4) nghiệm thu theo checklist cuối sprint; (5) yêu cầu cập nhật `docs/HANDOFF.md` trước khi đóng phiên. Không chạy hai sprint trong một phiên; không bỏ qua sprint trước khi sprint sau chưa nghiệm thu, trừ khi mục "Phụ thuộc" cho phép.
>
> Thứ tự bám theo Thiết kế kỹ thuật v1.0 mục 12 ("Thứ tự xây dựng trong GĐ0–GĐ1, sprint 2 tuần"): S1–S2 nền tảng → S3–S4 test-engine TOEIC → S5–S6 AI Gateway → S7–S8 billing → S9–S10 learning v1 + marketing → S11–S12 ổn định & beta kín → GATE-2. Sprint 0 (master prompt) đã làm trước một phần của S1–S2 để có vòng học end-to-end sớm; S1–S2 ở đây hoàn thiện phần còn lại.

---

## A. Khung chung — dán trước MỌI prompt sprint

```
Bạn là Tech Lead của Allingo, tiếp tục phát triển repo này theo sprint. Trước khi làm bất cứ gì:

1. Đọc `CLAUDE.md` (quy tắc bắt buộc), `docs/HANDOFF.md` (trạng thái hiện tại), `docs/ASSUMPTIONS.md`, `docs/SPEC-ISSUES.md`, `docs/VERSIONS.md`. Chạy `pnpm i && pnpm docker:up && pnpm db:migrate && pnpm db:seed --set core,demo && pnpm lint && pnpm typecheck && pnpm test` để xác nhận repo xanh; nếu đỏ, sửa trước và ghi vào HANDOFF (đây là việc đầu tiên, không phải của sprint này nhưng không được bỏ qua).
2. Đọc các phần của `docs/spec/*` mà prompt sprint chỉ định (bảng DDL, đường dẫn OpenAPI, prompt code). Không đoán; nếu spec thiếu, ghi `docs/SPEC-ISSUES.md` và chọn theo thứ tự ưu tiên DDL > OpenAPI > PRD.
3. Ở plan mode: trả lời tôi bằng (a) 5–8 dòng tóm tắt mục tiêu sprint theo cách bạn hiểu, (b) giả định, (c) task list 15–30 việc theo thứ tự phụ thuộc, (d) rủi ro. Chờ tôi xác nhận; nếu tôi không trả lời, tiếp tục với giả định đã nêu.
4. Khi làm: mỗi nhóm việc hoàn chỉnh → chạy lint/typecheck/test → commit Conventional Commits. Viết test cùng lúc với mã. Endpoint mới phải khớp `docs/spec/allingo-openapi.yaml` (`pnpm api:diff`); bảng/cột mới phải khớp DDL (`pnpm db:diff`); không đổi hợp đồng API đã phát hành mà không hỏi.
5. Mọi lời gọi AI qua `AiGateway`; mọi thao tác credit qua `CreditService` trong transaction; mọi endpoint tiêu quota kiểm tra `EntitlementService` ở server; nội dung người học trong `<user_input>`; không PII trong log/prompt; không nội dung thi sao chép.
6. Kết thúc sprint: cập nhật `docs/HANDOFF.md` (đã làm, cách chạy/demo, đo đạc, việc dở, đề xuất sprint sau), `docs/adr/` nếu có quyết định kiến trúc, `README.md` nếu đổi cách chạy; báo cáo cho tôi theo đúng mục "Tiêu chí nghiệm thu" của sprint: từng tiêu chí ĐẠT/CHƯA và cách tôi tự kiểm tra.
7. Không mở rộng phạm vi ngoài mục "Ngoài phạm vi" của sprint dù thấy dễ; ghi vào đề xuất sprint sau.
```

---

## B. Bản đồ sprint

| Sprint | Tuần | Chủ đề | Module chính | Đầu ra kiểm chứng được |
| --- | --- | --- | --- | --- |
| S1 | 1–2 | IAM đầy đủ, 12 dạng câu, IaC dev/stg | iam, schemas, infra | OAuth/OTP thật, guest merge, stg deploy |
| S2 | 3–4 | Catalog & CMS workflow, media, search, PoC AI chấm | catalog, cms, ai-gateway, speech | Quy trình duyệt 2 lớp, báo cáo PoC → **GATE-1** |
| S3 | 5–6 | Test Engine TOEIC Reading Part 5–7, Exam Mode | test-engine | Đề full Reading 100 câu/75′ chạy ổn định |
| S4 | 7–8 | Listening Part 1–4, practice/drill, scoring | test-engine, scoring | Đề full L&R 200 câu, điểm quy đổi |
| S5 | 9–10 | AI Gateway production, explain, diagnose, metering | ai-gateway, billing | explain thật ≥ 4/5, quota Free, Langfuse |
| S6 | 11–12 | Tutor chat SSE, tra từ, ghi chú, PWA | ai-gateway, catalog, web | Chat có ngữ cảnh, Exam Mode khoá, PWA cài được |
| S7 | 13–14 | Billing: 3 cổng thanh toán, entitlement gating | billing | Mua Pro sandbox end-to-end, ledger khớp |
| S8 | 15–16 | Hoá đơn điện tử, khuyến mãi, referral, thông báo | billing, growth, ops | Hoá đơn sandbox, referral thưởng credit |
| S9 | 17–18 | Diagnostic, lộ trình tuần, streak/XP/badge | learning | Plan sinh tự động, check-in, điều chỉnh |
| S10 | 19–20 | FSRS từ vựng, error log, stats, marketing & blog | learning, fsrs, web, cms | Ôn tập đúng lịch, dashboard, SEO |
| S11 | 21–22 | Observability, load test 5.000 CCU, hardening | ops, infra | SLO dashboard, k6 đạt ngưỡng, pentest 1 |
| S12 | 23–24 | Beta kín 300 người, ops & admin, GATE-2 | admin, growth, analytics | Báo cáo GATE-2 → **GATE-2** |

---

## C. Prompt từng sprint

### S1 — IAM đầy đủ, 12 dạng câu hỏi, IaC dev/stg

```
# SPRINT 1 — IAM đầy đủ · packages/schemas 12 dạng câu · IaC dev/stg

## Mục tiêu
Đưa module `iam` lên mức sản xuất (đăng nhập xã hội thật, OTP thật, ghép tài khoản khách, RBAC, phiên, đồng ý, xoá dữ liệu), hoàn thiện `packages/schemas` cho đủ 12 dạng câu hỏi, và có môi trường `dev` + `staging` triển khai tự động bằng Terraform + GitHub Actions để từ S2 mọi sprint đều demo được trên staging.

## Phạm vi — TRONG
1. iam
   - Better Auth: Google, Apple, Facebook thật (client id/secret từ env; thiếu env → provider tắt, UI ẩn nút); liên kết nhiều provider vào một `iam.users` qua `iam.auth_identities`; tài khoản email đã tồn tại + đăng nhập Google cùng email → yêu cầu xác nhận liên kết (không auto-merge).
   - OTP: `POST /auth/otp/request` + `POST /auth/otp/verify` cho email (SMTP → Mailpit ở dev) và SMS qua interface `SmsProvider` (adapter `ConsoleSmsProvider` dev, `EsmsProvider` stub có TODO); mã 6 số, hiệu lực 5 phút, 5 lần sai khoá 30 phút, giới hạn 3 yêu cầu/15 phút/định danh; lưu băm.
   - Guest merge: khi khách đăng ký/đăng nhập, chuyển toàn bộ `learn.enrollments`, `attempts`, `attempt_answers`, `xp_events`, `streaks`, `srs_cards`, `notes` sang user mới trong một transaction; xung đột enrollment cùng program → giữ bản có `updated_at` mới hơn và cộng dồn XP; ghi `ops.audit_logs` action `guest.merged`.
   - RBAC: roles `learner`, `teacher`, `editor`, `admin`, `org_admin` từ seed; decorator `@Roles()` + guard; `iam.user_roles`; admin cấp vai trò qua `admin` (endpoint tạm trong admin module nếu OpenAPI chưa có → ghi SPEC-ISSUES, không thêm vào YAML).
   - Phiên: `GET /me/sessions`, `DELETE /me/sessions/{sessionId}`; refresh xoay vòng, phát hiện tái sử dụng refresh token → thu hồi toàn bộ phiên của user.
   - Đồng ý: `GET/POST /me/consents` với `iam.consent_type` (terms, privacy, voice_processing, marketing, minor_guardian), có phiên bản văn bản; đăng ký bắt buộc terms+privacy.
   - Xoá tài khoản: `DELETE /me` tạo `iam.deletion_requests`; job `iam.purge` chạy sau 72 giờ: ẩn danh hoá `users`, xoá `auth_identities/sessions`, xoá recordings S3, giữ ledger billing (pháp lý) với user_id ẩn danh; email xác nhận.
   - Cloudflare Turnstile verify ở register/login/otp (bỏ qua khi `TURNSTILE_SECRET` trống ở dev).
   - Sự kiện outbox: `user.registered`, `user.merged`, `user.deleted`.
2. packages/schemas: Zod + `grade()` cho đủ 12 dạng trong `catalog.question_types`: mcq_single, mcq_multi, fill_blank (nhiều đáp án chấp nhận, không phân biệt hoa thường, chuẩn hoá khoảng trắng), matching, drag_drop, map_label, tfng, ordering, dictation (so khớp theo token, cho phép lỗi chính tả ≤ 1 ký tự tuỳ cấu hình), essay/speaking/handwriting (không auto-grade, chỉ validate input); JSON Schema xuất ra `schemas/question/*.json` để `catalog.question_types.content_schema` trỏ tới; fixture 3 câu mẫu mỗi dạng.
3. infra
   - Terraform `infra/terraform/modules/{network,postgres,redis,storage,search,compute,cdn-waf,secrets,observability,dns}` và `envs/{dev,staging}`; phương án hạ tầng theo `docs/adr/00xx-infra-option.md` (mặc định phương án B – Azure Southeast Asia Container Apps nếu ADR chưa chốt; ghi ASSUMPTIONS). Nếu không có tài khoản cloud trong phiên này: viết đầy đủ module + `terraform validate` + `plan` với backend local và provider mock; ghi rõ "chưa apply".
   - GitHub Actions: `deploy-staging.yml` build image `apps/api`, `apps/web`, `apps/cms` (multi-stage Dockerfile, non-root, healthcheck), đẩy GHCR, migrate DB rồi deploy; `preview.yml` cho PR (web preview + api ephemeral hoặc chỉ web nếu chi phí cao, ghi ADR).
   - Secrets: `.env.example` đầy đủ, `docs/runbooks/secrets.md`.

## Phạm vi — NGOÀI
Zalo login (đặt enum, không làm), SSO B2B, 2FA TOTP, Clerk (đã chốt Better Auth), môi trường production.

## Đầu vào
DDL: `iam.*`, `ops.audit_logs`, `ops.outbox`. OpenAPI: nhóm Auth, Me (`/auth/*`, `/me`, `/me/sessions*`, `/me/consents`, `/me/enrollments*`). PRD: FR-IAM-*. Thiết kế kỹ thuật mục 8 (Xác thực & phiên, Bảo vệ dữ liệu, Tuân thủ), mục 9 (Hạ tầng, CI/CD).

## Các bước
1. Rà `iam` hiện có từ Sprint 0, liệt kê khoảng cách so với OpenAPI → task list.
2. Social login + liên kết provider → test integration với provider giả lập (mock OAuth server trong Testcontainers hoặc `msw`).
3. OTP + rate limit (Redis) + khoá → test giới hạn.
4. Guest merge transaction → test tính toàn vẹn (đếm bản ghi trước/sau, không mất attempt).
5. Sessions/refresh reuse detection → test.
6. Consents, deletion request + purge job → test job chạy với Testcontainers + MinIO (hoặc S3 mock).
7. `packages/schemas` 12 dạng + grade + fixtures → unit test 100% nhánh của `grade()`.
8. Terraform modules + validate; workflows; Dockerfiles; chạy thử build image local.
9. Cập nhật OpenAPI generation, `pnpm api:diff`, HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Đăng nhập Google thật trên dev (với client id của tôi) → tạo user, enrollment khách được ghép, lần 2 đăng nhập không tạo trùng.
- [ ] OTP email tới Mailpit, sai 5 lần → khoá 30 phút (test và thử tay).
- [ ] `DELETE /me` → sau khi chỉnh `PURGE_DELAY` = 1 phút ở dev, dữ liệu cá nhân bị ẩn danh, ledger còn nguyên.
- [ ] Refresh token dùng lại → toàn bộ phiên bị thu hồi, có audit log.
- [ ] `pnpm test` có ≥ 36 test cho `packages/schemas` (3/dạng) và grade đúng fixture.
- [ ] `terraform validate` xanh cho `envs/dev` và `envs/staging`; workflow `deploy-staging` chạy tới bước build image thành công trên GitHub (apply có thể bỏ qua nếu chưa có cloud, ghi rõ).
- [ ] `pnpm api:diff` xanh cho toàn bộ nhóm Auth/Me; `pnpm db:diff` xanh.

## Kiểm thử bắt buộc
Unit: OTP generator/validator, merge rules, 12 grade(). Integration: register→merge, oauth link, refresh reuse, purge job, RLS không bị ảnh hưởng. E2E: signup email → dashboard.
```

### S2 — Catalog & CMS workflow duyệt, media pipeline, tìm kiếm, PoC AI chấm → GATE-1

```
# SPRINT 2 — Catalog hoàn chỉnh · CMS workflow 2 lớp · Media & Search · PoC chấm Writing & Pronunciation

## Mục tiêu
Nội dung đi được từ soạn thảo → AI kiểm tra → duyệt 2 lớp → phát hành có phiên bản → hiển thị cho người học, kèm media (audio/ảnh) và tìm kiếm. Đồng thời hoàn thành hai PoC kỹ thuật của GĐ0 để ra quyết định GATE-1: chấm Writing IELTS bằng LLM trên 200 bài có band giáo viên, và Pronunciation Assessment Azure trên 100 mẫu ghi âm.

## Phạm vi — TRONG
1. catalog + CMS
   - Chốt ADR cách Payload ghi vào `catalog.*` (từ Sprint 0): hoàn thiện theo ADR; bỏ bản sao tạm nếu có.
   - Workflow `draft → ai_checked → review1 → review2 → published → retired/rejected` theo `catalog.content_status`; mỗi chuyển trạng thái ghi `catalog.content_reviews` (stage, decision, reviewer, note); quyền: editor tạo/sửa draft, teacher duyệt review1, admin/teacher-senior duyệt review2, chỉ `published` mới xuất hiện ở API người học.
   - Phiên bản: sửa câu đã `published` → tạo `question_versions` mới, bản cũ giữ cho attempt cũ; API trả `question_version_id`.
   - Nút "AI kiểm tra" gọi `check_question` thật (nếu có key) qua AiGateway, kết quả lưu vào bản ghi review stage `ai_check`; verdict `fail` chặn gửi review1.
   - Nhập hàng loạt CSV/JSON theo mẫu `docs/content/import-template.md`; báo lỗi theo dòng; trùng lặp phát hiện bằng `pg_trgm` similarity ≥ 0,85 trên stem (embedding để S5).
   - Test set builder: tạo `test_sets` kiểu full/mini/part_drill, kéo thả câu/nhóm câu theo passage, kiểm tra đủ cấu trúc (TOEIC L&R: Part 1–7 đúng số câu), xuất bản.
   - Passages (reading_passage, audio_script, dialogue) và câu hỏi nhóm theo passage; media_assets gắn passage/câu.
   - Admin endpoints trong OpenAPI: `GET/POST /admin/questions`, `GET /admin/questions/{id}/versions`, `POST /admin/content/{entityType}/{entityId}/review`.
2. media pipeline (`shared/storage` + queue `media`)
   - `POST /uploads/presign` (ảnh/audio ≤ 20 MB, kiểu MIME cho phép); job `media.process`: audio → chuẩn hoá mp3 48 kbps mono + đo duration + waveform JSON (ffmpeg trong image worker); ảnh → webp + thumbnail; lưu `catalog.media_assets` (status processing → ready → failed).
   - TTS cho audio_script khi soạn (Azure TTS qua `SpeechProvider`; mock ở dev sinh file im lặng có duration) → `ai.tts_cache`.
3. search: outbox relay → Meilisearch index `questions`, `lessons`, `vocab` (chỉ bản published, không đáp án); `GET /practice/questions` lọc theo section/topic/difficulty dùng DB, tìm theo từ khoá dùng Meilisearch.
4. PoC (thư mục `eval/poc/`, không ảnh hưởng runtime)
   - PoC-W: 200 bài IELTS Writing (Task 1/Task 2, tự biên soạn hoặc bài của người học nội bộ đã ẩn danh, band do 2 giáo viên chấm) → chạy `grade_writing_ielts` qua Promptfoo với 3 provider → báo cáo MAE, within_0_5, Pearson, std lặp lại (40 bài × 3), chi phí/bài, độ trễ p50/p95. Nếu chưa đủ 200 bài, chạy với số bài có và ghi rõ.
   - PoC-P: 100 ghi âm (tối thiểu 10 người, tiếng Anh, mức A2–C1) qua Azure Pronunciation Assessment → phân bố accuracy/fluency/prosody, tương quan với band Pronunciation giáo viên (nếu có), ánh xạ PA → band theo `scoring_rules.pa_to_band`, độ trễ, chi phí/phút.
   - Báo cáo `docs/poc/GATE-1-report.md`: kết luận đi/không đi cho từng PoC so ngưỡng trong `allingo-prompts.yaml` (eval.thresholds), đề xuất model mặc định cho `ai.model_routes`.

## Phạm vi — NGOÀI
Sinh đề bằng AI (`generate_questions`) — S5; dedup embedding — S5; video/YouTube — GĐ2; nội dung JLPT/HSK — GĐ3.

## Đầu vào
DDL: `catalog.*`, `ai.tts_cache`, `ops.outbox`. OpenAPI: nhóm Catalog, Admin (questions/content review), `/uploads/presign`, `/practice/questions`. Prompt: `check_question`, `grade_writing_ielts`; `allingo-promptfoo.yaml`; `scoring_rules`. PRD: FR-CMS-*, FR-CAT-*. Thiết kế kỹ thuật mục 6.3 (sinh đề & duyệt), 7 (AI Gateway), 11 (seed & fixture).

## Các bước
1. ADR Payload↔catalog; migrate dữ liệu demo nếu đổi cách lưu.
2. Workflow + quyền + content_reviews → test chuyển trạng thái hợp lệ/không hợp lệ.
3. Versioning → test attempt cũ vẫn trỏ bản cũ.
4. Import + dedup trgm → test.
5. Media pipeline + TTS mock → test job với ffmpeg trong Testcontainers image.
6. Outbox relay → Meilisearch (Testcontainers) → test index chỉ bản published, không chứa đáp án.
7. Test set builder (UI Payload custom view) → validate cấu trúc TOEIC.
8. PoC-W, PoC-P scripts + báo cáo; `pnpm eval:build && pnpm eval:run` chạy được.
9. HANDOFF + đề xuất GATE-1.

## Tiêu chí nghiệm thu
- [ ] Editor tạo câu Part 5 → AI kiểm tra (pass) → teacher review1 approve → admin review2 approve → câu xuất hiện trong `GET /practice/questions`; reject ở review1 quay về draft với ghi chú.
- [ ] Sửa câu đã published tạo version 2; attempt làm trước đó review vẫn hiển thị version 1.
- [ ] Import 50 câu CSV có 2 câu trùng → báo đúng 2 dòng trùng, 48 câu nhập.
- [ ] Upload audio 5 MB → `media_assets.status = ready`, có duration và waveform; URL ký 10 phút.
- [ ] Tìm "invoice" trong Meilisearch trả câu published có từ đó; câu draft không xuất hiện; payload index không chứa `answer_key`.
- [ ] `docs/poc/GATE-1-report.md` có số liệu thật từ Promptfoo/Azure, kết luận rõ, đề xuất `model_routes`.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; test ≥ 25 ca mới.

## Kiểm thử bắt buộc
Unit: state machine workflow, dedup, validate cấu trúc test set. Integration: review flow với RBAC, versioning, media job, outbox→search. E2E: CMS tạo câu → publish → web hiển thị.
```

### S3 — Test Engine TOEIC Reading Part 5–7 & Exam Mode hoàn chỉnh

```
# SPRINT 3 — Test Engine TOEIC Reading (Part 5–7) · Exam Mode đầy đủ · Review nâng cao

## Mục tiêu
Người học làm trọn một đề TOEIC Reading 100 câu/75 phút đúng trải nghiệm thi (một trang, điều hướng theo Part, đánh dấu câu, đồng hồ do server kiểm soát, tiếp tục sau mất mạng), nộp và xem lại từng câu với bộ lọc; nền tảng attempt chịu được 1.000 người làm đồng thời trên máy dev.

## Phạm vi — TRONG
1. Mô hình attempt
   - `POST /attempts` (Idempotency-Key) tạo từ `test_set_id` hoặc `section_ids` + `mode` (`exam|practice|timed_drill`); snapshot danh sách `question_version_id` và thứ tự vào `attempts.question_order`; thời gian cho phép theo test set; `expires_at` do server tính.
   - `PUT /attempts/{id}/answers`: lô ≤ 100, idempotent, từ chối sau `expires_at` + 30 s ân hạn; `draft_state` lưu câu hiện tại, đánh dấu, thời gian còn lại ở client để phục hồi.
   - `POST /attempts/{id}/events`: `focus_lost`, `tab_hidden`, `resume`, `part_switch` → ghi vào `attempts.events` (JSONB, tối đa 500) phục vụ phân tích và chống gian lận nhẹ.
   - Auto-submit: job `attempt.expire` quét attempts quá hạn mỗi phút và nộp với câu chưa trả lời = sai; client cũng gọi submit khi hết giờ.
   - `POST /attempts/{id}/submit`: chấm bằng `packages/schemas.grade()`, `score_breakdown` theo Part/skill/subskill/topic, thời gian mỗi câu từ events, `learn.attempt_answers.is_correct/time_spent_ms`, outbox `attempt.graded`, cập nhật streak/XP (hook từ `learning`).
   - `GET /attempts/{id}/review`: từng câu với đáp án đúng, lựa chọn của người học, thời gian, cờ đánh dấu, thống kê "x% người làm đúng" (tính từ `attempt_answers`, cache Redis 1 giờ), lọc sai/đánh dấu/theo Part; `GET /me/attempts` cursor + lọc program/mode/khoảng ngày.
   - `GET /attempts/{id}/diagnosis`: trả cấu trúc `AttemptDiagnosis` tính bằng quy tắc (không AI) — điểm yếu theo subskill/topic, câu sai do timeout; AI `diagnose_rl` bổ sung ở S5.
2. Giao diện Exam Mode (`apps/web`)
   - Màn hình một trang: thanh Part, lưới số câu (trạng thái trả lời/đánh dấu), passage bên trái – câu hỏi bên phải cho Part 6–7 (resize), phím tắt, chế độ tập trung (ẩn thanh điều hướng), font/zoom.
   - Đồng hồ tính từ `expires_at` server, hiển thị cảnh báo 10′/5′/1′; mất mạng → banner "Đang lưu lại…", hàng đợi ghi local (IndexedDB) đồng bộ khi có mạng; tải lại trang khôi phục đúng vị trí.
   - Practice mode: hiện đáp án ngay từng câu, không đồng hồ, giải thích (S5).
   - Màn kết quả: điểm thô, ước tính thang 5–495 (từ `packages/scoring` bảng quy đổi tự xây dựng, ghi rõ ước tính), biểu đồ theo Part, nút Review; Review có bộ lọc và điều hướng theo lỗi.
3. Nội dung demo: 1 đề Reading full 100 câu tự biên soạn (`source=human`, qua workflow S2), 3 part drill.

## Phạm vi — NGOÀI
Listening & audio (S4), giải thích AI (S5), tra từ/ghi chú (S6), IELTS, CAT.

## Đầu vào
DDL: `learn.attempts`, `learn.attempt_answers` (partition), `catalog.test_sets/test_set_items/question_versions/passages`. OpenAPI: nhóm Attempts đầy đủ, `/me/attempts`, `/practice/questions`. PRD: FR-TE-*. Thiết kế kỹ thuật mục 6, 10 (hiệu năng, ngưỡng mở rộng).

## Các bước
1. Hoàn thiện service attempt + state machine (`in_progress → submitted → graded`, `abandoned`), partition tháng tự tạo trước 1 tháng (job `ops.partition.ensure`).
2. Answers batch + events + expire job → test idempotency, hết giờ, ân hạn.
3. Submit + breakdown + thống kê cộng đồng → test với fixture 100 câu.
4. Review + filters + cursor → test.
5. UI Exam Mode + offline queue → Playwright: tắt mạng giữa chừng, tải lại, nộp.
6. Hiệu năng: k6 script `tests/load/attempt-flow.js` 1.000 VU trong 5 phút trên máy dev: p95 `PUT /answers` < 150 ms, lỗi < 0,1 %; ghi kết quả HANDOFF; tối ưu index nếu cần (ghi migration).
7. Đề demo 100 câu qua CMS; HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Làm đề 100 câu trong Exam Mode, tắt wifi 2 phút giữa chừng rồi bật, tải lại trang: không mất câu trả lời, đồng hồ đúng.
- [ ] Hết giờ → tự nộp; nộp hai lần trả cùng kết quả; `PUT /answers` sau hạn + 31 s bị từ chối 409.
- [ ] Kết quả có breakdown Part 5/6/7, ước tính thang điểm, review lọc "câu sai" đúng.
- [ ] k6 1.000 VU đạt ngưỡng trên; không deadlock, không partition thiếu.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; Playwright luồng thi chạy trong CI.

## Kiểm thử bắt buộc
Unit: state machine, breakdown, quy đổi điểm. Integration: idempotency, expire job, review stats cache. E2E: luồng thi có mất mạng. Load: k6.
```

### S4 — Listening Part 1–4, practice & drill, quy đổi điểm L&R

```
# SPRINT 4 — TOEIC Listening Part 1–4 · Audio player thi thật · Drill/Practice · Điểm quy đổi L&R · Seed đề mini/full

## Mục tiêu
Hoàn thiện trải nghiệm TOEIC Listening & Reading trọn vẹn 200 câu/120 phút với audio phát đúng quy tắc thi (một lần, không tua trong Exam Mode; tự do trong Practice), có transcript sau khi nộp, chế độ luyện theo Part/thời gian, và điểm quy đổi hai kỹ năng.

## Phạm vi — TRONG
1. Listening
   - Dạng câu `mcq_single` với media audio theo câu (Part 1–2) hoặc theo nhóm/passage audio_script (Part 3–4); ảnh cho Part 1; `question_versions.content.listen_policy` (`once|free`).
   - Audio player: preload theo Part, phát liên tục toàn bộ Listening (~45′) trong Exam Mode với thời gian trả lời cố định giữa các câu theo content (`pause_ms`), không tua/không tạm dừng; Practice: tua, tốc độ 0,75–1,25, lặp câu; HLS/mp3 từ S3 qua URL ký (gia hạn ngầm trước khi hết hạn).
   - Transcript hiện trong Review (ẩn trong khi thi); highlight câu transcript khi phát lại ở Review (dùng `video_sentences`-style timestamps nếu có, không bắt buộc).
   - Sự kiện `audio_started/ended/stalled` vào `attempts.events`; cảnh báo nếu trình duyệt chặn autoplay (yêu cầu bấm "Bắt đầu nghe").
2. Practice & drill
   - `timed_drill`: n câu theo section/subskill/topic, mỗi câu giới hạn giây; `part_drill`: theo Part không giới hạn giờ; nguồn câu từ `GET /practice/questions` ưu tiên câu chưa làm, rồi câu sai gần đây (luật đơn giản, FSRS cho error ở S10).
   - Mini test generator: tạo `test_sets.kind = mini` ngẫu nhiên hợp lệ cấu trúc (ví dụ 10/10/10/10 Listening + 10/8/12 Reading) từ ngân hàng published, lưu để lặp lại được (`seed`).
3. `packages/scoring`
   - Bảng quy đổi raw → scaled riêng cho Listening/Reading (tự xây dựng, tuyến tính từng đoạn, có ghi chú "ước tính, không phải bảng chính thức"), tổng 10–990; ước tính khoảng tin cậy ±25; test với bảng mẫu.
   - Thống kê theo subskill/topic cho cả hai kỹ năng; thời gian trung bình mỗi câu so cộng đồng.
4. Seed: 1 đề L&R full 200 câu (audio TTS mock/thật qua CMS), 2 đề mini, 7 part drill; cập nhật `pnpm db:seed --set demo`.

## Phạm vi — NGOÀI
Shadowing/dictation UI (GĐ2), IELTS Listening, giải thích AI (S5).

## Đầu vào
DDL: `catalog.media_assets/passages`, `learn.attempts/attempt_answers`. OpenAPI: Attempts, `/practice/questions`, `/programs/{program}/test-sets`, `/test-sets/{id}`. PRD: FR-TE-* (Listening), FR-SC-*. Thiết kế kỹ thuật mục 6, 10.

## Các bước
1. Mở rộng content schema listening (`listen_policy`, `pause_ms`, media refs) trong `packages/schemas` + JSON Schema; cập nhật form CMS.
2. Player Exam Mode (web audio, preload, chuỗi phát) + Practice player → Playwright kiểm tra không tua được ở Exam Mode.
3. URL ký gia hạn ngầm; sự kiện audio.
4. Drill/timed drill + mini generator → test cấu trúc hợp lệ 100 lần sinh ngẫu nhiên.
5. `packages/scoring` quy đổi + CI test.
6. Seed đề full/mini/drill; k6 lặp lại luồng 200 câu (ngưỡng S3).
7. HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Làm đề L&R 200 câu: Listening phát liên tục một lần, không tua; sau nộp xem transcript và nghe lại từng câu.
- [ ] Practice Part 3: tua, đổi tốc độ, lặp; đáp án hiện ngay.
- [ ] Mini test 60 câu sinh ngẫu nhiên hợp lệ cấu trúc, lặp lại được bằng `seed`.
- [ ] Điểm quy đổi L/R/Tổng và khoảng ước tính hiển thị, test bảng quy đổi xanh.
- [ ] Chrome/Safari/Firefox mới nhất đều phát được audio (ghi kết quả thử tay trong HANDOFF).
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; Playwright Listening chạy trong CI với audio mock.

## Kiểm thử bắt buộc
Unit: scoring, generator. Integration: media URL gia hạn, drill nguồn câu. E2E: Exam Mode audio không tua, Practice tua.
```

### S5 — AI Gateway production, Explain, Diagnose, Summary, Metering & Quota

```
# SPRINT 5 — AI Gateway mức sản xuất · explain_mcq thật · diagnose_rl · summarize_attempt · generate/check · Quota Free · Langfuse

## Mục tiêu
Thay mock bằng provider thật với định tuyến, dự phòng, cache, đo lường và quan sát đầy đủ; giải thích AI đạt chất lượng ≥ 4/5 theo eval; chẩn đoán sau bài làm và tóm tắt tiến bộ; sinh đề AI cho CMS; hạn mức Free hoạt động đúng ở server.

## Phạm vi — TRONG
1. AI Gateway
   - Adapter thật `google`, `anthropic`, `openai` (Vercel AI SDK) với structured output (JSON mode/tool call theo provider), timeout, retry có jitter, circuit breaker theo provider (mở sau 5 lỗi/60 s), `ModelRouter` đọc `ai.model_routes` (primary/fallback, params, giới hạn token/ngày); canary theo `prompt_versions.status` và % người dùng (hash user_id).
   - Repair: đầu ra sai Zod → gửi lại với lỗi validate một lần → fallback model → `failed` + hoàn credit; mọi bước ghi `ai.ai_tasks` (prompt_version_id, model, tokens in/out, cost_usd, latency_ms, cache_hit, status, error_code).
   - Langfuse tracing (user_id băm, không nội dung bài làm nếu `AI_TRACE_CONTENT=false`), OpenTelemetry span `ai.task`, Prometheus metrics (`ai_task_duration`, `ai_task_cost_usd`, `ai_task_failures_total` theo task/model).
   - Guardrails: `guard_classify` thật cho `tutor_chat` (S6) và mọi `<user_input>` tự do; prompt-injection đã có; `explain_mcq` không nhận input tự do.
   - Cache: `ai.explanation_cache` khoá `(question_version_id, locale, prompt_version_id)`; invalidation khi prompt version đổi; `ai.translation_cache` cho `segment_translate` (dùng ở S6 tra từ/câu).
   - Admin: `GET/POST /admin/prompts`, `POST /admin/prompts/{templateId}/versions`, `POST /admin/prompts/versions/{versionId}/status` (draft→canary→active bắt buộc có `eval_runs` đạt ngưỡng; nếu `ALLOW_UNEVALUATED_ACTIVATION=true` ở dev mới bỏ qua), `GET /admin/eval-runs`, `GET /admin/reports/ai-costs` theo ngày/task/model.
2. Tính năng
   - `POST /ai/explain` thật: giải thích song ngữ theo `explain_locale`, hiển thị streaming SSE trong Review; "Không hiểu" → bấm hỏi tiếp mở thread (S6); đánh giá 👍/👎 `POST /ai/feedback` → `ai.feedback`.
   - `GET /attempts/{id}/diagnosis` gọi `diagnose_rl` (job BullMQ `diagnose.attempt`, 202 + polling/Socket.IO) kết hợp số liệu quy tắc; hiển thị trên màn kết quả.
   - `summarize_attempt` sau mỗi 3 bài hoặc hàng tuần (job) → `learn.notes` loại `system_summary` và dashboard (S10 dùng).
   - CMS: "Sinh câu hỏi bằng AI" (`POST /admin/generate/questions` → job `content.generate` với `generate_questions`, kết quả vào draft gắn `source=ai`, tự chạy `check_question`), embedding `ai.embeddings` (pgvector) cho dedup ≥ 0,92 cosine với câu published.
   - Quota Free: `billing.quotas` theo `quota_period` (ví dụ explain 10/ngày, đề full 2/tháng — đọc seed, không hard-code), `QuotaService` Redis `INCR` + TTL + chốt `usage_counters` hằng đêm; vượt → 402/429 theo OpenAPI với `details.quota`; UI hiển thị còn bao nhiêu và CTA nâng cấp (billing S7).
3. Eval: `pnpm eval:run` cho `explain_mcq` trên `eval/data/explain_mcq_v1.jsonl` (≥ 100 câu từ ngân hàng published, không đáp án lộ) đạt `teacher_proxy_rating ≥ 4/5`, `correct_option_match = 100 %`; lưu `ai.eval_runs/eval_run_items`.

## Phạm vi — NGOÀI
Tutor chat (S6), chấm Writing/Speaking (GĐ2), voice realtime, `plan_adjust` (S9), `upgrade_phrasing` (GĐ2).

## Đầu vào
DDL: `ai.*`, `billing.quotas/usage_counters/credit_ledger`, `learn.notes`. OpenAPI: nhóm AI (`/ai/explain`, `/ai/feedback`), `/attempts/{id}/diagnosis`, Admin prompts/eval/generate/reports. Prompt: `explain_mcq`, `diagnose_rl`, `summarize_attempt`, `generate_questions`, `check_question`, `guard_classify`, `segment_translate`; `allingo-promptfoo.yaml`. Thiết kế kỹ thuật mục 7 (toàn bộ), 6.3.

## Các bước
1. Adapter thật + router + breaker + repair → test với provider giả lập lỗi/timeout (msw).
2. Metering + Langfuse + metrics → test ghi `ai_tasks` đầy đủ trường, credit trừ/hoàn đúng.
3. Prompt lifecycle + admin endpoints + ràng buộc eval → test.
4. Explain SSE thật + cache + feedback → eval chạy, lưu run.
5. Diagnose job + UI; summarize job.
6. Generate + check + embedding dedup trong CMS.
7. Quota Free end-to-end (Redis + chốt đêm) → test reset ngày/tháng theo múi giờ Asia/Ho_Chi_Minh.
8. HANDOFF, báo cáo chi phí/1.000 explain.

## Tiêu chí nghiệm thu
- [ ] Tắt key Gemini → explain tự chuyển fallback theo `model_routes`, `ai_tasks` ghi `fallback_used=true`; 5 lỗi liên tiếp → breaker mở, log cảnh báo, tự đóng sau 60 s.
- [ ] Eval `explain_mcq` ≥ 4/5, lưu trong `GET /admin/eval-runs`; kích hoạt prompt version chưa có eval bị từ chối 409.
- [ ] Free: explain lần 11 trong ngày trả 429 với số còn lại = 0; 00:00 giờ VN reset; `usage_counters` chốt đúng.
- [ ] Sinh 10 câu Part 5 chủ đề "logistics" → 10 draft `source=ai`, có kết quả check, câu trùng với ngân hàng bị gắn cờ.
- [ ] Dashboard chi phí AI theo ngày/task/model đúng tổng với Langfuse (±1 %).
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; không `console.log`; không PII trong trace.

## Kiểm thử bắt buộc
Unit: router, breaker, repair, quota reset, cost calc. Integration: ai_tasks + credit transaction rollback, cache hit/miss, eval run storage. Eval: explain_mcq. E2E: Review → Explain SSE → feedback.
```

### S6 — Tutor chat SSE, tra từ, ghi chú, PWA

```
# SPRINT 6 — Tutor chat có ngữ cảnh (SSE) · Tra từ & dịch câu · Ghi chú · PWA shell · Khoá Exam Mode

## Mục tiêu
Người học hỏi gia sư AI ngay trong màn Review và từ dashboard, với ngữ cảnh bài làm và lịch sử lỗi; tra từ/dịch câu tức thì có cache và phát âm; ghi chú gắn câu hỏi; web cài được như app (PWA) với trang offline và thông báo đẩy cơ bản; mọi tính năng AI bị khoá đúng luật trong Exam Mode.

## Phạm vi — TRONG
1. Tutor chat
   - `POST /ai/threads` (ngữ cảnh: `attempt_id`/`question_version_id`/`free`), `POST /ai/threads/{id}/messages` SSE, `GET /ai/threads` (cursor), lưu `learn.chat_threads/chat_messages`; giới hạn 20 lượt/thread Free, 200 Pro (đọc quota), độ dài input ≤ 2.000 ký tự.
   - `ContextBuilder`: tóm tắt attempt (từ `summarize_attempt`/số liệu), câu hỏi hiện tại (không đáp án nếu attempt đang `in_progress` exam), 5 lỗi gần nhất, mục tiêu/ngày thi từ enrollment; cắt theo ngân sách token; mọi phần người học trong `<user_input>`, dữ liệu hệ thống `<data>`.
   - `guard_classify` trước khi gọi `tutor_chat`; từ chối lịch sự theo i18n; ghi `ai_tasks.status = refused`.
   - UI: panel chat trượt bên phải ở Review/Dashboard, streaming, nút gợi ý câu hỏi ("Vì sao B sai?", "Cho ví dụ khác"), trích dẫn câu hỏi, đánh giá 👍/👎, tiếp tục thread cũ.
2. Tra từ & dịch
   - `GET /dictionary/lookup?term&context&locale`: tra từ EN→VI (nguồn: từ điển mở có giấy phép — ví dụ dữ liệu Wiktionary/FreeDict ghi rõ giấy phép trong `docs/LICENSES.md` — nhập vào `catalog.vocab_items` kind `word`), phát âm IPA, ví dụ; không có trong từ điển → `segment_translate` với cache `ai.translation_cache`; TTS từ `ai.tts_cache`.
   - Chọn từ/câu trong passage (Practice & Review, không phải Exam Mode) → popover tra từ, nút "Thêm vào từ vựng của tôi" tạo `srs_cards` kind `vocab` (FSRS lịch ở S10; tạm `new`).
3. Ghi chú: `GET/POST /notes` gắn `question_version_id`/`attempt_id`, Markdown ngắn, tìm kiếm; hiển thị trong Review.
4. PWA: manifest, icon, Serwist precache shell + runtime cache ảnh/audio theo stale-while-revalidate (không cache API trả lời), trang offline, cài đặt (A2HS banner sau 2 lần truy cập), Web Push đăng ký (VAPID) lưu `ops.notification_preferences`; gửi thử thông báo "Đến giờ học" thủ công từ admin (lịch tự động ở S9).
5. Exam Mode: middleware chung — attempt `in_progress` + `mode=exam` → `/ai/explain`, `/ai/threads*`, `/dictionary/lookup` (với `question_version_id` thuộc attempt), `/notes` ghi trả 403 `EXAM_MODE_LOCKED`; UI ẩn các nút tương ứng.

## Phạm vi — NGOÀI
Voice realtime/LiveKit (GĐ2), proactive tutor, dịch video, thông báo lịch học tự động (S9), app mobile.

## Đầu vào
DDL: `learn.chat_threads/chat_messages/notes/srs_cards`, `ai.translation_cache/tts_cache`, `catalog.vocab_items`, `ops.notification_preferences`. OpenAPI: `/ai/threads*`, `/dictionary/lookup`, `/notes`, `/tts`, `/me/notification-preferences`. Prompt: `tutor_chat`, `guard_classify`, `segment_translate`. PRD: FR-AI-*, FR-PWA-*. Thiết kế kỹ thuật mục 7 (chống prompt injection), 8 (Exam Mode).

## Các bước
1. Threads/messages + ContextBuilder + guard → test ngân sách token, không lộ đáp án khi exam in_progress.
2. SSE streaming + UI chat + feedback.
3. Dictionary: nhập dữ liệu từ điển mở (script `db/seed/dictionary.ts`, giấy phép), lookup + fallback AI + cache + TTS.
4. Popover chọn từ + thêm SRS; notes.
5. PWA + push + trang offline → Lighthouse PWA pass.
6. Exam Mode lock middleware + test ma trận endpoint × trạng thái attempt.
7. HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Trong Review hỏi "Vì sao đáp án C sai?" → trả lời streaming đúng câu đang xem, có trích dẫn; hỏi "cho tôi đáp án đề đang thi" khi có attempt exam in_progress → 403.
- [ ] Prompt injection trong chat ("ignore previous instructions…") bị guard từ chối, `ai_tasks.status=refused`, không gọi model chính.
- [ ] Tra "invoice" trả nghĩa/IPA/ví dụ < 200 ms (cache); câu dài chưa có cache → dịch AI, lần hai cache hit.
- [ ] Thêm 5 từ vào SRS từ passage; ghi chú hiện lại ở Review.
- [ ] Cài PWA trên Chrome Android/desktop; tắt mạng mở app → trang offline + danh sách đề đã xem; nhận push thử.
- [ ] Lighthouse: PWA installable, Performance ≥ 85, Accessibility ≥ 95 trên `/toeic/dashboard`.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh.

## Kiểm thử bắt buộc
Unit: ContextBuilder cắt token, guard decision mapping, Exam Mode matrix. Integration: thread quota, translation cache, push subscription. E2E: chat SSE, tra từ, PWA offline (Playwright offline mode).
```

### S7 — Billing: đơn hàng, 3 cổng thanh toán, subscription & entitlement gating

```
# SPRINT 7 — Billing end-to-end sandbox: VNPay · MoMo · ZaloPay · Subscriptions · Entitlements · Credit packs · Đối soát

## Mục tiêu
Người dùng mua gói Pro (tháng/năm/trọn đời/combo) và gói credit trên web bằng ba cổng ở sandbox, nhận quyền ngay khi webhook xác nhận, hệ thống đối soát được từng đồng; mọi tính năng trả phí bị chặn ở server theo entitlement.

## Phạm vi — TRONG
1. Catalog gói: `GET /plans` (từ `billing.plans/prices`, giá VND, hiển thị theo program/combo), `POST /promotions/validate` (mã, điều kiện, giới hạn lượt — áp dụng ở S8 đầy đủ, S7 chỉ validate mã cố định seed).
2. Đơn hàng & thanh toán
   - `POST /orders` (Idempotency-Key; `price_id`, `promotion_code?`), trạng thái `pending → paid|failed|cancelled|expired` (hết hạn 30 phút, job `order.expire`); `GET /orders/{id}`; `POST /orders/{id}/pay` trả `redirect_url`/`qr`/`deeplink` theo provider.
   - `PaymentProvider` interface: `createPayment`, `verifyWebhook`, `parseWebhook`, `queryStatus`, `refund?`; adapter `VnpayProvider`, `MomoProvider`, `ZalopayProvider` theo tài liệu sandbox chính thức của từng cổng (ký HMAC đúng chuẩn, kiểm tra số tiền/đơn vị, mã phản hồi); `MockPaymentProvider` giữ cho test.
   - Webhook-first: `POST /webhooks/payments/{provider}` xác minh chữ ký, idempotent theo `(provider, provider_txn_id)` (`billing.payments` unique), xử lý trong transaction: `payments` → `orders.paid` → cấp `subscriptions`/`entitlements`/credit (`credit_ledger` reason `purchase|subscription_grant`) → outbox `order.paid`; return URL chỉ hiển thị, không cấp quyền; webhook đến trước `pay` vẫn xử lý đúng; `queryStatus` để job `payment.reconcile` đối chiếu đơn `pending` > 15 phút.
   - Hoàn tiền thủ công (admin) → `orders.refunded`, thu hồi entitlement, ledger `refund`; không tích hợp API refund tự động ở S7 (ghi TODO).
3. Subscriptions & entitlements
   - `billing.subscriptions` (monthly/yearly có `current_period_end`, lifetime), gia hạn thủ công bằng mua lại (không auto-renew thẻ ở năm 1); `POST /me/subscriptions/{id}/cancel` (ngừng cấp lại credit tháng, giữ quyền tới hết kỳ); job `subscription.expire` hạ xuống Free và gửi thông báo trước 7/3/1 ngày (ops.notifications).
   - `EntitlementService` nguồn sự thật: `billing.v_active_entitlements`; cache Redis 60 s, invalidate khi thay đổi; `GET /me/entitlements`; credit tháng Pro cấp vào đầu kỳ qua job `credit.grant_monthly` (idempotent theo `(subscription_id, period)`), credit mua gói `credit_pack` không hết hạn trong 12 tháng (`expire` job).
   - Gating: bảng ánh xạ tính năng → entitlement/quota trong `packages/config/entitlements.ts` (đề full, explain, tutor, drill, dictionary AI…); áp dụng guard cho toàn bộ endpoint hiện có; UI đọc `GET /me/entitlements` để hiển thị khoá/mở nhưng server quyết định.
4. Đối soát: `billing.reconciliation_runs` hằng ngày: so `payments` với sao kê tải thủ công (CSV theo mẫu từng cổng) hoặc `queryStatus`; báo cáo lệch; màn admin đơn giản (Payload hoặc trang `/admin/billing` trong web — theo ADR Sprint 0).
5. UI: trang `/pricing` (so sánh Free/Pro, combo), checkout (chọn cổng, mã khuyến mãi, điều khoản), trạng thái đơn (polling + Socket.IO), lịch sử đơn/credit (`GET /me/credits/ledger`), banner hết hạn.

## Phạm vi — NGOÀI
Hoá đơn điện tử, khuyến mãi nâng cao, referral (S8); Stripe/PayOS (adapter interface sẵn, không làm); IAP; auto-renew thẻ.

## Đầu vào
DDL: `billing.*` (plans, prices, promotions, orders, payments, subscriptions, entitlements, credit_ledger, credit_balances, reconciliation_runs), `ops.notifications`. OpenAPI: nhóm Billing, Webhooks. PRD: FR-BL-*, mục 4 (gói & giá). Thiết kế kỹ thuật mục 6.2 (thanh toán), 8 (bảo mật webhook).

## Các bước
1. Plans/prices API + pricing UI.
2. Orders + idempotency + expire job → test.
3. Ba adapter thật với sandbox (credential từ env; thiếu → adapter báo `unavailable`, UI ẩn cổng) + chữ ký → test vector từ tài liệu cổng (fixture).
4. Webhook transaction + idempotent + out-of-order → test đồng thời (2 webhook trùng cùng lúc chỉ cấp 1 lần).
5. Subscriptions/entitlements/credit grants/expire jobs → test theo thời gian giả lập.
6. Gating toàn hệ thống + bảng ánh xạ → test ma trận plan × feature.
7. Reconcile job + admin view.
8. HANDOFF + `docs/runbooks/payments.md` (xử lý đơn kẹt, hoàn tiền, đối soát).

## Tiêu chí nghiệm thu
- [ ] Mua Pro TOEIC tháng qua VNPay sandbox: redirect → thanh toán test → webhook → quyền mở trong < 5 s, credit tháng cộng, ledger có 2 dòng (grant), `balance_after` đúng; lặp lại với MoMo, ZaloPay.
- [ ] Gửi lại webhook cùng txn 3 lần → chỉ 1 payment; webhook sai chữ ký → 400 và audit log.
- [ ] Đơn pending 31 phút → expired; đơn đã trả nhưng webhook mất → `payment.reconcile` phát hiện qua `queryStatus` và cấp quyền.
- [ ] Tài khoản Free gọi `POST /attempts` đề full lần 3 trong tháng → 402/429 đúng envelope; Pro không giới hạn.
- [ ] Huỷ subscription → quyền giữ tới `current_period_end`, sau đó job hạ Free, thông báo gửi.
- [ ] Reconcile ngày không lệch với 20 giao dịch sandbox; báo cáo CSV.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; không secret trong repo; test ≥ 40 ca mới.

## Kiểm thử bắt buộc
Unit: chữ ký 3 cổng (fixture), tính giá/khuyến mãi, entitlement mapping. Integration: webhook transaction/idempotency/đồng thời, grants/expire jobs, gating guards. E2E: checkout với MockPaymentProvider.
```

### S8 — Hoá đơn điện tử, khuyến mãi, referral, thông báo đa kênh

```
# SPRINT 8 — Hoá đơn điện tử · Khuyến mãi & mã giảm giá · Referral · Hệ thống thông báo (email/push/in-app) · Billing admin

## Mục tiêu
Mỗi đơn đã thanh toán có hoá đơn điện tử hợp lệ phát hành tự động; đội tăng trưởng tạo được chương trình khuyến mãi và theo dõi referral mà không cần lập trình viên; người dùng nhận thông báo đúng kênh, đúng tần suất, có thể tắt.

## Phạm vi — TRONG
1. Hoá đơn điện tử
   - Interface `EInvoiceProvider` (`issue`, `cancel`, `getPdf`, `getStatus`); adapter theo nhà cung cấp chốt trong ADR (mặc định MISA meInvoice nếu chưa chốt; Viettel SInvoice adapter khung) + `MockEInvoiceProvider`.
   - Job `invoice.issue` sau `order.paid` (outbox consumer): thu thập thông tin người mua (cá nhân: tên/email; doanh nghiệp: MST, tên, địa chỉ nhập ở checkout, lưu `billing.invoices.buyer`), phát hành, lưu số/ký hiệu/mã tra cứu/PDF S3; thất bại → retry 5 lần backoff → dead-letter + cảnh báo admin; `GET /orders/{id}` trả thông tin hoá đơn; email PDF.
   - Huỷ hoá đơn khi hoàn tiền (job), đối chiếu tháng: số hoá đơn phát hành = số đơn paid − refunded.
2. Khuyến mãi
   - `billing.promotions`: loại `percent|fixed|credit_bonus|trial_days`, điều kiện (plan, program, user mới, thời gian, số lượt tổng/người), stackable=false; `POST /promotions/validate` đầy đủ; áp vào `POST /orders` (lưu `discount_amount`, `promotion_id`); admin tạo/sửa trong admin UI; sự kiện `promotion.redeemed`.
   - Chiến dịch "Dùng thử Pro 7 ngày" (trial_days) cấp `subscriptions.status = trialing` một lần/người; hết trial → thông báo + hạ Free.
3. Referral (`growth`)
   - `GET /me/referral` (mã, link, thống kê joined/started/upgraded, thưởng đã nhận); `iam.referrals` cập nhật trạng thái qua outbox (`user.registered` với `ref` → joined; `attempt.graded` lần đầu → started; `order.paid` → upgraded); thưởng credit hai chiều theo cấu hình `feature_flags`/seed (ví dụ 200/500 credit), ledger reason `referral`; chống lạm dụng: cùng thiết bị fingerprint/IP trong 24 giờ, tối đa 20 thưởng/tháng, tài khoản chưa xác minh email không được thưởng.
   - Trang chia sẻ: link có UTM, hình ảnh OG, Zalo/Facebook share.
4. Thông báo (`ops.notifications`, `ops.notification_preferences`)
   - `NotificationService.send(userId, template, data, channels?)` với template i18n (Handlebars, vi/en), kênh email (SMTP provider: Mailpit dev, `Resend`/`SES` adapter), web push, in-app (`GET /me/notifications`, đánh dấu đã đọc, Socket.IO realtime); tuỳ chọn người dùng `GET/PUT /me/notification-preferences` theo loại (học tập, thanh toán, marketing) và giờ yên lặng; tần suất: tối đa 1 email marketing/tuần, 2 push/ngày.
   - Template bắt buộc: đơn hàng thành công + hoá đơn, sắp hết hạn 7/3/1, hết hạn, trial, referral thưởng, nhắc học (S9 sẽ lập lịch), tóm tắt tuần (S10).
   - Unsubscribe link ký, trang quản lý; email có plain-text alternative; DKIM/SPF hướng dẫn trong runbook.
5. Billing admin: danh sách đơn/thanh toán/hoá đơn/subscription với lọc, hoàn tiền thủ công, cấp credit thủ công `POST /admin/users/{userId}/credits` (reason `admin_adjust`, ghi audit), xem ledger người dùng.

## Phạm vi — NGOÀI
Zalo OA/SMS marketing (GĐ4), A/B test giá, affiliate trả hoa hồng tiền, CRM.

## Đầu vào
DDL: `billing.invoices/promotions/orders`, `iam.referrals`, `ops.notifications/notification_preferences`, `billing.feature_flags`. OpenAPI: `/promotions/validate`, `/me/referral`, `/me/notifications`, `/me/notification-preferences`, Admin users/credits, plans. PRD: FR-BL-* (hoá đơn), FR-GR-* (referral), FR-NT-*. Thiết kế kỹ thuật mục 6.2, 8 (tuân thủ hoá đơn/thuế).

## Các bước
1. ADR nhà cung cấp hoá đơn; adapter + mock + job + retry/dead-letter → test.
2. Promotions đầy đủ + trial → test điều kiện.
3. Referral pipeline qua outbox + chống lạm dụng → test.
4. NotificationService + template + kênh + preferences + rate limit → test.
5. Billing admin UI.
6. HANDOFF + `docs/runbooks/invoices.md`.

## Tiêu chí nghiệm thu
- [ ] Mua gói → trong 60 s có hoá đơn (sandbox nhà cung cấp) với số/mã tra cứu, PDF tải được từ `GET /orders/{id}`, email nhận PDF; hoàn tiền → hoá đơn huỷ.
- [ ] Mã `WELCOME20` giảm 20 % cho user mới, dùng lần 2 bị từ chối; trial 7 ngày chỉ cấp một lần.
- [ ] A giới thiệu B: B đăng ký (joined) → làm bài (started) → mua Pro (upgraded); A và B nhận credit đúng cấu hình; B thứ 21 trong tháng không thưởng; cùng fingerprint không thưởng.
- [ ] Tắt email marketing → không nhận email tuần; push nhắc học không gửi trong giờ yên lặng.
- [ ] Admin cấp 100 credit kèm lý do → ledger `admin_adjust`, audit log có admin id.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; dead-letter hoá đơn hiển thị trong admin.

## Kiểm thử bắt buộc
Unit: promotion rules, referral guards, notification rate limits, template rendering i18n. Integration: invoice job retry/dead-letter, referral outbox chain, preferences. E2E: checkout có mã, trang referral.
```

### S9 — Diagnostic, lộ trình tuần, check-in, streak/XP/badges, nhắc học

```
# SPRINT 9 — Learning v1: Bài chẩn đoán · Lộ trình đến ngày thi (plan tuần) · Check-in & điều chỉnh (plan_adjust) · Streak/XP/Badges · Nhắc học

## Mục tiêu
Người học mới làm bài chẩn đoán 25–30 phút, nhận lộ trình cá nhân hoá theo mục tiêu và ngày thi, mỗi ngày thấy "Hôm nay học gì", check-in và được điều chỉnh kế hoạch khi tụt tiến độ; động lực duy trì qua streak/XP/huy hiệu và nhắc học đúng giờ.

## Phạm vi — TRONG
1. Diagnostic
   - Test set `kind = diagnostic` TOEIC (≈ 60 câu phủ Part 1–7 và subskill, 2 mức khó mỗi subskill); `mode = diagnostic`; `GET /me/diagnostic/{attemptId}/next` trả câu kế tiếp theo luật thích ứng đơn giản (đúng 2 liên tiếp → tăng mức, sai 2 → giảm; CAT/IRT thật ở GĐ4) — ghi ADR "diagnostic v1 rule-based".
   - Kết quả: ước tính band/điểm hiện tại ± khoảng, `learn.skill_mastery` khởi tạo theo subskill (0–1), đề xuất mục tiêu khả thi so ngày thi.
2. Study plan
   - `learn.study_plans` (program, target_score, exam_date, giờ học/tuần, ngày học trong tuần, mức hiện tại), `plan_weeks`, `plan_tasks` theo `learn.plan_task_type`.
   - `PlanGenerator` (thuật toán, không AI): chia số tuần còn lại thành chu kỳ 3 tuần (nền → luyện → mô phỏng), phân bổ phút/tuần vào task theo điểm yếu `skill_mastery` (yếu hơn nhận nhiều hơn), xen full test mỗi 2 tuần (Pro) hoặc 1/tháng (Free), vocab_review hằng ngày (S10), checkin cuối tuần; nội dung task trỏ test set/section/lesson có thật; `POST /me/plan/regenerate`.
   - `GET /me/plan`, `GET /me/plan/today` (task hôm nay + overdue + gợi ý "nếu chỉ có 15 phút"), `PATCH /plan-tasks/{taskId}` (done/skipped, ghi liên kết attempt/lesson tự động khi hoàn thành qua outbox `attempt.graded`/`lesson.completed`), tự động `expired` sau 3 ngày.
   - Check-in tuần `POST /me/plan/checkin` (cảm nhận, số giờ thực tế, khó khăn) → `plan_adjust` (AI, job) sinh đề xuất `PlanAdjustProposal` → `POST /me/plan/adjust` xem/`POST /me/plan/adjust/{proposalId}/apply` áp dụng (thay đổi tuần tới, không sửa quá khứ); mọi đề xuất validate Zod và kiểm tra ràng buộc (không vượt giờ/tuần, task trỏ nội dung có thật).
   - Tiến độ: % hoàn thành tuần, dự báo "đúng hướng/chậm" theo quy tắc (điểm forecast AI ở GĐ4), thanh tiến độ tới ngày thi.
3. Gamification
   - `learn.streaks` (ngày học liên tiếp theo múi giờ người dùng, "đóng băng" 1 lần/tuần Pro), `xp_events` (bảng điểm hành động trong `packages/config/xp.ts`), `badges` + trao huy hiệu qua rule engine đơn giản chạy trên outbox (ví dụ: 7 ngày streak, 1.000 câu, full test đầu tiên, điểm tăng 50), hiển thị dashboard + thông báo in-app.
4. Nhắc học: job `notify.study_reminder` theo giờ học ưa thích và múi giờ (push/email theo preferences), nội dung từ `GET /me/plan/today`; nhắc streak sắp mất lúc 20:00; không gửi khi đã học hôm đó.
5. UI: onboarding 4 bước (chương trình → mục tiêu/ngày thi → giờ học → chẩn đoán), trang lộ trình (tuần, task, kéo thả đổi ngày trong tuần), trang hôm nay, check-in, màn huy hiệu.

## Phạm vi — NGOÀI
FSRS vocab/error (S10), Google Calendar (GĐ2), plan v2 mastery path/chẩn đoán AI (GĐ2), IRT/CAT (GĐ4).

## Đầu vào
DDL: `learn.study_plans/plan_weeks/plan_tasks/skill_mastery/streaks/xp_events/badges/attempts`. OpenAPI: `/me/plan*`, `/plan-tasks/{taskId}`, `/me/diagnostic/{attemptId}/next`, `/me/stats` (một phần). Prompt: `plan_adjust`. PRD: FR-LP-*, FR-GM-*. Thiết kế kỹ thuật mục 6.4 (lộ trình).

## Các bước
1. Diagnostic set + adaptive next + mastery init → test luật.
2. PlanGenerator + ràng buộc + test property-based (fast-check): mọi plan sinh ra hợp lệ (tổng phút ≤ ngân sách, task có nội dung thật, tuần cuối là mô phỏng).
3. Plan endpoints + task auto-complete qua outbox + expire.
4. Check-in + plan_adjust job + apply với validate → test proposal sai bị từ chối.
5. Streak/XP/badges rule engine → test múi giờ, đóng băng.
6. Reminder job + preferences.
7. UI onboarding/plan/today/check-in; HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Người dùng mới hoàn tất onboarding + chẩn đoán → có plan 8 tuần với task cụ thể, tuần cuối có full test, phút/tuần đúng cài đặt.
- [ ] Hoàn thành drill từ task → task tự `done`, XP cộng, streak tăng; bỏ 3 ngày → task `expired`, streak về 0 (hoặc giữ nếu đã đóng băng).
- [ ] Check-in "tuần này bận, chỉ 2 giờ" → đề xuất giảm tải tuần tới hợp lệ, áp dụng xong plan cập nhật, lịch sử đề xuất lưu.
- [ ] Nhắc học đúng 19:00 giờ người dùng qua push; đã học thì không nhắc.
- [ ] Huy hiệu "7 ngày liên tiếp" trao đúng lúc, thông báo in-app.
- [ ] `pnpm api:diff`, `pnpm db:diff` xanh; property test PlanGenerator chạy 500 ca.

## Kiểm thử bắt buộc
Unit: adaptive rule, PlanGenerator (property-based), xp/streak/badge rules, timezone. Integration: outbox → task done, plan_adjust apply transaction, reminder job. E2E: onboarding → plan → hoàn thành task.
```

### S10 — FSRS từ vựng, sổ lỗi, thống kê & dashboard, marketing site & blog

```
# SPRINT 10 — FSRS từ vựng & flashcard · Sổ lỗi (error log v1) · Thống kê & dashboard · Web marketing + Blog (Payload) + SEO

## Mục tiêu
Từ vựng và lỗi sai được ôn đúng lịch bằng FSRS, người học thấy rõ tiến bộ qua dashboard; website marketing có blog và landing theo chương trình đạt chuẩn SEO/hiệu năng để bắt đầu thu hút người dùng beta.

## Phạm vi — TRONG
1. `packages/fsrs` + SRS
   - Bọc `ts-fsrs` với tham số mặc định FSRS-5, cho phép tối ưu tham số theo người dùng sau ≥ 1.000 review (job hằng tuần, lưu `study_plans.fsrs_params` hoặc bảng phù hợp trong DDL); API thuần hàm, test với vector mẫu.
   - `learn.srs_cards` (kind `vocab|error|grammar|sentence`), `srs_reviews`; `GET /me/srs/due` (giới hạn mới/ngày cấu hình: Free 10, Pro 30 — đọc quota), `POST /me/srs/review` (rating 1–4, idempotent theo `(card_id, reviewed_at)`), `GET/POST /me/srs/cards` (tạo tay, từ tra từ, từ lỗi); danh sách từ vựng hệ thống `GET /vocab/lists`, `/vocab/lists/{id}/items` (TOEIC 600 từ theo chủ đề tự biên soạn), "Thêm cả bộ vào ôn tập".
   - UI flashcard: mặt trước/sau, phát âm (TTS cache), ví dụ, gõ lại từ (dictation mini), phím tắt, phiên ôn 10–30 thẻ, tổng kết; task `vocab_review` trong plan liên kết.
2. Sổ lỗi
   - Khi `attempt.graded`: mỗi câu sai tạo `learn.error_log_entries` (question_version_id, `error_kind` suy luận theo luật: timeout nếu `time_spent` > ngưỡng, else theo subskill/topic → `paraphrase|trap|vocabulary|grammar|listening_detail|inference|other`; AI gán nhãn tinh ở GĐ2), gộp trùng câu; `GET /me/errors` (lọc kind/part/thời gian, cursor), `PATCH /me/errors/{id}` (đã hiểu/ghi chú/tạo thẻ SRS kind `error`); task `review_errors` trong plan lấy 10 lỗi chưa hiểu cũ nhất.
   - Màn sổ lỗi: thống kê theo loại, "làm lại 10 câu sai" tạo `timed_drill` từ error entries.
3. Thống kê & dashboard
   - `GET /me/stats` đầy đủ: điểm theo thời gian (attempt full/mini), độ chính xác theo Part/subskill (30 ngày vs trước), thời gian học/tuần, streak, XP, từ vựng đã thuộc/đang học, lỗi theo loại, so với cộng đồng cùng mục tiêu (percentile, ẩn danh, cache 1 giờ); `GET /me/forecast` v0: hồi quy tuyến tính trên điểm ước tính + ngày thi (ghi rõ "ước tính sơ bộ", AI/KT ở GĐ4).
   - Dashboard web: thẻ KPI, biểu đồ (thư viện nhẹ, SSR-friendly), "việc hôm nay", "lỗi cần ôn", "từ đến hạn", tóm tắt tuần từ `summarize_attempt`/notes; tóm tắt tuần gửi email thứ Hai.
   - Replica/read model: truy vấn stats đọc từ `analytics` qua replica (hoặc cùng DB với `SET TRANSACTION READ ONLY` khi dev), chỉ số tổng hợp đêm vào bảng tổng hợp trong `analytics` nếu DDL có; nếu không có → tính trực tiếp + cache, ghi SPEC-ISSUES đề xuất bảng.
4. Marketing & blog
   - Payload collections `pages` (block builder: hero, features, pricing, FAQ, testimonial, CTA), `posts` (blog, category, tác giả, ảnh, SEO fields), `redirects`; `apps/web` route `(marketing)`: `/`, `/toeic`, `/ielts`, `/jlpt`, `/hsk` (JLPT/HSK "sắp ra mắt" + đăng ký chờ), `/pricing` (từ S7), `/blog`, `/blog/[slug]`, `/about`, `/terms`, `/privacy`, `/contact`; ISR 5 phút + revalidate webhook từ Payload; sitemap, robots, JSON-LD (Organization, Article, FAQ), OG image động; i18n vi/en cho marketing.
   - Analytics: PostHog (cookie consent banner, không bật trước khi đồng ý), sự kiện phễu chuẩn (`landing_view`, `signup_start`, `signup_done`, `diagnostic_done`, `first_attempt`, `checkout_start`, `order_paid`); UTM lưu vào `iam.users.attribution` (nếu DDL có cột, nếu không → `ops`/ghi SPEC-ISSUES).
   - Lighthouse landing: Performance ≥ 90, SEO ≥ 95, Accessibility ≥ 95, Best Practices ≥ 95 (mobile).

## Phạm vi — NGOÀI
Shadowing/dictation đầy đủ (GĐ2), AI gán nhãn lỗi (GĐ2), knowledge tracing/forecast AI (GĐ4), CRM email marketing.

## Đầu vào
DDL: `learn.srs_cards/srs_reviews/error_log_entries/score_forecasts/notes`, `catalog.vocab_lists/vocab_items`, `analytics` (nếu có bảng). OpenAPI: `/me/srs/*`, `/vocab/*`, `/me/errors*`, `/me/stats`, `/me/forecast`. PRD: FR-VC-*, FR-EL-*, FR-ST-*, FR-MK-*. Thiết kế kỹ thuật mục 6.4, 10 (cache), 11.

## Các bước
1. `packages/fsrs` + test vector; srs endpoints + quota → test lịch ôn qua thời gian giả lập.
2. Flashcard UI + TTS + task liên kết.
3. Error log pipeline qua outbox + luật phân loại + UI + drill từ lỗi → test.
4. Stats/forecast + cache + replica + dashboard UI; email tóm tắt tuần.
5. Payload pages/posts + marketing routes + SEO + PostHog + consent.
6. Lighthouse + HANDOFF.

## Tiêu chí nghiệm thu
- [ ] Thêm 20 từ → hôm nay có 10 thẻ mới (Free), đánh giá "Again" → thẻ quay lại trong phiên, "Good" → lịch hôm sau; giả lập 7 ngày → số thẻ đến hạn đúng với ts-fsrs.
- [ ] Làm sai 8 câu trong drill → 8 mục sổ lỗi với loại hợp lý, "làm lại 10 câu sai" tạo drill từ đúng các câu đó; đánh dấu đã hiểu → biến mất khỏi task `review_errors`.
- [ ] Dashboard hiển thị biểu đồ điểm, độ chính xác theo Part, percentile; `GET /me/stats` p95 < 300 ms với 50 attempt/người (cache).
- [ ] Blog đăng bài từ Payload → hiển thị trên web trong ≤ 5 phút (ISR + webhook), có JSON-LD, OG image; sitemap liệt kê.
- [ ] PostHog chỉ nhận sự kiện sau khi đồng ý cookie; phễu 7 sự kiện có dữ liệu demo.
- [ ] Lighthouse mobile landing đạt ngưỡng; `pnpm api:diff`, `pnpm db:diff` xanh.

## Kiểm thử bắt buộc
Unit: fsrs wrapper vector, phân loại lỗi, forecast. Integration: srs quota/idempotency, error pipeline, stats cache invalidation, ISR revalidate. E2E: phiên flashcard, sổ lỗi → drill, blog render.
```

### S11 — Observability, hiệu năng & tải 5.000 CCU, bảo mật, vận hành

```
# SPRINT 11 — Observability đầy đủ · Load test 5.000 CCU · Tối ưu hiệu năng · Hardening & pentest 1 · Backup/DR · Runbooks

## Mục tiêu
Hệ thống đo được, báo động được, chịu tải 5.000 người dùng đồng thời theo kịch bản thi thật với SLO đã định, vượt kiểm thử bảo mật vòng 1, có sao lưu/khôi phục đã diễn tập và runbook cho mọi sự cố thường gặp — điều kiện kỹ thuật của GATE-2.

## Phạm vi — TRONG
1. Observability
   - OpenTelemetry: trace API/worker/DB/Redis/HTTP ngoài (AI, cổng thanh toán, Azure), propagate `trace_id` tới client (header + envelope lỗi); metrics RED theo route, hàng đợi BullMQ (độ sâu, thời gian chờ, thất bại), DB (kết nối, slow query > 200 ms), cache hit; log pino JSON có `trace_id`, redaction PII (email, phone, token) kiểm tra bằng test.
   - Stack: Grafana + Prometheus/Mimir + Loki + Tempo (Docker compose cho dev, Terraform module `observability` cho staging; hoặc Grafana Cloud theo ADR); Sentry web/api/worker với source map, release tag; Langfuse đã có; uptime check ngoài (Better Stack/UptimeRobot) cho `/health/ready` và landing.
   - Dashboards: "API SLO" (availability, p95 theo nhóm endpoint), "Thi" (attempt/giờ, lưu nháp p95, submit lỗi), "AI" (chi phí/giờ, fallback rate, p95 theo task), "Billing" (đơn/giờ, webhook thất bại, lệch đối soát), "Hàng đợi" (độ sâu, DLQ), "Hạ tầng" (CPU/RAM/DB).
   - Alert rules (Alertmanager/Grafana → Slack/Telegram/email): API 5xx > 1 %/5′, p95 lưu nháp > 500 ms/10′, DLQ > 0, webhook thất bại > 3/10′, AI fallback > 20 %/15′, chi phí AI/giờ > ngưỡng, DB kết nối > 80 %, disk > 80 %, chứng chỉ < 14 ngày; mỗi alert trỏ runbook.
   - SLO/SLI định nghĩa trong `docs/slo.md` theo Thiết kế kỹ thuật mục 9: API availability 99,9 %, p95 đọc < 300 ms, lưu nháp < 200 ms, explain cache hit < 500 ms, chấm Writing < 60 s (GĐ2), error budget và chính sách đóng băng tính năng.
2. Load test & tối ưu
   - k6 kịch bản `tests/load/exam-day.js`: 5.000 VU trong 30 phút: 60 % làm đề (lưu nháp mỗi 10 s), 20 % review + explain (cache hit 80 %), 10 % dashboard/stats, 10 % duyệt catalog/marketing; ramp 10 phút; dữ liệu seed 20.000 người dùng, 200.000 attempt, 20 triệu attempt_answers (script sinh nhanh bằng `COPY`).
   - Chạy trên staging (hoặc máy mạnh với compose nếu chưa có staging — ghi rõ) → đạt: p95 `PUT /answers` < 200 ms, `POST /submit` < 800 ms, `GET /review` < 400 ms, lỗi < 0,1 %, CPU DB < 70 %; tối ưu: index, pool (PgBouncer), cache, batch, partition pruning, N+1; ghi `docs/perf/report-S11.md` trước/sau.
   - Giới hạn tốc độ theo người dùng/IP (Fastify rate-limit + Redis), bảo vệ endpoint đắt (explain, submit, orders) bằng token bucket riêng; backpressure hàng đợi (ưu tiên `grading` > `notify`).
3. Bảo mật
   - CI: Semgrep (ruleset TS/Nest/Next), `pnpm audit` (fail high), Trivy image, gitleaks, OWASP ZAP baseline chạy trên staging hằng đêm; Dependabot/Renovate.
   - Hardening: CSP nghiêm (nonce), HSTS, cookie `SameSite=Lax; Secure; HttpOnly`, CSRF cho cookie-auth (double submit hoặc Better Auth built-in), giới hạn kích thước body/upload, xác thực MIME thực (magic bytes), chống enumerate (thời gian phản hồi đều ở login/otp), khoá tài khoản bất thường, WAF Cloudflare rules (rate limit login/otp/webhooks), bảo vệ webhook IP allowlist nếu cổng cung cấp.
   - Pentest 1: tự kiểm bằng checklist OWASP ASVS L2 (`docs/security/asvs-checklist.md`) + ZAP + thử tay 10 kịch bản (IDOR attempt/order/notes, RLS vượt org, leak đáp án qua API/socket/search, injection prompt, replay webhook, quota bypass, JWT alg none, open redirect return URL, SSRF upload, XSS trong ghi chú/markdown); sửa toàn bộ high/critical; báo cáo `docs/security/pentest-1.md`; đồng thời chuẩn bị gói thông tin cho đơn vị pentest ngoài (nếu có ngân sách).
4. Backup/DR & vận hành
   - Postgres: PITR (WAL) + snapshot ngày giữ 30 ngày; Redis persistence; S3 versioning + lifecycle 90/365 ngày đúng chính sách recordings; diễn tập khôi phục vào môi trường tạm, đo RTO/RPO (mục tiêu RTO 1 giờ, RPO 15 phút), ghi `docs/runbooks/restore.md`.
   - Migration an toàn: expand/contract, `CREATE INDEX CONCURRENTLY`, check trong CI chặn `DROP/RENAME` không có cờ; job `ops.partition.ensure` tạo partition trước 2 tháng + cảnh báo.
   - Runbooks (`docs/runbooks/`): sự cố AI provider, cổng thanh toán, hàng đợi tắc/DLQ, DB chậm, Redis mất, deploy/rollback, xoay secret, xử lý yêu cầu xoá dữ liệu, sự cố rò rỉ dữ liệu (quy trình 72 giờ), on-call lịch & escalation.
   - Feature flags `billing.feature_flags` có API `GET/PUT /admin/flags/{key}` + SDK client (`ff.<module>.<feature>`), kill-switch cho AI/payment.

## Phạm vi — NGOÀI
Multi-region, autoscaling nâng cao, SOC2, pentest 2 (GĐ2), chaos engineering.

## Đầu vào
Thiết kế kỹ thuật mục 8, 9, 10, 11; `docs/VERSIONS.md`; CLAUDE.md mục 9.

## Các bước
1. OTel + log redaction + metrics → test redaction.
2. Stack Grafana/Loki/Tempo compose + Terraform; dashboards as code (JSON trong `infra/observability/`); alert rules; Sentry; uptime.
3. Seed dữ liệu lớn + k6 → chạy, đo, tối ưu lặp 2–3 vòng, báo cáo.
4. Rate limit/backpressure.
5. Security CI + hardening + pentest 1 + sửa + báo cáo.
6. Backup/PITR + diễn tập restore + runbooks + flags.
7. HANDOFF + `docs/slo.md`.

## Tiêu chí nghiệm thu
- [ ] Mở Grafana thấy 6 dashboard có dữ liệu thật từ staging/dev; tắt Redis → alert đến Slack trong 2 phút, link runbook đúng; bật lại → resolve.
- [ ] k6 5.000 VU/30′ đạt toàn bộ ngưỡng; báo cáo trước/sau có số liệu; không partition thiếu, không DLQ.
- [ ] Log không chứa email/phone/token (test redaction + grep thủ công trên log 1 giờ tải).
- [ ] ZAP baseline 0 high; 10 kịch bản pentest tay đều "đã vá" với test hồi quy tương ứng; CSP không bị báo lỗi trên luồng chính.
- [ ] Diễn tập restore PITR về thời điểm 10 phút trước thành công trong < 60 phút; `docs/runbooks/restore.md` cập nhật thời gian thực đo.
- [ ] Kill-switch `ff.ai.explain` tắt → UI ẩn và API trả 503 có thông điệp i18n trong < 60 s.
- [ ] `pnpm lint typecheck test` xanh, CI có security jobs, `pnpm api:diff`/`db:diff` xanh.

## Kiểm thử bắt buộc
Unit: redaction, rate limiter, flags SDK. Integration: trace propagation, partition ensure, migration guard. Load: k6 exam-day. Security: ZAP, regression cho 10 kịch bản.
```

### S12 — Beta kín 300 người, admin & vận hành, phân tích, báo cáo GATE-2

```
# SPRINT 12 — Beta kín TOEIC 300 người · Admin & hỗ trợ · Phân tích sản phẩm · Hoàn thiện & báo cáo GATE-2

## Mục tiêu
Mở beta kín TOEIC L&R cho 300 người học thật theo mã mời, vận hành ổn định 2 tuần với đội hỗ trợ, thu thập phản hồi và số liệu để quyết định GATE-2 (đi tiếp GĐ2: IELTS + chấm Writing/Speaking + ra mắt công khai).

## Phạm vi — TRONG
1. Cơ chế beta
   - Mã mời/whitelist (feature flag `ff.growth.beta_gate` + bảng mời trong `growth` theo DDL nếu có, nếu không dùng `billing.promotions` loại `trial_days` + danh sách email trong `feature_flags.payload` — ghi SPEC-ISSUES); landing đăng ký chờ (S10) → chọn 300 → email mời theo đợt 50/ngày; beta tester nhận Pro 60 ngày (trial) + 2.000 credit.
   - Onboarding beta: khảo sát 5 câu (mục tiêu, ngày thi, điểm hiện tại, thiết bị, thời gian học), hướng dẫn 60 giây, kênh phản hồi (Zalo group/Discord link + nút "Góp ý" in-app `ops.feedback` kèm screenshot & trace_id tự động).
   - Báo lỗi nội dung: nút "Báo lỗi câu hỏi" → `ops.content_reports` → hàng đợi duyệt trong CMS; vòng sửa nội dung 48 giờ; sự cố kỹ thuật → `ops.support_tickets` với SLA phản hồi 24 giờ; trang admin hỗ trợ xem ticket, lịch sử người dùng (ẩn PII không cần thiết), gửi trả lời (email/in-app), cấp credit bù.
2. Admin & vận hành (`admin`)
   - Trang admin (theo ADR Sprint 0: Payload admin mở rộng hoặc `/admin` trong web): người dùng (tìm, xem, khoá/mở, vai trò, xoá theo yêu cầu, impersonate chỉ đọc có audit), nội dung (tỷ lệ đúng/độ khó thực tế từng câu, câu bị báo nhiều, phân biệt tốt/xấu để retire), AI (chi phí, chất lượng feedback 👍/👎 theo prompt version, mẫu refused), billing (từ S8), hệ thống (flags, hàng đợi, DLQ replay, partition), nhật ký audit tìm kiếm.
   - Job vận hành: `content.stats_nightly` (p-value, discrimination đơn giản của câu từ `attempt_answers`), `ops.retention_cleanup` (recordings/ai_tasks/logs theo chính sách), `billing.reconcile` (S7) với báo cáo gửi email.
3. Phân tích sản phẩm (`analytics`)
   - Phễu & giữ chân: activation (chẩn đoán xong trong 24 giờ), D1/D7/D14 retention, phiên học/tuần, số câu/người, explain/người, tỷ lệ 👍, NPS (khảo sát in-app ngày 7 và 14), chuyển đổi trial→trả phí giả lập (hỏi ý định mua + thử checkout sandbox), lỗi/crash (Sentry), hiệu năng thực (Web Vitals RUM qua PostHog/Sentry).
   - Dashboard beta trong Grafana/PostHog + báo cáo tuần tự động (Markdown sinh bằng script `pnpm report:beta` từ DB replica và PostHog API) gửi email ban điều hành.
   - Sự kiện analytics qua outbox → bảng `analytics` (nếu có) hoặc PostHog; định nghĩa sự kiện trong `docs/analytics/events.md`.
4. Hoàn thiện (polish) theo phản hồi
   - Ngân sách 40 % sprint cho sửa lỗi/cải tiến từ beta theo thứ tự: chặn học → sai điểm → UX thi → hiệu năng → thẩm mỹ; mỗi sửa có test hồi quy; không thêm tính năng mới ngoài danh sách.
   - i18n: rà toàn bộ chuỗi vi/en, không chuỗi cứng (lint rule), kiểm tra tràn layout; a11y: điều hướng bàn phím toàn bộ luồng thi, screen reader cho đáp án, contrast.
   - Pháp lý: trang Điều khoản/Chính sách riêng tư/Chính sách hoàn tiền/đồng ý xử lý giọng nói (chuẩn bị GĐ2) rà bởi luật sư (nội dung placeholder có ghi chú nếu chưa có), tuyên bố không liên kết ETS trên trang TOEIC, cookie consent (S10).
5. Báo cáo GATE-2 (`docs/gates/GATE-2-report.md`)
   - Số liệu beta vs mục tiêu (activation ≥ 60 %, D7 ≥ 35 %, NPS ≥ 30, tỷ lệ 👍 explain ≥ 80 %, crash-free ≥ 99,5 %, SLO đạt, chi phí AI/người/tháng), bài học, danh sách lỗi mở theo mức, rủi ro, đề xuất phạm vi GĐ2 (IELTS Reading/Listening, chấm Writing/Speaking, shadowing, i18n en), ước tính chi phí hạ tầng/AI cho 10.000 người.
   - Checklist "sẵn sàng ra mắt công khai" (còn thiếu gì cho GĐ2) và handoff đầy đủ.

## Phạm vi — NGOÀI
Ra mắt công khai, marketing trả phí, IELTS, chấm AI Writing/Speaking, app mobile, B2B.

## Đầu vào
DDL: `ops.feedback/content_reports/support_tickets/audit_logs`, `billing.feature_flags`, `analytics` (nếu có). OpenAPI: nhóm Admin (users, flags, reports), `/ai/feedback`. PRD mục KPI/mục tiêu beta; Thiết kế kỹ thuật mục 9 (SLO), 12 (GATE-2).

## Các bước
1. Beta gate + mời theo đợt + onboarding khảo sát + kênh phản hồi.
2. Content report/support ticket + admin hỗ trợ.
3. Admin tổng hợp (người dùng, nội dung, AI, hệ thống) + jobs vận hành.
4. Analytics events + dashboard beta + `pnpm report:beta`.
5. Mở beta đợt 1 (50) → theo dõi 3 ngày → đợt 2–6; sửa lỗi theo ngân sách; i18n/a11y/pháp lý rà soát.
6. Báo cáo GATE-2 + HANDOFF cuối GĐ1 + nhãn `v0.9.0-beta`.

## Tiêu chí nghiệm thu
- [ ] 300 lời mời gửi theo đợt; người không có mã không vào được app (landing vẫn xem được); tester nhận Pro trial + credit đúng.
- [ ] Góp ý in-app tạo `ops.feedback` kèm trace_id và ảnh; báo lỗi câu tạo `content_reports` xuất hiện trong CMS; ticket được trả lời từ admin và người dùng nhận email/in-app.
- [ ] Admin khoá tài khoản → mọi phiên bị thu hồi trong 60 s; impersonate chỉ đọc có audit; DLQ replay hoạt động.
- [ ] `pnpm report:beta` sinh báo cáo tuần có đủ KPI, số khớp PostHog/DB (±2 %).
- [ ] Sau 2 tuần beta: SLO đạt, crash-free ≥ 99,5 %, không lỗi "chặn học" mở > 48 giờ; lint i18n 0 chuỗi cứng; a11y luồng thi đạt.
- [ ] `docs/gates/GATE-2-report.md` đầy đủ số liệu thật, đề xuất GĐ2, checklist còn thiếu; tag `v0.9.0-beta`; CI xanh; `pnpm api:diff`/`db:diff` xanh.

## Kiểm thử bắt buộc
Unit: beta gate, content stats job. Integration: feedback/report/ticket flows, admin actions có audit, analytics outbox. E2E: luồng tester từ email mời → onboarding → thi → góp ý. Regression: toàn bộ E2E GĐ1 chạy xanh trước tag.
```

---

## D. Checklist nghiệm thu GATE-2 (tổng hợp từ S1–S12)

| # | Hạng mục | Bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 1 | Luồng người học TOEIC L&R đầy đủ: đăng ký/OAuth/OTP → chẩn đoán → lộ trình → thi full 200 câu → review → explain/tutor → từ vựng FSRS → sổ lỗi → dashboard | Playwright E2E xanh + demo staging | ☐ |
| 2 | Nội dung: ≥ 10 đề full L&R + 30 mini + 60 part drill tự biên soạn qua workflow 2 lớp, ≥ 3.000 câu published, 0 nội dung sao chép | Báo cáo CMS, kiểm tra ngẫu nhiên 50 câu | ☐ |
| 3 | AI: explain eval ≥ 4/5, 👍 ≥ 80 %, guard recall ≥ 98 %, chi phí/người/tháng trong dự toán, fallback hoạt động | `GET /admin/eval-runs`, dashboard AI | ☐ |
| 4 | Billing: 3 cổng sandbox + hoá đơn điện tử, đối soát 0 lệch, gating server-side, referral/khuyến mãi | Báo cáo reconcile, test ma trận | ☐ |
| 5 | Phi chức năng: SLO đạt 2 tuần, k6 5.000 CCU đạt, pentest 1 không còn high, restore PITR diễn tập | Grafana, `docs/perf`, `docs/security`, `docs/runbooks` | ☐ |
| 6 | Tuân thủ: điều khoản/riêng tư/hoàn tiền, cookie consent, xoá dữ liệu 72 giờ, log không PII, disclaimer thương hiệu | Rà soát pháp lý, test redaction | ☐ |
| 7 | Beta: activation ≥ 60 %, D7 ≥ 35 %, NPS ≥ 30, crash-free ≥ 99,5 % | `docs/gates/GATE-2-report.md` | ☐ |
| 8 | Kỹ thuật: CI xanh, `db:diff`/`api:diff` xanh, coverage domain ≥ 80 %, ADR/HANDOFF/runbooks đủ, tag `v0.9.0-beta` | GitHub | ☐ |

---

## E. Ghi chú vận hành bộ prompt

- **Thứ tự & phụ thuộc:** S3 cần S2 (nội dung published); S5 cần S3–S4 (attempt để giải thích/chẩn đoán); S7 cần S5 (quota/credit); S9–S10 cần S5 (summarize) và S7 (gating); S11–S12 cần tất cả. S1 và S2 có thể chạy song song bởi hai người nếu tách nhánh `feat/iam-*` và `feat/catalog-*`.
- **Khi sprint trượt:** không gộp hai sprint vào một phiên; tách phần chưa xong thành prompt "S<n>-tiếp" bằng cách dán lại Khung chung + mục "Việc dở" trong HANDOFF + tiêu chí nghiệm thu còn thiếu.
- **Khi spec đổi:** sửa `docs/spec/*` trước (DDL/OpenAPI/prompts), chạy `db:diff`/`api:diff`, rồi mới dán prompt sprint; ghi phiên bản spec trong HANDOFF.
- **Sau GATE-2:** bộ prompt GĐ2 (S13–S20: IELTS Reading/Listening, pipeline chấm Writing/Speaking, Speech Service & shadowing, LiveKit, lesson engine, plan v2, i18n en, pentest 2) sẽ được soạn tiếp dựa trên HANDOFF cuối S12 và báo cáo GATE-2.
