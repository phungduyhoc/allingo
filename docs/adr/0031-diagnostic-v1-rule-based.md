# ADR-0031: Bài chẩn đoán đầu vào v1 – thích ứng theo quy tắc (2 đúng / 2 sai), không IRT

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-02
- **Nguồn:** Sprint 9 – Diagnostic (PRD FR-LP-*, thiết kế kỹ thuật §6.4); CAT/IRT thật ở GĐ4

## Context
- Người học mới cần biết mức hiện tại trong 25–30 phút để sinh lộ trình; đề full 200 câu/120 phút quá dài cho onboarding.
- Chưa có dữ liệu để hiệu chỉnh tham số IRT (`catalog.questions.irt_*` rỗng) – CAT thật chưa khả thi; ngân hàng demo chỉ có nhãn
  `difficulty_target` A2/B1/B2 + subskill.
- OpenAPI có `POST /me/diagnostic/{attemptId}/next` (gửi câu trả lời, nhận câu kế tiếp/kết luận) nhưng chưa có luật chọn câu.

## Decision
1. **Ngân hàng**: test set `kind = diagnostic` (`toeic-diagnostic-01`, 61 câu) dựng từ câu đã có trong seed (Listening 01 + Reading 01),
   hai mức mỗi Part: mức 1 = câu lẻ A1/A2 hoặc nhóm passage không có câu B2; mức 2 = câu lẻ từ B1 hoặc nhóm có câu B2 (`unitLevel`).
2. **Luật thích ứng** (thuần, `@allingo/scoring` `diagnosticAdvance`): đơn vị = câu lẻ hoặc TRỌN nhóm passage (giữ nhóm); mức theo
   kỹ năng (Listening/Reading) bắt đầu ở 1; **đúng 2 liên tiếp → tăng, sai 2 liên tiếp → giảm**, đổi mức thì đếm lại; trong mỗi Part
   chọn đơn vị đúng mức, ưu tiên subskill ít được đo nhất; dừng khi đủ blueprint TOEIC (P1 2, P2 4, P3 2 nhóm, P4 1 nhóm, P5 8, P6 1
   nhóm, P7 2 nhóm ≈ 31 câu).
3. **Trạng thái** lưu `learn.attempts.draft_state.adaptive` (Zod `diagnosticStateSchema`), cập nhật trong một transaction khoá hàng
   attempt (`AttemptsService.adaptiveStep`) – chống bấm đúp, tải lại trang trả đúng câu đang chờ. Attempt chỉ lộ câu đã phục vụ;
   nộp chỉ chấm câu đã phục vụ (câu dự trữ không tính sai).
4. **Kết quả**: điểm câu theo (mức, đúng/sai) 0,9/0,65/0,35/0,1 → năng lực θ → % đúng tương đương → thang quy đổi Allingo; khoảng =
   ±1,96·SE (tối thiểu ±35 kỹ năng, ±50 tổng); `learn.skill_mastery` khởi tạo = trung bình điểm câu theo subskill (confidence n/(n+2));
   `enrollments.current_level` ghi điểm ước tính; gợi ý mục tiêu khả thi = mô phỏng từng tuần tới ngày thi (tốc độ tăng theo mức ×
   giờ/tuần × 75 % tuân thủ).
5. Endpoint: `POST /me/diagnostic` (bắt đầu/tiếp tục – v1.1), `GET|POST /me/diagnostic/{attemptId}/next`.

## Consequences
- Ước tính thô (≈ 30 câu, 2 mức) – UI luôn ghi "ước tính" và hiển thị khoảng; hiệu chỉnh hệ số khi có dữ liệu GĐ1.
- Câu chẩn đoán trùng đề full 01 (người học gặp lại) – chấp nhận ở demo, thay bằng ngân hàng riêng khi có nội dung (A131).
- GĐ4 thay `diagnosticAdvance` bằng CAT/IRT giữ nguyên hợp đồng API và vị trí lưu trạng thái.
