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
packages/ui/src                component dùng chung (Button, Card, Dialog/Sheet, Tabs…) + styles.css (token navy/gold)
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
