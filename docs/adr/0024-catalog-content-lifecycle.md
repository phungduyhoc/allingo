# ADR-0024: Catalog là nguồn sự thật vòng đời nội dung; CMS đồng bộ mọi lần lưu

- **Trạng thái:** Accepted (bổ sung ADR-0019)
- **Ngày:** 2026-11-01
- **Nguồn:** Sprint 2 – Catalog & CMS workflow duyệt 2 lớp

## Context
ADR-0019 (Sprint 0) để Payload giữ bản soạn thảo trong schema `cms` và chỉ đẩy sang `catalog` khi phát hành. Sprint 2 yêu cầu:
mỗi chuyển trạng thái ghi `catalog.content_reviews`; API quản trị theo OpenAPI (`/admin/questions`, `/admin/content/{type}/{id}/review`)
thao tác trên catalog; sửa câu đã phát hành tạo phiên bản mới mà attempt cũ vẫn trỏ bản cũ; phát hiện trùng với câu đã có.
Nếu catalog chỉ chứa câu đã phát hành thì `content_reviews` không có `entity_id` để gắn, và API quản trị không thấy bản nháp.

## Decision
1. **Catalog là nguồn sự thật** của vòng đời (draft → ai_checked → review1 → review2 → published → retired/rejected) và lịch sử duyệt.
   CMS (Payload) vẫn là giao diện soạn thảo, giữ bản làm việc trong schema `cms`, nhưng **mỗi lần đổi trạng thái hoặc nội dung**
   gọi `POST /internal/content/questions/sync` (idempotent theo `external_ref`). Đổi trạng thái mà catalog từ chối → CMS không lưu.
2. **Máy trạng thái dùng chung** `packages/schemas/src/content/workflow.ts` cho CMS hook và API: vòng 1 teacher/admin, vòng 2 admin,
   nguyên tắc 4 mắt (người duyệt vòng 2 ≠ vòng 1), `ai_checked` chỉ do hệ thống đặt, verdict AI `fail` chặn gửi duyệt.
3. **Phiên bản:** câu chưa từng phát hành sửa trực tiếp bản head; câu đã phát hành sửa → phiên bản mới ở trạng thái chờ duyệt
   (`question_versions.metadata.workflow_status`), `current_version_id` chỉ chuyển khi duyệt vòng 2 xong; người học luôn đọc
   `status = 'published'` + `current_version_id`. Ngoại lệ: teacher/admin sửa trực tiếp câu đã phát hành trong CMS → phát hành ngay
   phiên bản mới (giữ hành vi Sprint 0, có audit).
4. `content_reviews.decision` giữ enum DDL (approve/reject/needs_change); các mốc submit/retire/reopen ghi `ops.audit_logs`.
5. Phát hành/thu hồi phát outbox `content.published` / `content.retired` → worker cập nhật chỉ mục tìm kiếm.
6. **Tìm kiếm:** `SearchProvider` – Meilisearch khi sẵn sàng (index chỉ câu đã phát hành, không đáp án), PostgreSQL
   (ILIKE + pg_trgm) làm dự phòng/dev/test. **Trùng lặp:** pg_trgm `similarity ≥ 0,85` trên đề bài (embedding ở Sprint 5).

## Alternatives considered
- Giữ ADR-0019 nguyên trạng, lưu review trong `cms` – hai nơi lưu lịch sử duyệt, API quản trị không dùng được.
- Bỏ Payload, tự viết UI quản trị trên API – tốn công, mất sẵn có của Payload (form, media, quyền).

## Consequences
- CMS phụ thuộc API khi đổi trạng thái (soạn nháp vẫn lưu được khi API tắt, đồng bộ lại ở lần lưu sau).
- Bản sửa chờ duyệt lưu trạng thái trong JSONB (`metadata.workflow_status`) – đề xuất cột riêng ở SPEC-ISSUES S17.
- Mọi client quản trị (CMS, admin web sau này, script) dùng chung quy tắc duyệt.
