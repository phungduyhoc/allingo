# ADR-0001: TypeScript end-to-end trong monorepo Turborepo + pnpm

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-01) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
TypeScript end-to-end trong monorepo Turborepo + pnpm.

## Alternatives considered
.NET + Flutter; Go backend.

## Consequences
Chia sẻ type/schema, một pipeline CI; tuyển dụng dễ; chấp nhận Node cho CPU-bound nhỏ.
