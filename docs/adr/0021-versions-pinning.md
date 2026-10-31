# ADR-0021: Ghim TypeScript 5.9.x, ESLint 9.x, Vitest 4.x

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-21) — bổ sung trong Sprint 0

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Ghim TypeScript 5.9.x, ESLint 9.x, Vitest 4.x (không lấy TypeScript 7 / ESLint 10 / Vitest 5 dù đã phát hành) cho tới khi NestJS CLI, drizzle-kit, Payload và typescript-eslint công bố hỗ trợ đầy đủ.

## Alternatives considered
Dùng bản mới nhất tuyệt đối.

## Consequences
Toolchain ổn định; nâng cấp qua ADR mới + `docs/VERSIONS.md`.
