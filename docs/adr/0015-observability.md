# ADR-0015: OpenTelemetry → Grafana stack

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-15) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
OpenTelemetry → Grafana stack; Sentry (web/mobile); Langfuse (AI).

## Alternatives considered
Datadog.

## Consequences
Chi phí thấp, dữ liệu trong tầm kiểm soát.
