# ADR-0011: Credit ledger append-only

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-11) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Credit ledger append-only (`billing.credit_ledger`) + bảng số dư; trừ credit trong cùng transaction với `ai.ai_tasks`.

## Alternatives considered
Trừ trực tiếp trên cột số dư.

## Consequences
Truy vết từng credit; không âm; hoàn credit khi job lỗi.
