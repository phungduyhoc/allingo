# ADR-0005: Nội dung câu hỏi là JSONB có phiên bản

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-05) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Nội dung câu hỏi là JSONB có phiên bản (`question_versions.content`) kiểm tra bằng Zod theo `question_type.code`; schema Zod ở `packages/schemas` dùng cả client.

## Alternatives considered
Bảng riêng cho mỗi dạng câu.

## Consequences
12 dạng câu + CJK không đổi DDL; render/chấm theo discriminated union.
