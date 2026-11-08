# @allingo/web — ứng dụng web Allingo (Next.js 16, App Router)

## Chạy

```bash
pnpm i                                  # ở gốc repo (một lần)
cp .env.example .env                    # gốc repo; web đọc NEXT_PUBLIC_*
pnpm --filter @allingo/web dev          # http://localhost:3000 (cần API ở NEXT_PUBLIC_API_URL)
pnpm --filter @allingo/web dev:mock     # chạy KHÔNG cần API: fetch giả lập trong src/mock (NEXT_PUBLIC_API_MOCK=1)
pnpm --filter @allingo/web build        # prebuild đóng gói service worker → public/sw.js rồi next build (Turbopack)
pnpm --filter @allingo/web typecheck && pnpm --filter @allingo/web lint && pnpm --filter @allingo/web test
pnpm --filter @allingo/web test:e2e     # Playwright (tự bật next dev với mock); E2E_REAL_API=1 để chạy với API thật
```

Biến môi trường (validate bằng Zod trong `src/env.ts`):

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/v1` | Base URL API (cookie-mode: `credentials: include`, tự refresh khi 401) |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL web |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | `vi` | Locale mặc định (`vi`, `en`) |
| `NEXT_PUBLIC_API_MOCK` | `0` | `1` → dùng `src/mock/mock-fetch.ts` thay API (chỉ dev/e2e; mã mock bị tree-shake ở production) |
| `E2E_CHROME_CHANNEL` | – | `chrome` để Playwright dùng Google Chrome cài sẵn khi không tải được Chromium |
| `E2E_BASE_URL` + `E2E_NO_SERVER=1` | – | Chạy e2e với server có sẵn (vd. bản `next start -p 3100` để kiểm tra PWA/offline trên production) |
| `E2E_CHROME_ARGS` | – | Tham số Chrome thêm, vd. `--disable-web-security` khi web chạy ở cổng ngoài `CORS_ORIGINS` của API (:3100) |
| `NEXT_PUBLIC_COMMUNITY_ZALO_URL` / `NEXT_PUBLIC_COMMUNITY_DISCORD_URL` | – | S12: kênh phản hồi cộng đồng beta ở onboarding (chỉ nhận `https://`; trống/sai → ẩn) |
| `E2E_SMTP_PORT` | `1025` | S12 E2E API thật: cổng SMTP sink cục bộ đọc email mời beta (trùng `SMTP_PORT` dev của API; cần cổng còn trống) |
| `E2E_DATABASE_URL` | `DATABASE_URL` của `.env` gốc | E2E API thật dùng psql cho DB dev (lùi thời gian thanh toán S8; cấp/gỡ vai trò admin tạm cho E2E MFA S12) |

## Cấu trúc

```
src/app/[locale]/(marketing)   landing, /login, /signup          (SSG, header/footer marketing)
src/app/[locale]/(app)         AuthGate (GET /me 401 → về landing)
  (shell)/toeic/dashboard, toeic/test-sets, settings, settings/notifications, notes, attempts/[id]/result|review   (AppShell)
  (exam)/attempts/[id]         Exam/Practice Mode toàn màn hình (không header app)
src/app/[locale]/offline       trang fallback offline của service worker
src/app/manifest.ts, src/app/sw.ts   PWA (manifest + service worker Serwist runtime)
src/i18n                       routing/navigation/request của next-intl; messages ở packages/i18n/src/messages
src/lib                        api.ts (client singleton + mock injection), auth.ts (guest token), queries.ts (hooks typed theo Zod), errors.ts
src/features/<màn hình>        attempt (clock, draft-queue, renderers…), review (SSE explain), result, dashboard, test-sets, settings, auth
src/mock                       fixtures tự biên soạn + "máy chủ" giả lập (localStorage) bám hợp đồng OpenAPI/Zod
e2e/guest-flow.spec.ts         luồng khách → đề mini → nộp → kết quả → xem lại → giải thích → đăng ký ghép tiến độ
e2e/exam-offline.spec.ts       Thi Part 5: offline giữa chừng → IndexedDB → online/tải lại/đóng tab → nộp → chẩn đoán → lọc câu sai
e2e/exam-layout.spec.ts        Reading Part 5–7: thanh Part, đoạn văn + thanh kéo, nhóm câu, tập trung, cỡ chữ (mock: toeic-reading-mini-01, API: toeic-reading-full-01)
e2e/ai-explain.spec.ts         AI (S5): Review → Giải thích SSE (chữ hiện dần) → 👍 + ghi chú → tải lại "Giải thích có sẵn" + đánh giá được nhớ/cập nhật,
                               lỗi AI + Thử lại (mock), lần explain thứ 11 → 429 (còn 0, giờ reset VN, toast, CTA → /pricing), kết quả: Free thẻ khoá,
                               Pro tạo "Phân tích của AI" → tải lại vẫn hiện, trang đề thi "Đề đầy đủ còn y lượt tháng này"
e2e/tutor.spec.ts              Gia sư (S6): Review → "Hỏi gia sư" → "Vì sao đáp án C sai?" → SSE + trích dẫn (bấm cuộn tới câu) + 👍 → tải lại
                               tiếp tục đúng thread, danh sách thread; injection → thông điệp từ chối; lỗi AI + Gửi lại (mock); đang thi → 403/ẩn nút
e2e/dictionary.spec.ts         Tra từ (S6): nhấp đúp "invoice" → IPA/nghĩa/ví dụ/phát âm, chữ dở → gợi ý, thêm 5 từ vào SRS, câu dài → dịch AI,
                               tải lại → "Bản dịch có sẵn"; Practice có tra từ, Exam Mode không
e2e/notes.spec.ts              Ghi chú (S6): tự lưu (POST → PATCH), Markdown, tải lại vẫn hiện, "Ghi chú của tôi" tìm kiếm/mở câu/sửa/xoá, 2.000 ký tự
e2e/pwa.spec.ts                PWA (S6): manifest, SW (dev: cờ allingo.sw.dev), cache không có API, offline → trang offline + đề đã xem (danh sách
                               chỉ kiểm tra trên bản production), banner cài đặt lần 2, Web Push (grantPermissions; headless không có dịch vụ push →
                               PushManager giả) + SW hiện thông báo qua CDP ServiceWorker.deliverPushMessage
e2e/checkout.spec.ts          Billing (S7/S8): đăng ký → /pricing WELCOME20 xem trước giá → checkout (MST doanh nghiệp kiểm tra như server) → cổng giả
                               `paid` → kết quả `paid` (polling/Socket.IO) → Pro + ledger + hoá đơn; `failed` → Thử lại → `paid`; `paid-drop` → reconcile
                               (API thật: lùi `billing.payments.created_at` bằng psql + admin chạy job; mock: `__ALLINGO_MOCK__.runJob`) → `paid`
e2e/referral.spec.ts          Referral (S8): A lấy link → B mở link (API: /v1/r/{code}; mock: /r/{code} web) → /register?ref= → joined của A = 1
e2e/notifications.spec.ts     Thông báo (S8): chuông realtime (redeem PRO7DAY qua API → notification.new) → đọc tất cả; /notifications/manage?token=
                               (token HMAC tự ký trong test: API thật đọc AUTH_SECRET/.env dev, mock khoá cố định) → huỷ email học tập → cài đặt
e2e/admin-billing.spec.ts     Admin (S8): học viên không vào được; admin cấp 100 credit (ghi chú bắt buộc) → ledger admin_adjust; hoàn tiền đơn
e2e/listening.spec.ts          Listening (S4): "Bắt đầu nghe", phát một lần không tua/tạm dừng, chuyển câu theo audio, tải lại tiếp tục, URL 403 → gia hạn,
                               Practice tua/tốc độ/lặp, timed_drill, L&R → Reading, kết quả L/R/Tổng, Review transcript (mock: toeic-listening-mini-01,
                               toeic-lr-mini-01; API: toeic-listening-01-drill-part1, toeic-mini-lr-01)
e2e/onboarding.spec.ts         Lộ trình (S9): người mới → thẻ mời ở dashboard → onboarding 4 bước (ngày thi quá khứ bị chặn, múi giờ mặc định trình duyệt)
                               → chẩn đoán (tải lại tiếp tục đúng câu, không đúng/sai, mock lên mức 2) → kết quả ± khoảng, mastery, mục tiêu khả thi
                               → tạo lộ trình 8 tuần (PRO7DAY để xem mọi tuần), tuần cuối có full test
e2e/plan.spec.ts               Hôm nay → mở drill từ task (plan_task_id) → nộp → "Về Hôm nay" → task done + chuỗi 1 ngày + XP; đổi ngày bằng menu
                               "Chuyển sang" + kéo thả (desktop), PATCH sang tuần khác → 400, tuần 2 khoá (Free); check-in "tuần này bận, chỉ 2 giờ"
                               → đề xuất ready (diff) → Áp dụng → tuần tới ≤ 120 phút, đề xuất applied (áp lại → 200)
e2e/badges.spec.ts             Huy hiệu: lưới 6 huy hiệu + tiến độ, bài luyện đầu tiên → toast "Huy hiệu mới: Bài đầu tiên" (realtime); mock dựng chuỗi
                               6 ngày (`__ALLINGO_MOCK__.seedStreak`) → "7 ngày liên tiếp"; XP/cấp
packages/ui/src                component dùng chung (Button, Card, Dialog/Sheet, Tabs, ToggleChip…) + styles.css (token navy/gold)
```

## Ghi chú kỹ thuật

- **PWA**: `@serwist/next` chỉ hỗ trợ webpack, Next 16 build bằng Turbopack nên service worker được đóng gói riêng bằng esbuild (`scripts/build-sw.mjs`, chạy ở `prebuild`). SW precache shell + cache ảnh/audio (stale-while-revalidate), **không cache API**; chỉ đăng ký ở production (bản dev: đặt `localStorage['allingo.sw.dev'] = '1'`, SW nhận `?dev=1`).
  Chi tiết S6 ở mục "Sprint 6" bên dưới.
- **Exam Mode (Sprint 3)**: màn một trang `features/attempt` – thanh Part (`[`/`]`), lưới câu theo Part (đã trả lời/đánh dấu/đang xem), Part 6–7 đoạn văn trái – câu hỏi phải với thanh kéo `SplitPane` (`@allingo/ui`, bàn phím ←/→/Home/End/Enter; mobile xếp dọc, đoạn văn thu gọn được), câu cùng `group_key`/passage hiển thị chung đoạn văn (`[Nhãn]` → tiêu đề phụ, mốc `[131]` tô sáng theo câu đang xem), chế độ tập trung (Z/Esc), cỡ chữ 3 mức (+/−, lưu `localStorage` `allingo.exam.prefs`, bọc try/catch); phím tắt 1–4/A–D, ←/→, F.
- **Đồng hồ**: tính từ `expires_at` + `server_time`; cảnh báo 10′/5′/1′ bằng toast + vùng `aria-live`; hết giờ tự nộp. `PUT /answers` trả 409 (quá hạn + 30 s, hoặc đã nộp) → hàng đợi đóng, nộp (idempotent) rồi mở kết quả.
- **Offline**: `DraftQueue` gộp lô (debounce 0,8 s, 10 s/lần, khi đổi câu/ẩn tab) và giữ nháp chưa gửi trong **IndexedDB** `allingo-drafts/drafts` (fallback bộ nhớ khi IndexedDB không dùng được; tự chuyển nháp localStorage của bản cũ). Màn làm bài chỉ dựng sau khi khôi phục xong; nháp + câu đang xem (`ui_state.current_question_id`) cục bộ đè dữ liệu server. Banner "Mất kết nối…" / "Đang lưu lại…". Sự kiện phiên: `tab_hidden`, `focus_lost`, `resume`, `part_switch`.
- **Practice/drill**: chọn đáp án (mcq_single) → lưu ngay → `GET /attempts/{id}` lấy `feedback` → hiện đúng/sai, đáp án, giải thích tác giả; câu đã kiểm tra bị khoá. Dạng khác dùng nút "Kiểm tra đáp án". Không đồng hồ (trừ `timed_drill`).
- **Kết quả/Xem lại**: khối Chẩn đoán từ `diagnosis` (Part/kỹ năng con/chủ đề yếu, cờ → câu nhận xét, gợi ý → `/toeic/practice?section=…&subskill=…`, trang practice đọc query để chọn sẵn); thang 5–495/10–990 ghi rõ "ước tính". Xem lại lọc bằng tham số API `only_wrong/flagged/section`, trạng thái lọc trên URL (`?filter=wrong&section=part5`), nút "Câu sai trước/tiếp theo".
- **Listening Exam Mode (Sprint 4)** – `features/attempt/listening/`: `program.ts` dựng chuỗi bước từ câu `listen_policy = 'once'`
  (Part 1/2: audio câu → `pause_ms`; Part 3/4: audio nhóm → audio câu hỏi + `pause_ms` mỗi câu), `sequencer.ts` là máy trạng thái thuần
  (gate → loading → playing/stalled → pause → … → done, chỉ đi tới), `listening-engine.ts` gắn với DOM: 3 phần tử `<audio>` xoay vòng
  (bước đang phát + preload 2 tệp), không `controls`, chặn tạm dừng/tua từ ngoài (phím media – Media Session, devtools/tiện ích → phát
  tiếp/trả về vị trí), stalled/mất mạng → chờ có mạng → gia hạn URL → nạp lại đúng vị trí, sự kiện `audio_started/ended/stalled`
  (nhóm gửi `question_id` câu đầu nhóm). Bắt buộc bấm "Bắt đầu nghe" (autoplay; Safari: mở khoá cả nhóm phần tử trong cùng cử chỉ).
  Vị trí lưu `localStorage` `allingo.listening.<attemptId>` (bước + ms) mỗi giây; tải lại → "Tiếp tục nghe" từ đúng ms; mất bản cục bộ →
  suy từ `attempt.audio_plays` (sau bước audio cuối đã bắt đầu, không phát lại). Câu chưa phát bị khoá chọn đáp án; người học rời câu
  đang phát → ngừng tự chuyển, nút "Về câu đang nghe". Hết Listening → chuyển sang câu Reading đầu tiên (đề L&R).
  E2E tăng tốc bằng `window.__ALLINGO_AUDIO_RATE__` (chỉ bản dev; production luôn 1).
- **URL ký 10′** – `use-media-urls.ts`: gom URL theo asset id (`media[].id`, `passage.media_asset_id`), hẹn `GET /attempts/{id}/media`
  khi URL sớm nhất còn ≤ 2′, khi tab hiện lại/có mạng lại, hoặc khi audio lỗi (403); phần tử đang phát giữ src cũ (không cắt ngang),
  phần tử preload/trình phát tự do đổi src giữ vị trí. Dùng cho màn làm bài và Xem lại.
- **Practice/Review Listening**: `AudioPlayer` tự do (phát/tạm dừng, thanh tua + ←/→ 5 s khi focus, tốc độ 0,75/1/1,25, lặp); Part 3/4 có
  trình phát cả nhóm ở đầu nhóm. Transcript (`review/transcript.tsx`) chỉ sau khi nộp (Review) hoặc sau khi trả lời (practice, API trả
  `feedback.transcript`): nhãn người nói M/W/N, tô dòng đang phát theo `segments`, tô `evidence`. Đề bài có bảng markdown (graphic) →
  `question-stem.tsx`. Part 1/2 (API xoá chữ khi đang làm bài) → hướng dẫn chung qua i18n.
- **timed_drill**: trang Luyện tập "Tính giờ từng câu" (+ `per_question_sec`); màn làm bài đếm ngược từng câu (ngân sách = tổng giờ / số câu),
  hết giờ câu → sang câu kế một lần; Listening trong timed_drill do chuỗi phát điều khiển.
- **Kết quả L&R**: thẻ Listening / Reading / Tổng + khoảng ước tính từ `AttemptResult.scaled` (ghi rõ "ước tính, không phải điểm chính
  thức ETS"), breakdown Part 1–7 nhóm theo kỹ năng (`by_skill`), thời gian TB so cộng đồng.
- **Kiểu dữ liệu**: ưu tiên Zod trong `packages/schemas` (đầy đủ hơn OpenAPI đã sinh); `GET /attempts/{id}/result` mới thêm (SPEC-ISSUES S8) nên path được ép kiểu cho tới khi chạy `pnpm client:gen`.
- **AI (Sprint 5)** – `lib/ai-stream.ts` (thuần, có test): `sseToAction` đọc định dạng AI Gateway `start {ai_task_id, cached}` → `delta {text}`* →
  `result {data, ai_task_id, cached}` → `done` / `error {code: ai_failed|ai_timeout}`, `aiStreamReducer` (idle → connecting → streaming →
  done | error; luồng đóng khi chưa có `result` = lỗi), `extractJsonStrings`/`streamPreview` trích chữ từ JSON structured output ĐANG stream
  (delta của provider là mảnh JSON) để hiện dần `why_correct`, `how_to_spot`… thay vì JSON thô. Dùng chung cho `POST /ai/explain` (cache hit =
  JSON) và `POST /attempts/{id}/diagnosis`.
- **Giải thích (Review)** – `review/use-explain.ts` + `explain-panel.tsx`: nhãn "Giải thích có sẵn" khi `cached`; lỗi AI → thông báo i18n + Thử lại;
  429/402 → `QuotaExceededNotice`/`CreditsNotice` (đã dùng/giới hạn, còn lại, "Lượt mới lúc 00:00 ngày mai (giờ Việt Nam)", CTA → `/pricing`);
  403 `exam_mode_locked` → ẩn nút (Review cũng hỏi `/me/attempts?status=in_progress&mode=exam` để ẩn trước + banner "Tiếp tục bài thi").
  Đánh giá 👍/👎/Sai + ghi chú (`explain-feedback.tsx`) → `POST /ai/feedback`; lựa chọn nhớ trong `localStorage` `allingo.ai-feedback.v1`
  theo `ai_task_id` + khoá nội dung (question_version × chosen × locale × prompt_version) vì giải thích cache có `ai_task_id` mới/null → tải
  lại vẫn thấy lựa chọn, đổi đánh giá gửi lại ĐÚNG ai_task_id cũ (API cập nhật). Giải thích kèm Review (`ai_task_id = null`) → khi đánh giá
  gọi lại `/ai/explain` (trúng cache, không trừ lượt) để lấy ai_task_id.
- **Phân tích của AI (kết quả)** – `result/ai-diagnosis-card.tsx` + `use-ai-diagnosis.ts`: `GET /attempts/{id}/diagnosis` (404 = chưa có) →
  nút tạo (SSE) → dạng sai nhiều nhất (`part5:word_form` → "Part 5 · Dạng từ"), bằng chứng, lý do, 3 bước, câu tự kiểm tra (chọn → đúng/sai),
  lời động viên; Free (thiếu quyền `ai_diagnose` trong entitlements hoặc 403 `details.upgrade`) → thẻ khoá + CTA; 409/402/429/403 Exam → thông báo
  riêng. Khối chẩn đoán theo quy tắc (S3) giữ nguyên phía trên.
- **Hạn mức (chỉ hiển thị)** – `lib/quota.ts` + `features/quota/*`: `quotaOf` (ưu tiên `remaining` của API), `parseQuotaExceeded` (`details.quota`,
  `resets_at`/`reset_at`), `resetParts` định dạng theo **Asia/Ho_Chi_Minh** (so ngày theo giờ VN, không theo múi giờ máy). "Còn x lượt giải thích
  hôm nay" ở dashboard + Review, "Đề đầy đủ còn y lượt tháng này" ở trang Đề thi. 429 từ mọi query/mutation (QueryCache/MutationCache) hoặc luồng
  AI → sự kiện `allingo:quota-exceeded` → `QuotaToastListener` (trong layout (app)) hiện một toast + nút Nâng cấp và làm mới entitlements.
  Server luôn kiểm tra lại (CLAUDE.md §5.7). `/pricing` là trang placeholder (billing S7).
- **Listening `ui_state` (S5)** – chuỗi phát lưu vị trí `localStorage` mỗi giây (lớp nhanh) VÀ đẩy `ui_state.listening = {step, offset_ms}` vào hàng
  đợi nháp (đổi bước → ngay, trong bước ≤ 3 s/lần; gửi theo nhịp PUT /answers). Tải lại: chọn bản **tiến xa hơn** (chuỗi chỉ đi tới) giữa bản cục bộ,
  bản chưa gửi trong IndexedDB và `GET /attempts/{id}.ui_state.listening`, rồi đối chiếu `audio_plays` như S4 (`program.ts`: `parseServerCursor`,
  `newerCursor`, `toServerCursor`).
- **Mock S5** – SSE đúng định dạng mới (delta = mảnh JSON), cache hit trả `ai_task_id` mới, Review kèm giải thích `ai_task_id = null`, `POST /ai/feedback`
  (chủ tác vụ, gửi lại = `updated: true`), entitlements `remaining` + `reset_at` 00:00 giờ VN, 429 `details.quota` sau 10 lượt explain/ngày (Free),
  chẩn đoán AI POST/GET (Pro demo `learner_pro@allingo.dev` / `Allingo@2026` tự tạo; Free → 403 upgrade; 10 credit), `ui_state` validate bằng Zod,
  timed_drill cộng thời lượng audio. Kịch bản lỗi AI: `window.__ALLINGO_MOCK_AI_FAIL__ = 'ai_failed' | 'ai_timeout'` (lượt AI kế tiếp lỗi, hoàn quota).

## Sprint 6 – gia sư AI, tra từ, ghi chú, PWA

- **Gia sư** – `features/tutor/`: `chat-state.ts` (reducer thuần, có test: send → start → delta (văn bản thuần của `reply_markdown`) →
  result thay toàn bộ chữ stream + id server + `turns`; lỗi HTTP trước stream / `error` trong luồng / đóng khi chưa có `result`; gửi lại),
  `use-tutor-chat.ts` (thread tạo khi gửi tin đầu – không tạo thread rỗng; `GET /ai/threads/{id}` + tải tin cũ qua `/messages?cursor`),
  `tutor-provider.tsx` (trong AppShell; `openTutor(ctx)` từ câu ở Review → tiếp tục thread gần nhất cùng `question_version_id`/attempt, không
  thì hội thoại mới; Dashboard → tự do; giữ hội thoại khi đóng/mở lại), `tutor-panel.tsx` (tải lười; desktop trượt phải không chặn trang,
  mobile toàn màn hình; Esc đóng, trả focus; gợi ý "Vì sao X sai?", "Cho ví dụ khác" + `suggested_followups`; trích dẫn → cuộn tới
  `div[data-qv]` của Review hoặc mở `/attempts/{id}/review?focus=<qv>`; 👍/👎 → `/ai/feedback`; bộ đếm lượt thread (`turns`), thread không
  giới hạn → hạn mức ngày `ai_tutor`; 429 `scope=thread` → "Hội thoại này đã hết lượt" + tạo mới; 429 ngày/402 → thông báo hạn mức chung;
  từ chối → `tutor.refusal.<code>`; lỗi `guard_unavailable` có thông điệp riêng). Markdown hiển thị bằng `lib/markdown.ts` (parse thuần, không HTML).
- **Tra từ** – `features/dictionary/`: vùng tra từ đánh dấu `data-lookup` (đề bài `QuestionStem`, đoạn văn `PassagePane`, transcript, dẫn chứng,
  đoạn văn Review); `LookupLayer` (một lớp mỗi trang: Review, màn làm bài khi mode practice/drill) nghe nhấp đúp / bôi đen (mouseup) / thả Shift /
  `selectionchange` (thiết bị cảm ứng – chạm giữ), `selection.ts` (thuần: 1 từ / cụm 2–4 / câu > 4 → `ai=always`, câu ngữ cảnh ≤ 300 ký tự),
  popover cạnh vùng chọn (mobile: tấm dưới đáy), `lookup-card.tsx` (IPA US/UK + phát âm `audio_url` hoặc `GET /tts` giọng en-US/en-GB, nghĩa,
  ví dụ, collocations, gợi ý khi gõ sai, nhãn "AI dịch – cần kiểm tra" khi `needs_review`, "Bản dịch có sẵn" khi `cached`, nút SRS
  `POST /me/srs/cards` theo `vocab_item_id` hoặc headword). Không mở khi Exam Mode / có bài thi đang làm.
- **Ghi chú** – `features/notes/`: `autosave.ts` (debounce 0,8 s, lưu nối tiếp POST → PATCH, lỗi giữ để "Lưu lại", có test), `note-editor.tsx`
  (Review: mỗi câu một ghi chú từ `ReviewItem.note`; xoá hết chữ = DELETE; tối đa 2.000 ký tự; Exam Mode → chỉ đọc), trang `/notes`
  ("Ghi chú của tôi": tìm kiếm debounce, cursor, mở câu trong bài xem lại, sửa/xoá tại chỗ).
- **Khoá Exam Mode** – `lib/exam-lock.ts`: `useExamLock()` = có attempt exam `in_progress` (`/me/attempts`) HOẶC một 403 `exam_mode_locked` mới
  hơn lần tải danh sách (bài thi mở ở tab/thiết bị khác) → ẩn gia sư/tra từ/ghi chú/giải thích + `ExamLockBanner` ("Tiếp tục bài thi").
- **PWA** – manifest (`app/manifest.ts`: id, scope, shortcuts, icon 192/512/maskable), SW `app/sw.ts` + quy tắc thuần `lib/pwa/sw-routes.ts`
  (có test: API – kể cả media ký trên origin API, SSE, `/api/*` – luôn NetworkOnly; `_next/static` CacheFirst; ảnh/audio SWR; điều hướng mạng →
  lỗi thì chuyển sang `/vi|en/offline#from=<đường dẫn>`). Trang offline được SW tự lưu đúng URL lúc cài (không qua precache Serwist vì
  `?__WB_REVISION__` làm Next không hydrate) kèm JS/CSS đọc từ HTML; danh sách "đề đã xem" (`features/offline/viewed-store.ts`, chỉ tên đề +
  đường dẫn) ghi ở màn làm bài/kết quả/xem lại. Banner cài đặt (`features/pwa/install-banner.tsx`) sau 2 lượt truy cập (beforeinstallprompt; iOS:
  hướng dẫn Chia sẻ → Thêm vào MH chính, "Để sau" 14 ngày). Web Push (`features/pwa/use-push.ts`): chỉ xin quyền khi bấm → VAPID →
  `pushManager.subscribe` → `POST /me/push-subscriptions`; SW xử lý `push` (title/body null → chuỗi `push.<template>` nhúng lúc build SW từ
  `packages/i18n`) và `notificationclick` (chỉ đường dẫn cùng origin, thêm locale). Trang `/settings/notifications`: kênh, giờ yên lặng, giờ nhắc
  học, thiết bị đã đăng ký.
- **Mock S6** – `src/mock/learning-tools.ts` + `src/mock/dictionary.ts` (20 từ tự biên soạn: invoice, shipment, delivery…; từ khác → "AI dịch mô
  phỏng" có cache), threads SSE (từ chối `injection` khi tin chứa "ignore previous instructions"), lượt/thread Free 20, TTS (wav demo), SRS idempotent,
  ghi chú (lọc HTML như API), push (khoá VAPID giả hợp lệ), Exam Mode 403. `window.__ALLINGO_MOCK_SYNC__ = true` → mock đọc lại trạng thái từ
  localStorage trước mỗi yêu cầu (e2e nhiều tab dùng chung "máy chủ").
- **Lighthouse (S6, 2026-11-02)** – bản `pnpm build && next start -p 3100`, `/vi/toeic/dashboard` đăng nhập khách (hồ sơ Chrome tạo sẵn
  phiên + `--disable-storage-reset`; `--disable-web-security` vì API chỉ CORS :3000), Chrome for Testing 153: Lighthouse 13.6 mobile
  Performance 74–76 (TBT 1,2–1,6 s, LCP 0,6–0,8 s, CLS 0,013), desktop 97; Accessibility 100; Best practices 100; SEO 100.
  Lighthouse 11.7.1 (còn hạng mục PWA): installable-manifest, maskable-icon, splash, themed-omnibox đều đạt. Đã sửa: thứ tự tiêu đề
  dashboard (h2 ẩn), `<dl>` sai cấu trúc ở thẻ đề, nút gia sư giữ chỗ khi chờ (CLS).
- **Giới hạn đã biết**: bản `next dev` không hydrate được HTML trang offline lưu sẵn (HTML dev mang request id kênh debug `self.__next_r`) → e2e
  kiểm tra danh sách đề đã xem trên bản production; Chrome headless không có dịch vụ push (`Registration failed - permission denied`) → e2e dùng
  PushManager giả để kiểm tra luồng đăng ký với API và CDP để kiểm tra SW hiển thị thông báo.

## Sprint 7 + 8 – billing, khuyến mãi, hoá đơn, referral, thông báo, billing admin (giao diện)

- **Lớp API** – `lib/billing-api.ts` (gói/cổng/khuyến mãi/đơn/pay/subscription/ledger), `lib/growth-api.ts` (referral, thông báo, trang
  quản lý theo token), `lib/admin-api.ts` (billing admin); validate bằng Zod của `@allingo/schemas` (`lib/zod-parse.ts`). Hàm thuần có test:
  `lib/billing.ts` (VND, `priceView` – giá sau mã do SERVER tính, `groupPlans`, `validateBuyer` dùng đúng `buyerInfoSchema`/`normalizeVnTaxCode`
  của server, lỗi `details.promotion.reason`/`details.issues`, nhịp polling 2 → 5 → 10 s, `safeNextPath`).
- **Bảng giá `/pricing`** (`features/pricing`): tab chương trình, thẻ Free / Pro (tháng · năm · trọn đời, `compare_at` + % tiết kiệm, ≈ giá/tháng) /
  Combo, gói credit; mã khuyến mãi xem trước giá cho mọi gói (`POST /promotions/validate` – cần đăng nhập; khách/chưa đăng nhập → mời đăng ký);
  mã đổi trực tiếp (trial/credit) → nút "Kích hoạt"; "Dùng thử Pro 7 ngày" (`PRO7DAY`, chỉ hiện khi server nói còn đổi được); bảng so sánh đọc
  `FEATURE_GATES` + `plans[].features` (không số cứng; hạn mức hiển thị từ `/me/entitlements` của chính người dùng). Chưa đăng nhập / khách →
  `/signup?next=/checkout?...` (`AuthForm` đọc `?next=` lúc đăng nhập xong, chỉ đường dẫn nội bộ).
- **Checkout `/checkout?price_id=&promo=`** (`features/checkout`): cổng từ `GET /payments/providers` (ẩn khi `checkout_enabled=false`), mã (lý do
  i18n `billing.promoReason.*`), hoá đơn cá nhân/doanh nghiệp (MST kiểm tra khi rời ô + khi gửi), điều khoản; Idempotency-Key ổn định mỗi phiên
  (`checkout-session.ts`, sessionStorage theo price_id; 409 → xoay khoá) → `/pay` → redirect / QR (`payment-qr.tsx`, polling) / deeplink.
  `/checkout/result` CHỈ hiển thị: `GET /orders/{id}` polling + Socket.IO `order.updated`; `paid` → làm mới entitlements/credit/subscription/
  thông báo, xoá khoá phiên; `failed|cancelled` còn hạn → "Thử thanh toán lại".
- **Tài khoản → Thanh toán** `/account/billing?tab=plan|orders|credits` + `/account/orders/{id}` (đích của thông báo `billing.order_paid`/
  `invoice_issued`): gói hiện tại + huỷ gia hạn (xác nhận, giữ tới `current_period_end`), lịch sử đơn (cursor), sổ credit (cursor), hoá đơn
  (ký hiệu, số, mã tra cứu + sao chép, PDF – URL ký 10′, hết hạn thì tải lại đơn trước khi mở). `SubscriptionBanner` trong AppShell
  (`features/billing/banner.ts`, có test): dùng thử còn N ngày / sắp hết hạn ≤ 7 ngày (chưa mua kỳ nối tiếp) / vừa hết hạn hoặc hết dùng thử.
- **Realtime** – `lib/realtime.ts`: client Socket.IO tối giản (Engine.IO v4 qua WebSocket gốc, không thêm thư viện; parser khung có test),
  cookie `allingo_at` (path `/`) đi kèm handshake, server ngắt → `GET /me` qua API client (refresh khử trùng lặp) rồi kết nối lại lũy thừa 2.
  `lib/realtime-hub.ts` (singleton) + `features/realtime/realtime-provider.tsx` trong layout (app): `order.updated`, `credits.changed`,
  `entitlements.changed`, `notification.new` → làm mới query / thêm vào hộp thông báo + toast. Mock: sự kiện window `allingo:mock-realtime`.
- **Thông báo** – `features/notifications`: chuông trong header (số chưa đọc, 99+, bảng 8 mục, đọc tất cả), trang `/notifications`, reducer
  `feed.ts` (có test) lưu trong cache TanStack; nội dung `notification-text.ts` (có test): server đã dựng cùng ngôn ngữ → dùng; không →
  dịch `notifications.templates.<template_code>` với tham số từ `payload.data` (đủ tham số bắt buộc) → dự phòng title/body server → chuỗi chung;
  `url` chỉ nhận đường dẫn nội bộ, ánh xạ `/practice` → `/toeic/practice`, `/today|/stats` (S9) → dashboard. Cài đặt `/settings/notifications`
  thêm ma trận loại × kênh (`category-matrix.tsx`); `/notifications/manage?token=&unsubscribe=` (không cần đăng nhập, mở trang không đổi gì –
  phải bấm "Huỷ đăng ký"; `noindex`).
- **Referral** – `/referral` (+ `/account/referral` cho thông báo): mã, link UTM, sao chép, Facebook/Messenger (link API), Zalo (Web Share API
  hoặc sao chép link – Zalo Share SDK cần OA id), thống kê, thưởng/trần tháng, danh sách gần đây. `/register?ref=` (và `/signup?ref=`):
  `ReferralCapture` lưu mã + UTM (`lib/referral.ts`, localStorage 30 ngày) và hiện lời mời từ `GET /referrals/{code}`; `referral_code` gửi ở
  đăng ký/OTP/Google. `X-Device-Fingerprint` (`lib/fingerprint.ts`, có test): SHA-256 của đặc điểm trình duyệt + id ngẫu nhiên
  `allingo.device_id` (không PII); preflight CORS chặn header → gửi lại không header (request chưa đi) và nhớ trong phiên. Ảnh OG tĩnh
  `public/og/referral.png` dựng bằng `node scripts/build-og.mjs` (Chromium của Playwright, `E2E_CHROME_CHANNEL=chrome`). `/r/{code}` của web
  chuyển tới `/register?ref=`.
- **Billing admin `/admin/billing[/<tab>]`** (`features/admin`, chỉ admin/superadmin: ẩn menu + chặn route phía client, server vẫn 403):
  tổng quan + đối chiếu hoá đơn tháng, đơn (lọc, hoàn tiền: lý do + thu hồi credit), thanh toán, hoá đơn, subscription, cấp/trừ credit (ghi chú
  bắt buộc, validate bằng `adminCreditAdjustInputSchema`) + sổ của người dùng, dead-letter hoá đơn + thử lại, đối soát (CSV dán/tải lên → JSON
  body, xem lệch, tải CSV qua fetch → Blob), khuyến mãi CRUD (validate bằng schema server) + thống kê, chạy job + cờ `ff.billing.checkout`.
- **Mock S7/S8** – `src/mock/billing-fixtures.ts` (gói/giá/8 mã seed như API), `billing-core.ts`, `billing.ts`, `growth.ts`: đơn + Idempotency-Key,
  cổng giả `/[locale]/mock-gateway` (`data-outcome` paid | failed | cancelled | paid-drop; 404 ở bản build không mock), xác nhận một bước (đơn →
  subscription/credit/khuyến mãi → hoá đơn phát hành ngay (PDF mẫu `public/mock/invoice-sample.pdf`) → thông báo → realtime), referral (thưởng
  200/200 khi bài đầu tiên được chấm, 500/500 khi trả tiền), thông báo in-app (title/body null → web dịch), admin đầy đủ; admin demo
  `admin@allingo.dev` / `Allingo@2026`. Hook E2E: `window.__ALLINGO_MOCK__.request(method, path, body)` (như page.request với API thật),
  `.runJob(job)` (mock bỏ ngưỡng 15′ của reconcile), `.failNextInvoice()`.
- **Sửa lỗi**: đăng xuất đôi khi kẹt spinner (`useLogout` gọi `qc.clear()` → AuthGate gỡ AppShell trước khi callback `onSettled` của `mutate()`
  chạy) → dùng `mutateAsync().finally(...)` và AuthGate tự tải lại `/me` khi query bị xoá về trạng thái pending/idle.

## Sprint 9 – chẩn đoán, lộ trình tuần, hôm nay, check-in, huy hiệu (giao diện)

- **Lớp API** – `lib/plan-api.ts` (chẩn đoán, `/me/plan*`, `/plan-tasks/{id}`, check-in, đề xuất, huy hiệu, bài học, bộ từ; Zod
  `learning-plan.ts`), hook `features/plan/queries.ts` (khoá dưới `['me','plan',program,…]` / `['me','badges',program]` để mọi
  `invalidateQueries(['me'])` có sẵn – nộp bài, đăng nhập – cũng làm mới lộ trình). Realtime `plan.updated` (hub + provider) làm mới
  lộ trình/hôm nay/đề xuất + thống kê; thông báo `learning.badge_awarded` → toast riêng "Huy hiệu mới: <tên>" (payload `badge_name`);
  link thông báo `/today` → `/toeic/today`, `/plan?proposal=` → `/toeic/plan?proposal=`, `/badges` giữ nguyên (API mới trả sẵn route web).
- **Onboarding `/onboarding`** (`features/onboarding`): 4 bước, nháp `localStorage` `allingo.onboarding.v1` (try/catch, kiểm tra như API:
  ngày thi sau hôm nay ≤ 2 năm, 60–2100 phút/tuần, ≥ 1 ngày học, HH:MM, IANA – tên cũ của ICU như `Asia/Saigon` chuẩn hoá). Bắt đầu chẩn
  đoán → upsert enrollment (mục tiêu, ngày thi, phút/ngày = phút/tuần ÷ ngày học) để server gợi ý mục tiêu khả thi; "Bỏ qua" → tạo lộ trình
  ngay. Người mới được mời từ thẻ dashboard/Hôm nay (không tự chuyển hướng sau đăng ký – giữ luồng cũ của các e2e).
- **Chẩn đoán `/toeic/diagnostic`** (`features/diagnostic`): `diagnostic-state.ts` (reducer thuần, có test: tải → câu → gửi → câu kế /
  kết quả; 409 → GET lại câu đang chờ, giữ đáp án nếu cùng câu; lỗi giữ lựa chọn). Một câu mỗi màn, tiến độ "Câu n/dự kiến", mức 1/2,
  không hiện đúng/sai (bỏ qua `last_correct`); có bài dở hoặc đến từ onboarding → vào thẳng câu đang chờ. Listening dùng **trình phát
  tự do** của Practice (bài ngắn một câu/màn, không chuỗi "nghe một lần"); URL ký lỗi → GET lại bước để có URL mới. Kết quả: Tổng/L/R
  ± khoảng (luôn ghi ước tính), mastery theo kỹ năng con (nhãn `result.subskills`), mục tiêu khả thi + lý do (`diagnostic.reason.*`);
  có nháp onboarding → chọn giữ mục tiêu / dùng gợi ý → `POST /me/plan`.
- **Lộ trình `/toeic/plan`** (`features/plan/plan-page.tsx`): tóm tắt (tuần n/N, tiến độ tuần/lộ trình, đếm ngược tới ngày thi, dự báo
  theo màu, mục tiêu/gợi ý/mức hiện tại), chọn tuần (pha, biểu tượng khoá, full test), ngày + task (`task-ui.tsx`: icon theo loại, phút, trạng
  thái, quá hạn, lý do giao bài dịch từ `evidence_code`). **Đổi ngày**: kéo thả HTML5 (desktop) + menu ⋯ → "Chuyển sang" (`<select>` –
  bàn phím, mobile), luật `reschedule.ts` (thuần, có test: cùng tuần, không quá khứ, trước ngày thi, chỉ task pending) + cập nhật lạc quan,
  lỗi 400 → hoàn tác + toast theo lý do. Tuần khoá (Free) → CTA `/pricing`. Tạo lại (202 → chờ `plan.updated` reason generated). Điều
  chỉnh: đề xuất còn hiệu lực (`proposal-card.tsx` – diff trước/sau `proposal-diff.ts` có test, phút trước → sau, vi phạm dịch theo mã,
  hết hạn, Áp dụng; 409 → trạng thái mới nhất) + ô yêu cầu bằng lời (202 pending → realtime/polling 3 s; 402 credit; 400 `refusal_code`).
  `?proposal=` (thông báo) tô sáng + cuộn tới đề xuất.
- **Hôm nay `/toeic/today`** + thẻ dashboard: chuỗi (sắp mất, đóng băng Pro), XP/cấp, tiến độ tuần, check-in khi đến hạn, việc hôm nay +
  quá hạn, "Nếu chỉ có 15 phút". Bấm task (`launch.ts` thuần, có test) → `POST /attempts {mode, section_id|test_set_id, plan_task_id}`
  (Idempotency-Key `plan-task-<id>` khi còn pending) / `/lessons/{id}?task=` / `/vocab/{id}?task=` (đánh dấu xong tại trang) / check-in /
  S10 `POST /me/errors/drill`. Lượt mở từ task ghi `sessionStorage` `allingo.plan-launch.v1` → màn kết quả có "Về Hôm nay/Lộ trình";
  task do server tự `done` khi bài được chấm.
- **Check-in** (`checkin-dialog.tsx`): cảm nhận, giờ thực tế, khó khăn (≤ 500), giờ/ngày rảnh tuần tới → hiển thị đề xuất (đang tạo /
  sẵn sàng / bị từ chối / cần làm rõ) + Áp dụng ngay trong hộp thoại.
- **Huy hiệu `/badges`** (`features/badges`): XP + cấp (`levelForXp`), chuỗi, lưới huy hiệu (đã đạt trước, tiến độ current/target, mô tả
  luật dịch theo dạng rule).
- **Điều hướng**: "Hôm nay", "Lộ trình" đầu thanh; nhãn chữ từ `xl` (nhỏ hơn: biểu tượng + `title`/sr-only), Cài đặt thành nút biểu tượng
  trên header, chip tên người dùng từ `2xl`; thanh dưới mobile 6 mục.
- **Mock S9** – `src/mock/learning-plan.ts` + `diagnostic-fixtures.ts` (23 câu tự biên soạn, 2 mức/Part; luật 2 đúng/2 sai + ước tính +
  mastery + gợi ý mục tiêu dùng chính `@allingo/scoring`, blueprint 13 câu), bộ sinh lộ trình đơn giản bám ADR-0032 (neo ngày thi / 8
  tuần, nền → luyện → mô phỏng, ôn từ mỗi ngày học, điểm danh cuối tuần, full test theo nhịp Pro 2 / Free 4 tuần, lượt luyện theo Part
  yếu), hôm nay + gợi ý 15′, PATCH theo luật API, check-in → đề xuất `pending` → `ready` sau ~1 s (+ realtime + thông báo
  `learning.plan_adjust_ready`), câu lệnh tự nhiên (2 credit; "ignore previous instructions" → 400 `refusal_code=injection`), áp dụng,
  chuỗi ngày theo múi giờ (đóng băng Pro), nhật ký XP, 6 huy hiệu seed như API + thông báo; `POST /attempts {section_id}` (7 section id ổn
  định); bài học/bộ từ mẫu. Hook E2E: `__ALLINGO_MOCK__.diagnosticKey(questionId)`, `.seedStreak(days)`.

## Sprint 10 – flashcard FSRS, sổ lỗi, thống kê & dashboard, marketing + blog + SEO, đồng ý cookie (giao diện)

- **Lớp API** – `lib/s10-api.ts` (SRS due/review, bộ từ + enroll, sổ lỗi + PATCH + drill, dự báo, `POST /analytics/events`,
  `POST /waitlist` – backend S12; 404 → `unavailable`, TODO bỏ khi có trong OpenAPI); Zod `learning-s10.ts`, sai dạng → dữ liệu thô.
- **Từ vựng `/toeic/vocab`** (`features/flashcards`): hôm nay (đến hạn, từ mới còn trong hạn mức Free 10 / Pro 30), bộ từ hệ thống
  (TOEIC 600 trọn bộ + chủ đề) với tiến độ đã thuộc/đang học/mới, hành động theo `next_action_code` (`vocab.next_action.*`), "Thêm
  cả bộ" (idempotent). Trang bộ `/toeic/vocab/{id}` (thay trang tạm S9 – `/vocab/{id}` chuyển hướng, giữ `?task=`): từng từ + trạng
  thái thẻ, phát âm, cursor.
- **Phiên ôn `/toeic/vocab/review?list=&task=&size=&mode=`** – reducer thuần `session.ts` (có test): 10/20/30 thẻ, lật/chấm 4 nút
  (Quên/Khó/Nhớ/Dễ) kèm lịch dự kiến từ `preview` (`intervalOf`), phím Space/Enter lật · 1–4 chấm · S phát âm (bỏ qua khi đang gõ),
  mỗi lượt `POST /me/srs/review` với `reviewed_at` cố định (thử lại idempotent; lỗi mạng → "Thử lại"), **Again → thẻ quay lại sau 3
  thẻ khác** (preview cũ bỏ, tải lại từ `/me/srs/due` khi tới lượt), server `in_session` cho lượt khác → cuối hàng đợi, 429
  `srs_new_cards` → hoàn tác lượt + bỏ thẻ mới còn lại + thông báo giờ reset (giờ VN) + CTA Pro; chế độ "Nghe – gõ lại từ"
  (dictation mini: so khớp chuẩn hoá, sai ≤ 1 ký tự = gần đúng → gợi ý điểm); thẻ lỗi (kind `error`) hiển thị câu + đáp án + ghi chú;
  tổng kết (lượt, % nhớ, ôn lại, từ mới, lần đến hạn kế). Task `vocab_review` (launch `vocab_list`) mở thẳng phiên ôn của bộ, xong
  phiên → PATCH done (server cũng tự xong khi hết thẻ đến hạn). TTS qua `GET /tts` (`speak.ts`, không nạp trước).
- **Sổ lỗi `/toeic/errors`** (`features/errors`, bộ lọc thuần `filters.ts` có test): tổng chưa hiểu/đã hiểu, phân bố theo loại và theo
  Part (bấm để lọc), bộ lọc trạng thái/loại/Part/7–30 ngày–mọi lúc/sắp xếp trên URL, danh sách cursor; mỗi mục: Part · kỹ năng con,
  câu (Part 1/2 không chữ → nhãn câu nghe), bạn chọn vs đáp án đúng (+ chữ lựa chọn), số lần sai, thời gian, đổi lý do (`reason_override`),
  ghi chú, tạo thẻ ôn, "Đã hiểu"/mở lại (cập nhật lạc quan), xem lại câu trong bài. "Làm lại" = đã chọn (≤ 10) hoặc 10 lỗi cũ nhất theo
  bộ lọc → `POST /me/errors/drill` → màn làm bài timed_drill. `?task=` (review_errors) gắn `plan_task_id`; task review_errors khi
  không còn lỗi (404) mở trang này. Exam Mode → 403 → banner.
- **Dashboard + `/toeic/stats`** (`features/stats`, `stats-model.ts` có test): 6 KPI (ước tính, chuỗi, XP, phút tuần – cùng nguồn
  `minutes_by_week`, từ đã thuộc, lỗi chưa hiểu), điểm theo thời gian (L/R + vạch mục tiêu), độ chính xác theo Part 30 ngày vs trước
  (biểu đồ + bảng; trang thống kê thêm kỹ năng con), phút/tuần 8 tuần, cộng đồng (phân vị khi `reason=ok`, không thì lý do i18n), dự
  báo v0 luôn nhãn "Ước tính sơ bộ" + `forecast.recommendation.*`, từ đến hạn, lỗi cần ôn, tóm tắt tuần (dựng từ stats – API chưa có
  endpoint đọc notes `system_summary`). Biểu đồ recharts (`charts.tsx`) chỉ qua `next/dynamic` (ssr: false) + bảng ẩn cho trình đọc.
- **Marketing (RSC + ISR 300 s)** – `lib/cms/*`: đọc Payload REST ở SERVER (`CMS_URL`, mặc định `http://localhost:3001`; thẻ fetch
  `pages|page:<slug>|posts|post:<slug>|redirects|sitemap`), lỗi → nội dung tĩnh i18n `marketing.fallback.*`; dev/e2e mock
  (`NEXT_PUBLIC_API_MOCK=1`) mà CMS tắt → fixture `src/mock/cms-fixtures.ts` (`CMS_URL=mock` ép fixture). Blocks (`features/marketing/
  blocks.tsx`, không JS): hero (h1 gồm eyebrow), features, pricing (giới thiệu Free/Pro, giá thật ở /pricing), FAQ (`<details>`),
  testimonial (chỉ khi có đồng ý), CTA. Liên kết CMS qua `normalizeCmsHref` (thêm locale, bí danh `/diagnostic` → `/toeic/diagnostic`
  kể cả `next=`, chặn javascript:/data:). Trang: `/` (giữ "Luyện thử miễn phí" + câu mẫu + 4 chương trình), `/toeic` (+ bảng 7 Part +
  **tuyên bố không liên kết ETS**), `/ielts|/jlpt|/hsk` (sắp ra mắt + đăng ký chờ), `/blog`, `/blog/[slug]` (Lexical → React an toàn
  `lexical.ts`, ảnh `next/image` unoptimized, tác giả, chuyên mục, FAQ, fallback bản vi), `/about`, `/contact`; trang không khớp →
  chuyển hướng CMS (`redirects`) trong `[...rest]`.
- **SEO**: `alternatesFor` (canonical + hreflang vi/en/x-default), `marketingMetadata` (OG/Twitter), JSON-LD (`lib/seo/json-ld.ts`
  – Organization ở `/`, FAQPage từ block FAQ/FAQ bài, Article|BlogPosting với URL có tiền tố locale; `serializeJsonLd` chống chèn thẻ),
  `app/sitemap.ts` (`buildSitemap` – trang tĩnh + bài vi/en + hreflang, ISR 300 s), `app/robots.ts` (chặn khu vực học/API), OG động
  `opengraph-image.tsx` (landing + bài blog; font mặc định của next/og có dấu tiếng Việt).
- **Webhook `/api/revalidate`** (`lib/cms/revalidate.ts` có test): kiểm `x-allingo-signature = sha256=HMAC(WEB_REVALIDATE_SECRET,
  "<ts>.<body>")` + timestamp ±5′ TRƯỚC khi đọc payload → `revalidateTag(tag, { expire: 0 })` + `revalidatePath` cho `/vi…`,`/en…`,
  `/sitemap.xml`. 503 khi chưa cấu hình, 401 chữ ký/thời gian sai, 400 payload sai. `next.config.ts` nạp `WEB_REVALIDATE_SECRET`,
  `CMS_URL`, `CMS_PUBLIC_URL` từ `.env` gốc nếu môi trường chưa có (không nạp NEXT_PUBLIC_*).
- **Đồng ý cookie & phễu** (`lib/analytics/*` có test, `features/consent/*`): thanh đồng ý trong luồng trang (marketing + AppShell; có
  sẵn trong HTML, script khởi động đặt `html[data-consent]` → CSS ẩn trước khi vẽ, không CLS), "Cài đặt cookie" ở chân trang mở lại.
  Không tải SDK PostHog ở web: sự kiện client `landing_view` (landing/TOEIC/chương trình/blog), `signup_start` (form đăng ký),
  `checkout_start` (checkout) → `POST /analytics/events {consent: true, anonymous_id}` CHỈ sau khi đồng ý (chưa đồng ý: không có request
  nào); API chuyển PostHog server-side. Attribution lần chạm đầu (`allingo.attribution.v1`: UTM lọc email/SĐT, origin referrer ngoài
  site, trang đích không query, thời điểm) gửi kèm `attribution` ở register/OTP/Google.
- **Điều hướng**: thêm "Từ vựng", "Sổ lỗi" (8 mục; desktop nhãn từ 2xl, thanh dưới mobile 8 cột nhãn ngắn `nav.short.*`); header
  marketing có TOEIC/Blog/Bảng giá; chân trang liên kết + cài đặt cookie.
- **Mock S10** – `src/mock/s10.ts`: lịch giản lược (Again 1′/Hard 5′ trong phiên, Good 1 ngày, Easy 4 ngày), hạn mức thẻ mới khi học,
  idempotent `(card_id, reviewed_at)`, 4 bộ từ mẫu (20 từ tự biên soạn), sổ lỗi khi chấm (luật timeout/subskill/Part như ADR-0033, gộp
  theo câu), drill, thống kê S10 + phân vị (mẫu 12 điểm) + dự báo hồi quy, `/analytics/events` (lưu `analyticsEvents`), `/waitlist` 202;
  register/OTP lưu `attribution` (không trả trong /me).
- **E2E S10**: `flashcards.spec.ts`, `errors.spec.ts`, `dashboard.spec.ts`, `marketing.spec.ts` (mock + `E2E_REAL_API=1`;
  `E2E_CMS_URL=http://localhost:3001` → so khớp nội dung CMS thật).
- **Hiệu năng (S10)**: (1) thông điệp next-intl theo nhóm route – gốc `ROOT_MESSAGES`, marketing `MARKETING_MESSAGES`
  (`lib/i18n-scope.ts`; trang /pricing và /notifications/manage thêm nhánh riêng qua `components/scoped-intl.tsx`), khu vực học vẫn
  đủ thông điệp (S11 tách theo trang) → HTML landing 206 KB → 94 KB; (2) phần dưới hero + chân trang bọc `HydrateLater` (Suspense →
  React hydrate sau, chia nhỏ); (3) `env.ts` bỏ Zod, "Luyện thử miễn phí" dùng `lib/guest.ts` (không kéo `lib/queries`/`@allingo/schemas`)
  → JS landing ~1,0 MB → ~0,78 MB (chưa nén). Layout có `setRequestLocale` để giữ SSG.
- **Lighthouse (S10, 2026-11-08, Lighthouse 13 + Chrome for Testing 153, `pnpm build && next start`)**: landing `/vi` mobile
  Performance 96–100 (5 lượt; TBT 60–220 ms, LCP 0,9 s, CLS 0), Accessibility 100, Best practices 100, SEO 100; desktop 100/100/100/100;
  `/vi/toeic` mobile 99/100/100/100; bài blog mobile 99/100/100/100. Đo landing bằng bản build `NEXT_PUBLIC_APP_URL=http://localhost:3100`
  (canonical/hreflang trùng origin đang đo – bản build cổng 3000 đo ở 3100 bị trừ điểm "canonical trỏ tới vị trí hreflang khác").
  Dashboard `/vi/toeic/dashboard` (khách, bản build phục vụ ở :3000 – API S11 chặn POST từ origin lạ `csrf_origin_mismatch` nên không đo
  ở :3100 được nữa): mobile Performance 75–77 (TBT 1,1–1,3 s – tương đương S6 dù thêm thẻ S10), desktop 95; A11y 100; BP 100; SEO 63 do
  `robots.txt` chặn khu vực học (cố ý). `/vi/toeic/vocab` mobile 85, `/vi/toeic/errors` 80.

## Sprint 11 – feature flag, giới hạn tốc độ, CSP nonce, Sentry/Web Vitals, hiệu năng dashboard, a11y, i18n lint (giao diện)

- **Feature flag** – `lib/flags.ts` (thuần, có test: `PUBLIC_FLAG_KEYS`/mặc định = `FLAG_FALLBACKS` của API, đọc `GET /flags`, 503 kill-switch
  `parseFeatureDisabled` – chỉ 503 có `details.flag`), `lib/flags-server.ts` (SSR lần đầu: `GET /flags` ẩn danh, Data Cache 30 s, ≤ 400 ms;
  `API_INTERNAL_URL` tuỳ chọn), `features/flags/flags-provider.tsx` (MỘT observer TanStack: bản SSR → tải lại kèm cookie, làm mới mỗi
  `ttl_sec` khi tab hiện + khi quay lại tab; `useFlag(key)`, `<FeatureGate>`; sự kiện 503 → tắt cờ ngay trong cache + toast
  `errors.feature_disabled` + tải lại cờ). Ẩn khi tắt: `ff.ai.explain` (nút Giải thích ở Review – đã giải thích vẫn hiện; bật lại → bấm lại
  được), `ff.ai.tutor` (Hỏi gia sư, thẻ dashboard, panel khoá ô nhập + thông báo), `ff.ai.diagnose` (thẻ Phân tích của AI – phân tích có sẵn
  vẫn hiện), `ff.billing.checkout` (nút mua ở /pricing + checkout, cộng với `checkout_enabled`), `ff.growth.referral` (trang + liên kết giới
  thiệu), `ff.learning.study_plan` (Hôm nay/Lộ trình: menu, thẻ dashboard, trang → `FeatureDisabledNotice`). Admin bật/tắt
  `ff.billing.checkout` trong /admin/billing làm mới cờ ngay. Mock: `GET /flags`, `GET /admin/flags`, kill-switch 503 ở explain/threads,
  hook E2E `__ALLINGO_MOCK__.setFlag(key, on)`; mặc định mock bật `ff.ai.diagnose` (seed API đang `false` – xem báo cáo S11).
- **Lỗi API chung** – `lib/api-error-events.ts` (thuần, có test): `notifyApiError` từ QueryCache/MutationCache và các luồng SSE (giải thích,
  gia sư, chẩn đoán) → 429 `rate_limited` (`login_locked` | `global_ip` | `bucket`) → `ApiErrorToasts` (layout gốc, một toast, đếm ngược
  `Retry-After`), 503 kill-switch → FlagsProvider, 429 `quota_exceeded` giữ luồng S5. Query không tự retry 401/402/403/404/429 và 503
  `feature_disabled`; mutation `meta.inlineErrors` (đăng nhập/đăng ký/OTP) chỉ báo tại chỗ (`useErrorMessage`: khoá đăng nhập "…thử lại sau
  15 phút"). `lib/api.ts`: fetch wrapper chép `Retry-After`/`X-Trace-Id` vào envelope 429/503 khi thiếu; request ghi gửi `traceparent`
  (GET không – tránh preflight CORS).
- **CSP nghiêm có nonce** – `src/proxy.ts` + `lib/security/csp.ts` (thuần, có test): mỗi request một nonce 128 bit, CSP đặt ở header
  request (Next tự gắn nonce cho script khung/chunk/RSC inline) và response: `script-src 'self' 'nonce-…' 'strict-dynamic'` (dev thêm
  `'unsafe-eval'`), `style-src 'self' 'unsafe-inline'` (thuộc tính style của React/Radix + style sonner – không ảnh hưởng chặn script),
  `connect-src` API + `ws(s)` API (+ Sentry, GIS), `img-src`/`media-src` self data blob + API + `CSP_MEDIA_ORIGINS` (+ CMS cho ảnh blog),
  `frame-ancestors 'none'` (dev `'self'` – iframe làm nóng trang offline), `base-uri 'self'`, `form-action 'self'` (+ `CSP_FORM_ACTION_ORIGINS`
  nếu cổng thanh toán dùng form POST), `object-src 'none'`, `upgrade-insecure-requests` khi https, `report-uri` Sentry. Nonce gắn cho script
  đồng ý cookie (`layout.tsx`), next-themes, JSON-LD. Layout gốc đọc `headers()` ⇒ **mọi trang render động** (bắt buộc với nonce; dữ liệu CMS
  vẫn qua Data Cache/`revalidateTag`). Zod `jitless` (`lib/zod-csp.ts`) để Zod không thử `new Function` (vi phạm `unsafe-eval`).
  `next.config.ts`: `poweredByHeader: false`, header tĩnh (nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, COOP
  `same-origin-allow-popups` cho Google Sign-In) + HSTS 2 năm `preload` khi production.
- **Sentry web không SDK** – `lib/telemetry/sentry.ts` (Envelope HTTP, xác thực bằng query → dùng được `sendBeacon`), `scrub.ts` (email,
  SĐT VN, JWT, Bearer, tham số bí mật; URL bỏ query + id → `:id`), `trace.ts` (trace mỗi route; `traceparent` request ghi cùng trace →
  `trace_id` sự kiện = trace API), `components/telemetry.tsx` (nạp lười khi có `NEXT_PUBLIC_SENTRY_DSN`; `window.error`/`unhandledrejection` →
  phiên `crashed`, `app/[locale]/error.tsx` → `errored`; phiên `exited` khi rời trang ⇒ crash-free sessions; Web Vitals `next/web-vitals`
  → một sự kiện `transaction` có `measurements` LCP/INP/CLS/FCP/TTFB mỗi route). Biến: `NEXT_PUBLIC_SENTRY_DSN`, `…_ENVIRONMENT`, `…_RELEASE`
  (hoặc `NEXT_PUBLIC_GIT_SHA`), `…_SAMPLE_RATE`, `…_VITALS_SAMPLE_RATE`; source map trình duyệt khi build `WEB_SOURCE_MAPS=1` (CI tải lên rồi
  xoá *.map). Test bằng transport giả (`sentry.test.ts`).
- **Hiệu năng dashboard** – (1) thông điệp theo trang ở khu vực học: `(app)/layout` chỉ `APP_LAYOUT_MESSAGES`, mỗi page bọc `<PageIntl page=…>`
  với nhánh sinh tự động từ đồ thị import client (`node scripts/i18n-scopes.mjs` → `lib/i18n-app-scopes.ts`; `i18n-app-scopes.test.ts` đỏ
  khi tệp sinh cũ) → HTML dashboard 142 KB → 68 KB; (2) `Link` của `@/i18n/navigation` mặc định `prefetch={false}` (trước: ~30 request RSC +
  ~200 KB JS route tải trước khi dashboard đang dựng); (3) AuthGate dựng AppShell + trang trong `startTransition` (React chia nhỏ ~5 ms);
  (4) dashboard tách khối tự đăng ký query (kết quả về chỉ dựng lại khối đó), phần dưới màn đầu + Hôm nay dựng khi rảnh (`components/
  deferred.tsx`, khung chờ cùng cỡ); chuông thông báo nạp lười.
  **Lighthouse 13.6 + Chrome for Testing 153, mobile, `/vi/toeic/dashboard` (khách), bản build `next start -p 3000`, mỗi lượt một Chrome mới
  (cookie phiên nạp qua CDP, `--disable-storage-reset`), 2026-11-08, mỗi phiên đo bản trước (HEAD S10 dựng lại) và bản sau liền nhau:**
  phiên 1 (máy rảnh): trước **78–81** (TBT 0,81–1,0 s) → sau **84–87, trung vị 86** (TBT 0,51–0,64 s); phiên 2 (sau khi container khởi động
  lại, máy dùng chung tải cao hơn): trước **73–76** (TBT 1,2–1,8 s) → sau **81–86, trung vị 82** (TBT 0,57–0,77 s). FCP/LCP 0,64–0,74 s,
  CLS 0; A11y 100, BP 100 (trước 96), SEO 63 (robots chặn khu vực học – cố ý). TBT thực đo bằng PerformanceObserver `longtask` với CPU ×4
  (không mô phỏng Lantern) ~145 ms. Landing `/vi` 96–97 (trước 96–98; trang động thay vì SSG: FCP +~60 ms). Ghi chú: ~190–550 ms TBT mô phỏng là tác vụ DevTools gắn vào renderer lúc
  điều hướng (GC "heap object iterator" – không có ở người dùng thật); chi phí JS còn lớn nhất là dựng toàn bộ schema Zod của
  `@allingo/schemas` (một module 231 KB, `splitting: false`) ngay khi nạp – cần tách gói/`/*#__PURE__*/` ở packages/schemas để tree-shake.
- **a11y** – `e2e/a11y.spec.ts` (axe WCAG 2.0/2.1 A+AA): dashboard, màn thi Exam, hộp thoại nộp (giữ focus), kết quả, Review + giải thích,
  Listening (màn "Bắt đầu nghe" + thanh nghe) → 0 serious/critical; luồng thi chỉ bằng bàn phím (Tab → Space chọn, ←/→, phím số, F, Tab →
  Nộp → Enter). Sửa: tên truy cập tab Part bắt đầu bằng chữ hiển thị (WCAG 2.5.3 – `attempt.partTabAria`), `aria-controls` của `Tabs`
  (`@allingo/ui`) chỉ trỏ tới panel tồn tại, màu chữ toast sonner (≥ 6:1), `aria-label` thanh điều hướng qua i18n.
- **i18n lint** – quy tắc cục bộ `allingo/no-jsx-literal-text` (`eslint-rules/`, có RuleTester): chuỗi chữ trong JSX/thuộc tính hiển thị
  (`aria-label`, `title`, `placeholder`, `alt`, `label`…) phải qua next-intl; cho phép tên riêng (`I18N_ALLOW` trong `eslint.config.js`),
  một chữ cái, nội dung `<code>/<kbd>/<pre>`, chú thích `i18n-ignore – lý do`; bỏ qua `src/mock`, test, cổng thanh toán giả (công cụ dev).
- **Mật khẩu (API S12)** – đăng ký ≥ 12 ký tự (`lib/password-policy.ts`), lỗi server `password_too_short|password_breached|password_weak`
  → thông điệp i18n `auth.passwordPolicy.*` ở ô mật khẩu; mock kiểm tra như API; E2E dùng mật khẩu ≥ 12 ký tự không phổ biến.
- **E2E S11**: `flags.spec.ts` (admin tắt `ff.ai.explain` → bấm → 503 + thông điệp + ẩn ngay; tự làm mới → ẩn < 60 s; bật lại → hiện lại;
  hợp đồng `GET /flags`), `csp.spec.ts` (nonce mỗi request, mọi `<script>` có nonce; không vi phạm CSP ở landing, dashboard, Exam, kết quả,
  Review + giải thích, Listening, checkout cổng mock, blog CMS; không `MISSING_MESSAGE` trên 17 trang + điều hướng client), `a11y.spec.ts`.
  `ai-explain.spec.ts` (API thật) bật `ff.ai.diagnose` trong lúc chạy rồi trả lại trạng thái cũ.

## Sprint 12 – beta kín, góp ý/báo lỗi/hỗ trợ, admin vận hành, MFA, pháp lý, hoàn thiện (giao diện)

- **Lớp API** – `lib/s12-api.ts` (beta, khảo sát/NPS, góp ý + ảnh, báo lỗi câu, hỗ trợ, pháp lý, MFA, toàn bộ admin S12; Zod của
  `packages/schemas/src/api/s12.ts`, phần admin dùng kiểu `components['schemas']` sinh từ OpenAPI – `Full<>` bỏ `?` vì schema không khai
  báo `required`). Client sinh lại (`pnpm --filter @allingo/api-client build`) để có 100 đường dẫn v1.1.
- **Beta gate** – `lib/beta.ts` (thuần, có test): 403 `beta_required` từ mọi query/mutation → `notifyApiError` → sự kiện
  `allingo:beta-required` → `features/beta/beta-gate-listener.tsx` (CHỈ trong layout (app) – landing/marketing không bao giờ bị chuyển)
  → `/beta?next=<trang>`; trang miễn: `/support*`, `/settings*`, `/onboarding/beta`, `/beta` (API cũng miễn endpoint tương ứng – A194).
  Trang `/beta` (marketing, `noindex`, không sau AuthGate): khách ẩn danh → đăng ký/đăng nhập giữ `?code=` qua `?next=`; tài khoản khách
  → cần đăng ký; đã có quyền → vào học/khảo sát; chưa có → ô mã định dạng `ALG-XXXX-XXXX` khi gõ/dán (chuẩn hoá như API, cảnh báo ký tự
  0/1/I/L/O), lỗi theo `details.reason` (`invite_invalid` gộp sai/hết hạn/thu hồi, `invite_used`, `already_beta`, khách, 429) → i18n
  `beta.redeemErrors.*`; thành công → quyền lợi đọc từ PHẢN HỒI (`trial_ends_at`/`trial_skipped`, `credits_granted`, `balance`) +
  đăng ký chờ TOEIC (`WaitlistForm program="toeic"`).
- **Onboarding beta `/onboarding/beta`** – khảo sát 5 câu (`betaSurveyInputSchema`), hướng dẫn 60 giây 4 thẻ (bỏ qua được, nhớ
  `localStorage` `allingo.beta-tour.v1`), kênh cộng đồng Zalo/Discord từ `NEXT_PUBLIC_COMMUNITY_*` (ẩn khi trống). Dashboard nhắc khảo sát
  khi `GET /me/surveys/pending` còn `beta_onboarding`.
- **NPS** – `features/surveys/survey-prompts.tsx` + `lib/surveys.ts` (thuần, có test): thẻ trong luồng trang dashboard (không phủ nội
  dung, dựng khi rảnh), thang 0–10 (radio thật) + câu hỏi lý do theo nhóm NPS, khung ngày 7/14 do server quyết (`due_at`/`expires_at`),
  không hiện khi Exam Mode (`useExamLock`), "Để sau" 24 giờ (`allingo.nps-snooze.v1`, try/catch); khách không gọi API.
- **Góp ý in-app** – nút "Góp ý" trong header AppShell (ẩn khi Exam Mode; màn thi không có AppShell), hộp thoại nạp lười
  (`features/feedback/*`): loại, nội dung, ảnh tuỳ chọn – chọn tệp hoặc dán Ctrl/⌘+V (không thư viện chụp màn hình; PNG/JPEG/WebP ≤ 8 MB)
  → `POST /uploads/presign {kind: image}` → PUT URL ký (không cookie) → `screenshot_upload_id`. `lib/feedback.ts` chuẩn hoá payload theo
  schema: đường dẫn trang bỏ query/hash/locale, `trace_id` gần nhất (`lib/telemetry/last-trace.ts` – ghi `X-Trace-Id` mọi phản hồi trong
  `getApiFetch`, ưu tiên trace lỗi ≤ 15′), `app_version` = release Sentry; hiển thị rõ cho người dùng những gì được gửi kèm (không PII).
- **Báo lỗi câu hỏi** – `features/content-report/*` theo `question_version_id`: Review (ẩn khi có bài thi exam đang làm) và màn làm bài
  Practice/drill (khối practice – Exam Mode không có); 8 lý do i18n, mô tả tuỳ chọn, hạn SLA 48 giờ, `duplicate` → "đang được xử lý".
- **Hỗ trợ** – `/support` (tạo ticket: chủ đề, tiêu đề, nội dung, đính kèm trace gần nhất, `?attempt=` gắn bài làm, `?from=` trang; danh
  sách cursor + trạng thái + SLA 24 giờ `lib/support.ts`), `/support/tickets/{id}` (đích `support.reply`: hội thoại 2 chiều, trả lời mở
  lại ticket resolved, closed → 409; làm mới 30 s). Thông báo S12 trong trung tâm thông báo: `support.reply` (+ credit bù),
  `content.report_resolved` (đã sửa/đã xem), `beta.invite` – `TEMPLATE_REQUIRED_PARAMS` gồm mã S12 (SPEC-ISSUES S136; chưa gộp vào
  `NOTIFICATION_TEMPLATE_CODES` vì packages/schemas ngoài phạm vi web).
- **MFA** – `/settings/security` (`features/security/security-page.tsx`): trạng thái `/me/mfa`; chỉ admin bật được (người học: giải thích);
  enroll → khoá base32 nhóm 4 + sao chép khoá/otpauth + "Mở trong ứng dụng" (API không trả ảnh QR → KHÔNG thêm thư viện QR); confirm →
  10 mã khôi phục hiện MỘT lần (sao chép/tải `.txt`, phải tích "đã lưu"); xác minh phiên; tạo lại mã (cần TOTP hiện tại).
  **Step-up**: `lib/mfa-step-up.ts` (thuần, có test) – middleware openapi-fetch giữ bản sao request `/admin/*`, gặp 403 `mfa_required`
  → hộp thoại `features/security/mfa-step-up-provider.tsx` (layout (app); mã TOTP hoặc mã khôi phục, 429 khoá 15′) → `POST /auth/mfa/verify`
  → GỬI LẠI đúng request một lần (nhiều request lỗi cùng lúc dùng chung một lần hỏi); huỷ → 403 giữ nguyên → ErrorState
  `errors.codes.mfa_required` + nút tới Bảo mật. Áp cho cả billing admin S8 (không sửa từng lời gọi).
- **Admin vận hành `/admin`, `/admin/<beta|feedback|content|support|users|ai|system|audit>`** (`features/admin-ops/*`, mỗi mục nạp lười,
  tab con qua `?tab=` + History API như billing admin; chỉ admin/superadmin – server vẫn 403): tổng quan (Redis, DLQ chưa replay, SLA quá
  hạn, beta hôm nay); beta (danh sách chờ chọn → xếp hàng theo đợt, mời theo email, lời mời + hạn mức/ngày + "Gửi ngay" + thu hồi, báo cáo
  tuần KPI + Markdown); góp ý (trace sao chép, ảnh URL ký, đổi trạng thái); nội dung (báo lỗi câu – xử lý + ghi chú; thống kê câu p-value/
  phân biệt/thời gian/báo lỗi, đề xuất retire/review + lý do, tính lại); hỗ trợ (lọc, hội thoại, trạng thái/ưu tiên/nhận xử lý, trả lời
  kênh in-app/email + credit bù ghi chú BẮT BUỘC); người dùng (tìm – PII che, hồ sơ, khoá/mở khoá, yêu cầu xoá có ô xác nhận, "xem như"
  CHỈ ĐỌC: token Bearer trong bộ nhớ trang (không cookie), banner + đếm ngược 10′ + Thoát, email/SĐT che `lib/admin-format.ts`); AI (👍/👎
  theo prompt version, refused); hệ thống (hàng đợi, partition, outbox, DLQ + replay, cờ); audit (lọc actor/action tiền tố/đối tượng/ngày
  giờ VN). Mọi thao tác phá huỷ/khó đảo ngược qua `ConfirmDialog` (lý do ghi audit). `useCursorList` (S8) giữ kiểu trang đầu (`counts`,
  `today`…); `DataTable` vùng cuộn ngang tới được bằng bàn phím (axe `scrollable-region-focusable`).
- **Pháp lý** – `/legal/{terms,privacy,refund,voice-consent}` (RSC): phiên bản/ngày hiệu lực/trạng thái từ `GET /legal/policies` (cache
  300 s, lỗi → dự phòng), nhãn "Bản nháp chờ luật sư duyệt" khi `draft_pending_legal_review`; nội dung placeholder `legal.*` (hoàn tiền,
  giọng nói mới); `/terms`, `/privacy` chuyển hướng 308; chân trang marketing + **chân trang khu vực học** (`components/app-footer.tsx`:
  pháp lý, hỗ trợ, tuyên bố không liên kết ETS trên mọi trang TOEIC trong app); sitemap/robots cập nhật.
- **Hoàn thiện** – KPI "Điểm ước tính" sau mini một kỹ năng (SPEC-ISSUES S142): "Gần nhất: Reading x/495" + "điểm tổng cần đề có cả
  Listening và Reading" (`latestSkillScore` – `score_history[].part`); mock S10 bám API S12 (ước tính/dự báo/phân vị chỉ từ thang tổng).
  a11y: Logo không ghi đè tên truy cập (axe `label-content-name-mismatch` ở header marketing), NPS radio thật. Header mobile: "Thanh toán"
  vào qua Cài đặt để chừa chỗ nút Góp ý (không tràn 360 px).
- **Mock S12** – `src/mock/s12.ts` (+ `totp.ts` RFC 6238 Web Crypto, có test vector): guard như API (impersonate chỉ đọc, khoá → phiên thu
  hồi, step-up `/admin/*` khi bật, beta gate với danh sách miễn), mọi endpoint S12, mã mời trong "hộp thư giả", `X-Trace-Id` mọi phản hồi.
  Hook E2E: `__ALLINGO_MOCK__.lastInviteCode(email)`, `.setAdminMfaRequired(on)`, `.setNpsDue(email, kind)`, `.addDeadLetter()`.
- **E2E S12**: `beta-tester.spec.ts` (mời qua UI admin → gửi → bật gate → đăng ký bị chặn → mã sai/đúng → khảo sát → hướng dẫn → đề mini →
  báo lỗi câu (+ trùng) → góp ý có ảnh → ticket → admin trả lời + 150 credit → thông báo `support.reply` → trả lời; API thật đọc mã từ email
  qua SMTP sink cục bộ `e2e/s12-helpers.ts`), `admin-ops.spec.ts` (khoá → phiên người học bị thu hồi ngay + đăng nhập 401, mở khoá,
  impersonate chỉ đọc + thoát, audit; hệ thống/DLQ/cờ/thống kê/AI/báo cáo), `mfa.spec.ts` (TOTP tính bằng `node:crypto`; API thật: tài khoản
  E2E được cấp vai trò admin TẠM qua psql rồi gỡ + xoá factor; step-up chỉ mock vì dev tắt `ADMIN_MFA_REQUIRED`), `s12-pages.spec.ts`
  (pháp lý, ETS, NPS, axe + tràn ngang trên trang/hộp thoại S12 và 14 màn admin, không MISSING_MESSAGE/CSP). Cờ beta gate luôn khôi phục.
- **Hiệu năng (bản build, khách, 2026-11-08)**: HTML dashboard 65 KB (S11: 68 KB), landing 95 KB (S10: 94 KB); dashboard tải lại
  1,08 MB JS chưa nén / 24 tệp, 14 request API (khách không gọi `/me/surveys/pending`; nút Góp ý dùng chung query bài thi đang làm `useExamLock` đã có ở dashboard). Thêm vào khung app: nút Góp ý (hộp thoại nạp
  lười), chân trang, listener beta/MFA; dashboard: thẻ khảo sát dựng khi rảnh. Chưa đo Lighthouse (không có Lighthouse trong phiên).


### Backlog B6 + B7 (09/11/2026)

- **Tách gói `@allingo/schemas` (S141)**: ESM tách chunk + một entry/module + `sideEffects: false`; web nhập theo đường dẫn con
  (`@allingo/schemas/api/s12`, `/api/core`, `/question/answer`, `/product/xp`…). Bản build: JS tải lần đầu dashboard 1.035,3 → 991,1 KB
  (gzip 306,8 → 298,2 KB), `/beta` 929,3 → 882,1 KB, `/admin/<mục>` 989,5 → 944,9 KB; schema admin/AI/chấm điểm/đề mẫu không còn ở
  dashboard. Thêm import mới: nhập từ đường dẫn con của module định nghĩa tên (không nhập gốc `@allingo/schemas` trong mã client).
- **Admin S12 (S145)**: kiểu `components['schemas']` dùng trực tiếp (OpenAPI đã khai báo `required`) – bỏ `Full<>`/ép kiểu; Zod admin ở
  `packages/schemas/src/api/s12-admin.ts`. Beta: tab Lời mời có chọn từng lời mời → "Gửi đã chọn" và "Gửi đợt <batch>" theo bộ lọc (S147).
- **404 thật (S152)**: `src/lib/app-routes.ts` + `proxy.ts` rewrite route (app) sai dạng sang route bắt-mọi → HTTP 404 (AuthGate client
  không cho `notFound()` trong (app) đổi mã trạng thái). **Góp ý trên `/beta`** (S150, chỉ chữ khi chưa có quyền beta).
  **Step-up MFA** không gọi `/me/mfa` khi API đã gửi `details.enrolled` (S144). Thông báo báo lỗi câu trỏ trang xem lại câu (S148).
- **E2E CI**: `public/sw.js` (gitignore) dựng trước `next dev` (`predev`, `dev:mock`, webServer Playwright) – CI máy sạch thiếu SW làm test
  PWA đỏ. Thanh "Câu sai trước/tiếp" ở Review không còn tràn ngang mobile với font hệ thống rộng (DejaVu Sans trên runner Ubuntu) – nguyên
  nhân gốc các ca click "intercepts pointer events" trên Pixel 7 (trình duyệt thu nhỏ trang tràn ngang). Tái hiện cục bộ:
  `FONTCONFIG_FILE=$PWD/e2e/fonts/ci-like.conf CI=1 pnpm exec playwright test --project=mobile` (ép sans-serif/system-ui = DejaVu Sans, loại Inter – như runner CI).
