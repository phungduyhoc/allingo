# ADR-0037: Công cụ sản xuất nội dung trên catalog – passage nhiều văn bản, hàng chờ duyệt, nhập Excel, lọc trùng, AI soạn đề nháp

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-09
- **Nguồn:** Backlog B5 + B2 (SPEC-ISSUES S24, S30; ASSUMPTIONS A26); bổ sung ADR-0019 (CMS ↔ catalog), ADR-0024 (vòng đời nội dung), ADR-0026 (AI Gateway), ADR-0027 (JobsService)

## Context
- `catalog.questions.passage_id` chỉ trỏ một đoạn: bộ đôi/bộ ba TOEIC Part 7 phải gộp thành một passage `[Tiêu đề]\n…` (`mergeGroupPassages`) –
  giao diện không tách được từng văn bản (S24). CMS có collection `passages` nhưng chưa đồng bộ passage sang catalog.
- Đề sinh tự động (mini generator) không có chỗ lưu seed/blueprint ngoài audit log (S30).
- Sản xuất nội dung (T4: ≥ 3.000 câu) cần: AI soạn nháp cả đề theo blueprint, nhập hàng loạt từ Excel (biên tập viên quen bảng tính), lọc trùng
  khi tạo/nhập/AI sinh (trước đây chỉ có ở job `content.generate` của S5 và pg_trgm khi nhập CMS), hàng chờ duyệt có lọc/hàng loạt/phân công.
- Trình dựng bộ đề trong CMS là trường mảng mặc định của Payload (A26) – khó sắp nhóm passage, không kiểm blueprint.

## Decision
1. **`catalog.passage_parts`** (migration 0011): văn bản từng phần theo `sort_order`; `passages.body` vẫn là bản gộp (client cũ, AI giải thích,
   transcript). API trả `passage.parts` (chỉ khi ≥ 2 văn bản – tương thích ngược, OpenAPI `PassagePart`); web hiện tablist WAI-ARIA ở làm bài,
   Exam Mode, xem lại, chẩn đoán, hàng chờ duyệt. Seed đề mẫu ghi part cho mọi nhóm Part 7 đa đoạn (giữ `mergeGroupPassages` làm dự phòng).
2. **Đồng bộ passage CMS → catalog** qua `POST /internal/content/passages/sync`, **id catalog = id passage CMS** (uuid) → upsert idempotent theo
   id, không cần cột external_ref; câu sync gửi `passage_id` (CMS đồng bộ passage trước mỗi lần sync câu có passage).
3. **`catalog.test_sets.metadata jsonb`** (S30): `source = mini_generator | ai_draft`, seed/blueprint/bank_fingerprint/summary; vẫn ghi audit log.
4. **Công cụ nội dung làm việc trực tiếp trên catalog** (nguồn sự thật, ADR-0024) qua API admin – web `/admin/content` (tab Hàng chờ duyệt /
   Nhập Excel / AI soạn đề; editor/teacher chỉ thấy các tab này). Câu tạo ở đây không xuất hiện trong collection CMS (như `POST /admin/questions`
   từ S2); CMS vẫn là nơi soạn/sửa chi tiết và dựng bộ đề CMS.
5. **Hàng chờ duyệt** = truy vấn bản head (kể cả bản sửa chờ duyệt của câu đã phát hành) + AI check gần nhất + kiểm tra tự động tất định
   (`runAutoChecks` trong `@allingo/schemas`, mã i18n) + cờ trùng. Hàng loạt đi qua `ContentWorkflowService.review` **từng câu một transaction**
   (một câu lỗi không chặn câu khác, kết quả theo câu); stage suy ra từ trạng thái hiện tại; phân công = cột `questions.review_assignee_id`
   (teacher/admin; người được giao phải có vai trò duyệt) + audit.
6. **Lọc trùng** `ContentDedupService`: embedding qua `AiGateway.embeddings` (thực thể `question_dedup`, văn bản = ≤ 400 ký tự đầu của đoạn văn +
   đề bài; câu cùng passage không so với nhau), cosine ≥ `AI_DEDUP_COSINE_THRESHOLD`; embedding lỗi → pg_trgm ≥ `CONTENT_DEDUP_TRGM_THRESHOLD`;
   ứng viên = bản head chưa từ chối/gỡ cùng chương trình + Part (nháp trùng nháp cũng bị gắn cờ). Tạo/sửa câu (API, CMS sync) → job
   `content.dedup` (jobId = version + băm nội dung); nhập Excel/AI soạn đề kiểm theo lô. Job S5 `content.generate` giữ nguyên thuật toán cũ.
7. **Nhập Excel không thêm thư viện**: bộ đọc/ghi .xlsx tối giản bằng `node:zlib` (`catalog/import/xlsx.ts` – ZIP + SpreadsheetML: shared
   strings/rich text/inline/số/boolean; ghi style Arial, header #0B3BA7, data validation làm chú thích cột). Tệp đọc trong request; kiểm tra/ghi là
   job `content.import`; xác nhận phải gửi lại cùng tệp + `confirm_fingerprint` (sha256 của dry-run); mọi dòng hợp lệ ghi trong **một transaction**;
   `external_ref` = `import:<import_key>` hoặc `xlsx:<fingerprint>:<dòng>` → nhập lại idempotent.
8. **AI soạn nháp cả đề**: prompt mới `generate_item_set` (passage 1–3 văn bản + câu của nhóm; JSON Schema → Zod sinh bằng `schemas:gen-ai`; seed
   registry) cho Part có `group_size`, `generate_questions` theo lô 10 cho Part đơn; job `content.draft_test` tạo **test set nháp** ngay khi bắt đầu
   (hàng chờ lọc theo `test_set_id`), mỗi nhóm passage + part + câu một transaction, external_ref `ai-draft:<job>:<part>:<n>` (chạy lại không trùng),
   rồi `check_question` + lọc trùng. Phát hành đề nháp: `POST /admin/test-sets/{id}/publish` (teacher/admin, mọi câu published + cấu trúc hợp lệ).
9. **Trình dựng bộ đề CMS (A26)**: custom view `/admin/test-set-builder` – kéo thả HTML5 + nút ↑/↓ (bàn phím) trên Part và "khối" (câu đơn
   hoặc trọn nhóm passage – luôn liền nhau), thêm/bớt câu từ ngân hàng CMS, blueprint lưu ở trường `test_sets.blueprint` (hook chặn xuất bản khi
   lệch), kiểm cấu trúc qua `POST /api/test_sets/validate-structure` (API nội bộ) – lưu/xuất bản bằng REST collection (hook hiện có).

## Consequences
- (+) Part 7 đa đoạn hiển thị đúng định dạng thi; dữ liệu cũ không cần chuyển đổi (không có part → như trước).
- (+) Đầu vào nội dung có ba đường (AI soạn đề, Excel, CMS) cùng một hàng chờ duyệt, cùng máy trạng thái, cùng cờ trùng.
- (−) Câu tạo bằng công cụ web không có bản trong CMS – sửa chi tiết qua `POST /admin/questions/{id}/versions` hoặc nhập lại; đồng bộ ngược
  catalog → CMS là việc sau (S158).
- (−) Bộ đọc xlsx tự viết không hỗ trợ ZIP64/mã hoá/ô gộp; tệp > 1 MB/1.000 dòng phải tách.
- (−) Mock embedding không mang ngữ nghĩa – ngưỡng cosine cần đo lại với embedding thật (A63, S160).
