# ADR-0020: Sprint 0 triển khai lõi xác thực trong module `iam`

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-20) — bổ sung trong Sprint 0

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Sprint 0 triển khai lõi xác thực trong module `iam` (Argon2id, JWT HS256 access 15 phút, refresh xoay vòng băm trong `iam.sessions`, phiên khách) khớp DDL; Better Auth được tích hợp ở Sprint 1 cho social OAuth/OTP qua adapter, giữ nguyên bảng `iam.*`.

## Alternatives considered
Dùng Better Auth làm engine ngay từ Sprint 0 với bảng riêng (`auth` schema) và chiếu sang `iam.*`.

## Consequences
Không phát sinh bảng ngoài DDL, `db:diff` sạch, hợp đồng token đúng CLAUDE.md; Sprint 1 cần viết adapter Better Auth ↔ `iam.auth_identities`.
