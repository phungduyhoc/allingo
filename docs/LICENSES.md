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

## Dữ liệu từ điển (Sprint 6)

| Bộ dữ liệu | Nguồn | Giấy phép | Dùng ở đâu |
| --- | --- | --- | --- |
| **Allingo TOEIC Core EN–VI** v1.0 – 1.750 mục (headword, từ loại, IPA Mỹ/Anh, 1–3 nghĩa vi/en, ví dụ, collocations, CEFR, topic, dạng biến đổi) | `db/seed/dictionary/toeic-core-en-vi.ts` + `entries-*.ts`, đội nội dung Allingo **tự biên soạn** (không sao chép từ điển có bản quyền; tên người/công ty trong ví dụ hư cấu) | Nội dung độc quyền của Allingo (`DICTIONARY_LICENSE.license = "Proprietary – Allingo content (tự biên soạn)"`) | Nhập vào `catalog.vocab_items` (kind `word`, `source = human`) bằng `db/seed/dictionary.ts`; `GET /dictionary/lookup` trả `attribution` = tên + giấy phép |
| Bản dịch AI khi không có trong từ điển | `segment_translate` qua AiGateway (Gemini/GPT – điều khoản API nhà cung cấp) | Kết quả do model sinh, lưu `ai.translation_cache` | Chỉ hiển thị cho người tra; mục SRS tạo từ đó gắn `source = ai`, `status = draft` |

Nếu sau này nhập dữ liệu mở (Wiktionary – CC BY-SA 4.0, FreeDict – GPL/CC tuỳ bộ), phải: ghi nguồn + giấy phép từng bộ ở bảng trên, giữ `attribution` trong API, và
kiểm tra điều kiện "share-alike" trước khi trộn với nội dung độc quyền.

## Thư viện thêm ở Sprint 6

| Gói | Giấy phép | Ghi chú |
| --- | --- | --- |
| `web-push` 3.6.x (+ `http_ece`, `asn1.js`, `jws`, `https-proxy-agent`) | MPL-2.0 (`web-push`), MIT (phụ thuộc) | MPL-2.0 copyleft theo tệp: dùng nguyên bản, không sửa mã nguồn thư viện → không phát sinh nghĩa vụ ngoài giữ thông báo |
| `@types/web-push` (dev) | MIT | |

## Công cụ vận hành (Sprint 11 – chạy như dịch vụ/CLI riêng, không liên kết vào mã)

Grafana, Loki, Tempo, Promtail: **AGPL-3.0** – chỉ chạy image chính thức không sửa đổi, nội bộ (không cung cấp cho người dùng cuối) → không phát sinh nghĩa vụ công bố mã Allingo; nếu sửa mã các dịch vụ này phải công bố phần sửa. Prometheus, Alertmanager, exporters, OpenTelemetry Collector, k6 (AGPL-3.0 – chỉ là CLI chạy test, không phân phối), OpenTofu (MPL-2.0), Trivy (Apache-2.0), gitleaks (MIT), ZAP (Apache-2.0), Semgrep CLI (LGPL-2.1, ruleset registry theo điều khoản Semgrep). Không thêm dependency npm runtime ở S11.

## Nội dung đề thi

Không sao chép đề ETS/Cambridge/JLPT/HSK thật. Nội dung demo trong `db/seed/demo/content.ts` và `apps/cms/samples/` do đội tự biên soạn, gắn `source = 'human'`; nội dung do AI sinh gắn `source = 'ai'` và phải qua luồng duyệt CMS (draft → ai_checked → review1 → review2 → published).

Cập nhật tệp này mỗi khi thêm dependency có giấy phép ngoài nhóm permissive, hoặc trước mỗi gate (`pnpm licenses list --json`).
