# ADR-0002: Modular monolith NestJS

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-02) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Modular monolith NestJS (Fastify adapter); worker là deployable riêng cùng codebase.

## Alternatives considered
Microservice từ đầu; Hono thuần.

## Consequences
Ranh giới module rõ, deploy đơn giản; tách service khi một module cần scale riêng (dự kiến `grading`, `speech`).
