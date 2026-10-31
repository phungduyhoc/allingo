# ADR-0007: AI Gateway là module trong `api`/`worker` với adapter theo nhà cung cấp

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-07) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
AI Gateway là module trong `api`/`worker` với adapter theo nhà cung cấp; prompt registry trong DB; structured output JSON Schema.

## Alternatives considered
LiteLLM proxy riêng; LangChain.

## Consequences
Không khoá nhà cung cấp; metering credit nằm cùng giao dịch; đổi model không deploy.
