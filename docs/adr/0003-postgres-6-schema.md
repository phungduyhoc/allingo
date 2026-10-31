# ADR-0003: Một cụm PostgreSQL, chia 6 schema

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-03) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Một cụm PostgreSQL, chia 6 schema (`iam`, `catalog`, `learn`, `ai`, `billing`, `ops`); pgvector; partition theo tháng cho bảng lớn.

## Alternatives considered
Nhiều DB theo module; MongoDB cho nội dung.

## Consequences
Giao dịch xuyên module đơn giản; JSONB cho nội dung linh hoạt; replica đọc cho báo cáo.
