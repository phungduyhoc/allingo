# ADR-0012: Thanh toán webhook-first qua `PaymentProvider` adapter

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-12) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Thanh toán webhook-first qua `PaymentProvider` adapter (VNPay, MoMo, ZaloPay, PayOS, Stripe); idempotency key; job đối soát hằng ngày.

## Alternatives considered
Chỉ redirect result.

## Consequences
Không mất giao dịch khi người dùng đóng trình duyệt.
