# ADR-0014: Container + Terraform

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-14) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Container + Terraform; Phương án A (K8s managed trong nước) hoặc B (Azure Container Apps) chọn tại GATE-1.

## Alternatives considered
Vercel + Supabase.

## Consequences
Đổi cloud không đổi code; chấp nhận thêm công DevOps.
