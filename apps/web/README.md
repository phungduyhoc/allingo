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

## Cấu trúc

```
src/app/[locale]/(marketing)   landing, /login, /signup          (SSG, header/footer marketing)
src/app/[locale]/(app)         AuthGate (GET /me 401 → về landing)
  (shell)/toeic/dashboard, toeic/test-sets, settings, attempts/[id]/result|review   (AppShell)
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
e2e/listening.spec.ts          Listening (S4): "Bắt đầu nghe", phát một lần không tua/tạm dừng, chuyển câu theo audio, tải lại tiếp tục, URL 403 → gia hạn,
                               Practice tua/tốc độ/lặp, timed_drill, L&R → Reading, kết quả L/R/Tổng, Review transcript (mock: toeic-listening-mini-01,
                               toeic-lr-mini-01; API: toeic-listening-01-drill-part1, toeic-mini-lr-01)
packages/ui/src                component dùng chung (Button, Card, Dialog/Sheet, Tabs…) + styles.css (token navy/gold)
```

## Ghi chú kỹ thuật

- **PWA**: `@serwist/next` chỉ hỗ trợ webpack, Next 16 build bằng Turbopack nên service worker được đóng gói riêng bằng esbuild (`scripts/build-sw.mjs`, chạy ở `prebuild`). SW precache shell + cache ảnh/audio (stale-while-revalidate), **không cache API**; chỉ đăng ký ở production.
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
