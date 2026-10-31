# ADR-0018: Mobile bằng Expo dùng chung `packages/*`

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-18) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Mobile bằng Expo dùng chung `packages/*`; không IAP năm 1.

## Alternatives considered
Flutter.

## Consequences
Chia sẻ 60–70% code; app chỉ đăng nhập dùng gói mua trên web.
