# ADR-0019: Payload CMS giữ dữ liệu soạn thảo trong schema `cms`

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-19) — bổ sung trong Sprint 0

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Payload CMS giữ dữ liệu soạn thảo trong schema `cms` (bảng do Payload quản lý) và đồng bộ sang `catalog`/`ai` qua hook + job `content.sync` khi phát hành; `catalog` là nguồn sự thật cho người học.

## Alternatives considered
Payload ghi trực tiếp vào bảng `catalog` qua adapter tuỳ biến.

## Consequences
Tách vòng đời soạn thảo khỏi runtime; Payload nâng cấp không ảnh hưởng DDL; chấp nhận một bản sao nội dung và độ trễ đồng bộ vài giây. Đánh giá lại ở Sprint 2 khi workflow duyệt hoàn chỉnh.
