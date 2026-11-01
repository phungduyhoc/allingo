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
packages/ui/src                component dùng chung (Button, Card, Dialog/Sheet, Tabs…) + styles.css (token navy/gold)
```

## Ghi chú kỹ thuật

- **PWA**: `@serwist/next` chỉ hỗ trợ webpack, Next 16 build bằng Turbopack nên service worker được đóng gói riêng bằng esbuild (`scripts/build-sw.mjs`, chạy ở `prebuild`). SW precache shell + cache ảnh/audio (stale-while-revalidate), **không cache API**; chỉ đăng ký ở production.
- **Exam Mode**: đồng hồ tính từ `expires_at` hiệu chỉnh theo `server_time`; lưu nháp gộp lô mỗi 10 s/khi đổi câu (`DraftQueue`, giữ trong localStorage khi offline và gửi lại khi có mạng); phím tắt 1–4/A–D, ←/→, F; audio `listen_policy = once` phát một lần.
- **Practice Mode**: chưa có endpoint kiểm tra đáp án tức thì (client không nhận `answer_key`) → Sprint 3; hiện lưu ngay và xem đáp án ở Xem lại.
- **Kiểu dữ liệu**: ưu tiên Zod trong `packages/schemas` (đầy đủ hơn OpenAPI đã sinh); `GET /attempts/{id}/result` mới thêm (SPEC-ISSUES S8) nên path được ép kiểu cho tới khi chạy `pnpm client:gen`.
