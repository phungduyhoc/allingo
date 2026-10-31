# ADR-0010: Entitlement vật chất hoá trong `billing.entitlements`

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-10) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Entitlement vật chất hoá trong `billing.entitlements`; quota ngày/tháng đếm trong Redis, chốt về DB hằng đêm.

## Alternatives considered
Tính động từ subscription mỗi request.

## Consequences
Kiểm tra quyền O(1); audit được.
