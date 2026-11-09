# ADR-0039: Đề IELTS Reading & Listening định dạng thi trên máy tính – đánh số theo mục, đồng hồ theo kỹ năng, nghe một lần ở server

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-09
- **Nguồn:** Backlog C3 (HANDOFF §5a); SPEC-ISSUES S167, S168, S169, S170; ASSUMPTIONS A248, A251, A253, A255; bổ sung ADR-0028 (Exam
  Mode), ADR-0037 (công cụ nội dung), ADR-0038 (registry chương trình, 14 dạng câu IELTS)

## Context
- C1/C2 đã có registry chương trình, `scoreByProgram()`, `markCount()` và 14 dạng câu IELTS nhưng: đánh số mỗi câu catalog một số (S167),
  band Reading dùng chung bảng Listening, overall tính cả khi thiếu kỹ năng, kiểm cấu trúc đề đếm câu catalog (đề IELTS 40 mục chỉ có
  12–14 câu catalog), chuỗi nghe "một lần" thiết kế cho TOEIC và chỉ giữ ở client (S170), không có đồng hồ theo section.
- Thi IELTS trên máy tính: Reading 3 passage/40 câu/60 phút (Academic hoặc General Training – bảng quy đổi khác nhau); Listening 4 part/
  40 câu, đọc trước mỗi part, nghe liên tục một lần, trả lời trong lúc nghe, 2 phút xem lại ở cuối (không có 10 phút chép đáp án như thi giấy).

## Decision
1. **Quy đổi band** (`@allingo/scoring`): `ieltsListeningBand`, `ieltsReadingBand(correct, total, module)` với bảng Academic và GT tách
   riêng (unit test mốc biên từng bảng); `scoreByProgram({ module })`. Overall chỉ khi đủ 4 kỹ năng; bài một kỹ năng → `value` = band kỹ năng
   đó; bài 2–3 kỹ năng → `value = null`, band từng kỹ năng ở `scale.bands`. Module = `catalog.test_sets.level` (`academic` |
   `general_training`; đề Listening `null`) – không thêm cột. `suggestTargetFor('band')`, `estimateIeltsDiagnostic` cho chẩn đoán/lộ trình.
2. **Đánh số theo mục** (S167): `numberMarks()` tính `number_start`/`mark_count` từ `markCount` theo thứ tự làm bài; server trả trong
   `QuestionPublic` (attempt + review) vì `markCount` cần `answer_key`. TOEIC (`per_question`) → `number_start = order_no`. Web: lưới số,
   điều hướng tới đúng mục, renderer đánh số từ offset, tổng quan đã làm/đánh dấu theo mục (đánh dấu vẫn theo câu catalog).
3. **Cấu trúc & kiểm tra đề**: `validateTestSetStructure(..., { marking })` đếm theo mục với chương trình `per_item`; `runTestSetChecks`
   (`numbering_gap`, `ielts_mark_total`, `ielts_section_marks`, `listening_part_audio_missing`, `listening_part_multiple_audio`) chạy ở publish
   API/CMS (lỗi chặn xuất bản IELTS; TOEIC chỉ thông tin). Hằng `IELTS_CBT` dùng chung API/web/CMS/seed.
4. **`exam_format` (`ielts_cbt`)** cố định lúc tạo attempt (lưu draft): module, `preread_sec` (30), `review_sec` (120), `listening_parts[]`
   (asset audio của part, thời lượng, `started_at`, `played`). Rules section Listening trong seed core: `flow: continuous`, `preread_sec`,
   `review_sec` (part 4).
5. **Đồng hồ theo kỹ năng** (exam + đề `full`): `sections[].skill/ends_at/locked`; Listening = Σ(đọc trước + audio part) + xem lại, Reading
   60 phút; `expires_at` = tổng. Sự kiện `part_switch {section_code}` bắt đầu kỹ năng sau và khoá kỹ năng trước; đáp án vào kỹ năng đã khoá bị
   bỏ, cả lô bị khoá → 409 `conflict` `details.reason = section_locked`. Mini/drill giữ một đồng hồ chung.
6. **Nghe một lần ở server** (exam): `audio_started {asset_id}` đầu tiên mở cửa sổ phát = thời lượng part + 60 s (không biết thời lượng →
   10 phút); hết cửa sổ server không trả URL (attempt `media_url = null`, `/media` bỏ asset). Tua/dừng trong cửa sổ chỉ chặn ở client.
   Practice nghe lại tự do; transcript sau khi nộp.
7. **Luồng nghe liên tục** (S170) ở web: `buildIeltsListeningProgram` dùng lại sequencer/engine TOEIC: mỗi part đọc trước → audio part →
   … → xem lại → tự nộp (exam). Câu của part mở khi bắt đầu đọc trước part đó. TOEIC không đổi.
8. **Kết quả & xem lại**: thẻ band IELTS (band kỹ năng, overall khi đủ 4 kỹ năng, Academic/GT, "ước tính"), số câu đúng /40 theo mục,
   `by_question_type.marks`, `by_section` theo passage/part; transcript có mốc, `evidence_segments` (khớp từng dòng `content.evidence` với
   segment) tô và tua tới mốc.
9. **Nội dung tự biên soạn** (`@allingo/schemas/content/ielts-full`) dùng chung seed demo và mock web: `ielts-reading-academic-01`,
   `ielts-listening-01` (audio qua `SpeechProvider`/`seed:media`). Seed demo bật `ff.catalog.program.ielts` (core vẫn tắt).
10. **S168**: web làm mới `/programs` khi cờ `ff.catalog.program.*` đổi. **S169**: bộ eval `explain_mcq_ielts_v1.jsonl` (157 dòng, ngoại tuyến)
   + khối promptfoo riêng cho dạng nhiều mục; `explainEvalLineSchema` nhận dạng nhiều mục.

## Consequences
- (+) Không thêm bảng/cột (`test_sets.level`, `draft_state`, `sections.rules`); hợp đồng API chỉ thêm trường tuỳ chọn.
- (+) Thêm đề IELTS mới chỉ cần nội dung; kiểm tra tự động bắt lệch 40 mục/đánh số/audio trước khi xuất bản.
- (−) `scaled_score` của bài IELTS L+R nay là null (trước: trung bình) – thống kê/dự báo đọc band kỹ năng qua `scaledPartsOf`.
- (−) Nghe một lần ở server chỉ khống chế số lần lấy URL trong cửa sổ, không chống tải audio về trong cửa sổ.
- (−) Đề mini IELTS (`mini-test.service`) vẫn đếm câu catalog; kịch bản Listening mẫu ~450 từ/part (≈ 12–14 phút audio thật) – cần dài hơn
  cho đúng ~30 phút.
