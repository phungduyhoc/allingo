# ADR-0016: Video shadowing chỉ nhúng YouTube

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-16) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Video shadowing chỉ nhúng YouTube; media tự có trên S3 với signed URL; transcript tự tạo.

## Alternatives considered
Host video.

## Consequences
Đúng ToS, chi phí băng thông thấp.
