# ADR-0006: BullMQ trên Redis cho job

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-06) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
BullMQ trên Redis cho job; outbox pattern cho domain event (bảng `ops.outbox`) → Meilisearch, thông báo, analytics.

## Alternatives considered
Kafka/RabbitMQ.

## Consequences
Đủ cho quy mô năm 1; idempotency theo jobId; dead-letter + retry mũ.
