# Giấy phép phụ thuộc (Sprint 0, 01/11/2026)

Thống kê từ `pnpm licenses list --json` trên toàn workspace (prod + dev). Mã nguồn Allingo là **độc quyền (proprietary)** – `"private": true` ở mọi package; chưa chọn giấy phép mã nguồn mở.

## Tổng hợp

| Giấy phép | Số gói | Đánh giá |
| --- | --- | --- |
| MIT / MIT-0 / ISC / 0BSD / BSD-2 / BSD-3 / BlueOak-1.0.0 / Unlicense / Apache-2.0 | ~1.070 | Permissive – dùng tự do, giữ thông báo bản quyền khi phân phối |
| MPL-2.0 (`lightningcss` – phụ thuộc của Tailwind/Next) | 3 | Copyleft theo tệp: chỉ áp dụng nếu sửa mã nguồn của chính thư viện; dùng nguyên bản không phát sinh nghĩa vụ |
| LGPL-3.0-or-later (`@img/sharp-libvips-*` – binary libvips do `sharp` dùng, phụ thuộc của Next/Payload) | 2 | Liên kết động với thư viện LGPL, không sửa đổi → chỉ cần giữ thông báo và cho phép thay thế thư viện; chạy phía server nên không phân phối tới người dùng cuối |
| CC-BY-4.0 (`caniuse-lite` – dữ liệu) | 1 | Ghi nguồn khi phân phối dữ liệu; chỉ dùng lúc build |
| WTFPL / Python-2.0 / PSF-2.0 / tổ hợp OR | 6 | Permissive |

Không có gói GPL/AGPL trong cây phụ thuộc.

## Dịch vụ & mô hình bên ngoài (theo điều khoản riêng, cần rà trước khi bán)

| Thành phần | Điều khoản | Lưu ý |
| --- | --- | --- |
| Google Gemini, Anthropic Claude, OpenAI (qua Vercel AI SDK) | Điều khoản API của từng nhà cung cấp | Không gửi PII (CLAUDE.md §5.4); ghi `model_id` vào `ai.ai_tasks` để truy vết |
| Azure AI Speech | Điều khoản Azure | Ghi âm người học lưu bucket riêng, xoá theo vòng đời 90/365 ngày |
| PostgreSQL 16, pgvector, Valkey, Meilisearch, MinIO | PostgreSQL / PostgreSQL / BSD-3 / MIT / AGPL-3.0 (MinIO) | **MinIO chỉ dùng dev** (AGPL); production dùng S3-compatible của nhà cung cấp cloud (ADR-0014) |
| Payload CMS | MIT | |
| Font/icon | Hệ thống (không nhúng font ngoài ở Sprint 0) | Khi thêm font thương mại cần giấy phép web |

## Nội dung đề thi

Không sao chép đề ETS/Cambridge/JLPT/HSK thật. Nội dung demo trong `db/seed/demo/content.ts` và `apps/cms/samples/` do đội tự biên soạn, gắn `source = 'human'`; nội dung do AI sinh gắn `source = 'ai'` và phải qua luồng duyệt CMS (draft → ai_checked → review1 → review2 → published).

Cập nhật tệp này mỗi khi thêm dependency có giấy phép ngoài nhóm permissive, hoặc trước mỗi gate (`pnpm licenses list --json`).
