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
packages/ui/src                component dùng chung (Button, Card, Dialog/Sheet, Tabs…) + styles.css (token navy/gold)
```

## Ghi chú kỹ thuật

- **PWA**: `@serwist/next` chỉ hỗ trợ webpack, Next 16 build bằng Turbopack nên service worker được đóng gói riêng bằng esbuild (`scripts/build-sw.mjs`, chạy ở `prebuild`). SW precache shell + cache ảnh/audio (stale-while-revalidate), **không cache API**; chỉ đăng ký ở production.
- **Exam Mode (Sprint 3)**: màn một trang `features/attempt` – thanh Part (`[`/`]`), lưới câu theo Part (đã trả lời/đánh dấu/đang xem), Part 6–7 đoạn văn trái – câu hỏi phải với thanh kéo `SplitPane` (`@allingo/ui`, bàn phím ←/→/Home/End/Enter; mobile xếp dọc, đoạn văn thu gọn được), câu cùng `group_key`/passage hiển thị chung đoạn văn (`[Nhãn]` → tiêu đề phụ, mốc `[131]` tô sáng theo câu đang xem), chế độ tập trung (Z/Esc), cỡ chữ 3 mức (+/−, lưu `localStorage` `allingo.exam.prefs`, bọc try/catch); phím tắt 1–4/A–D, ←/→, F.
- **Đồng hồ**: tính từ `expires_at` + `server_time`; cảnh báo 10′/5′/1′ bằng toast + vùng `aria-live`; hết giờ tự nộp. `PUT /answers` trả 409 (quá hạn + 30 s, hoặc đã nộp) → hàng đợi đóng, nộp (idempotent) rồi mở kết quả.
- **Offline**: `DraftQueue` gộp lô (debounce 0,8 s, 10 s/lần, khi đổi câu/ẩn tab) và giữ nháp chưa gửi trong **IndexedDB** `allingo-drafts/drafts` (fallback bộ nhớ khi IndexedDB không dùng được; tự chuyển nháp localStorage của bản cũ). Màn làm bài chỉ dựng sau khi khôi phục xong; nháp + câu đang xem (`ui_state.current_question_id`) cục bộ đè dữ liệu server. Banner "Mất kết nối…" / "Đang lưu lại…". Sự kiện phiên: `tab_hidden`, `focus_lost`, `resume`, `part_switch`.
- **Practice/drill**: chọn đáp án (mcq_single) → lưu ngay → `GET /attempts/{id}` lấy `feedback` → hiện đúng/sai, đáp án, giải thích tác giả; câu đã kiểm tra bị khoá. Dạng khác dùng nút "Kiểm tra đáp án". Không đồng hồ (trừ `timed_drill`).
- **Kết quả/Xem lại**: khối Chẩn đoán từ `diagnosis` (Part/kỹ năng con/chủ đề yếu, cờ → câu nhận xét, gợi ý → `/toeic/practice?section=…&subskill=…`, trang practice đọc query để chọn sẵn); thang 5–495/10–990 ghi rõ "ước tính". Xem lại lọc bằng tham số API `only_wrong/flagged/section`, trạng thái lọc trên URL (`?filter=wrong&section=part5`), nút "Câu sai trước/tiếp theo".
- **Kiểu dữ liệu**: ưu tiên Zod trong `packages/schemas` (đầy đủ hơn OpenAPI đã sinh); `GET /attempts/{id}/result` mới thêm (SPEC-ISSUES S8) nên path được ép kiểu cho tới khi chạy `pnpm client:gen`.
