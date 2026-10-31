# ADR-0009: Better Auth

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-09) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Better Auth (self-host): JWT access 15 phút + refresh xoay vòng; cookie httpOnly cho web, bearer cho mobile; OTP Zalo/SMS qua plugin.

## Alternatives considered
Clerk; Supabase Auth; Keycloak.

## Consequences
Dữ liệu định danh ở trong nước; chi phí không theo MAU. Xem ADR-0020 về cách triển khai lõi auth trong Sprint 0..
