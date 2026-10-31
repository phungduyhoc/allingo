# ADR-0004: Drizzle ORM + migration SQL

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-04) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Drizzle ORM + migration SQL (0001 = DDL gốc, các migration sau do drizzle-kit sinh và rà soát tay); không lazy loading.

## Alternatives considered
Prisma; TypeORM.

## Consequences
Kiểm soát SQL, hiệu năng dự đoán được; mọi truy vấn phức tạp viết SQL rõ ràng; `pnpm db:diff` giữ Drizzle ↔ DDL tương đương.
