# ADR-0008: Azure AI Speech cho STT, Pronunciation Assessment, TTS qua interface `SpeechProvider`

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-01
- **Nguồn:** Thiết kế kỹ thuật v1.0 (ADR-08) 

## Context
Quyết định này nằm trong bộ quyết định kiến trúc nền tảng của Allingo (monorepo TypeScript, modular monolith, PostgreSQL 6 schema, AI Gateway).

## Decision
Azure AI Speech cho STT, Pronunciation Assessment, TTS qua interface `SpeechProvider`.

## Alternatives considered
Google Speech; mô hình tự host.

## Consequences
Chấm âm vị/thanh điệu en-ja-zh ngay; có thể thay bằng self-host khi chi phí lớn.
