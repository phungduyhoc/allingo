# ADR-0038: Khu học đa chương trình (registry chương trình) và 14 dạng câu IELTS Reading/Listening

- **Trạng thái:** Accepted
- **Ngày:** 2026-11-09
- **Nguồn:** Backlog C1 + C2 (đặt nền cho C3 IELTS R/L, C4 Writing, C5 Speaking, C6 shadowing, C7 TOEIC S&W); bổ sung ADR-0005 (content JSONB),
  ADR-0024 (vòng đời nội dung), ADR-0028 (Exam Mode), ADR-0031/0032 (chẩn đoán, lộ trình)

## Context
- GĐ1 chỉ có TOEIC L&R: khu học nằm ở `/toeic/*`, logic chung so sánh cứng `program === 'toeic'` (kỹ năng theo Part, quy đổi điểm, phần thi
  "đọc trong audio", blueprint chẩn đoán, gợi ý mục tiêu, nhóm mục tiêu thống kê), web có hằng `PROGRAM = 'toeic'` ở ~20 tính năng.
- "Chương trình đang học" suy ra từ enrollment cập nhật gần nhất – đổi `current_level`/`fsrs_params` của TOEIC cũng làm TOEIC "đang học".
- 12 dạng câu S1 có `tfng`, `matching`, `fill_blank`, `map_label`… chung nhưng chưa đủ cho IELTS (giới hạn từ, ngân hàng từ, ví dụ trong
  matching headings, bảng/ghi chú/sơ đồ quy trình/biểu mẫu, bản đồ chọn chữ cái, "Choose TWO letters"); web chỉ có renderer 4 dạng.
- `fill_blank` để đáp án chấp nhận trong `blanks[].accepted` (ngoài `answer_key`) → API trả đáp án cho client khi đang làm bài (S163).

## Decision
1. **Registry chương trình** `@allingo/schemas/program/registry` (`PROGRAM_REGISTRY`): giai đoạn, cờ ra mắt `ff.catalog.program.<code>` (TOEIC
   không cờ), kỹ năng, phần thi (mã + kỹ năng + tự chấm), thang điểm (`toeic_lr` | `band` | `points`, `implemented`), mục tiêu (biên, bước,
   mặc định, cấp độ), phần thi đọc trong audio, cách đếm điểm thô (`per_question` | `per_item`), dạng câu hỗ trợ, kiểu chẩn đoán. Bản sao tĩnh
   của seed `catalog.programs/skills/sections` (test kiểm hai phía khớp). Logic chung (test engine, xem lại, sổ lỗi, thống kê, planner, chẩn đoán,
   gia sư, web) đọc registry – không còn so sánh `'toeic'`; mặc định khi client không gửi `program` là `DEFAULT_PROGRAM` (TOEIC, tương thích ngược).
2. **Quy đổi điểm theo chương trình** `@allingo/scoring` `scoreByProgram()`: TOEIC giữ nguyên S4 (Part → L/R, 5–495, tổng 10–990, ±25); IELTS band
   từ số câu đúng theo **mục đánh số** (`markCount()` – câu TFNG 5 mệnh đề = 5 câu hỏi; "Choose TWO" = 2) quy về /40, overall = trung bình band
   kỹ năng có mặt làm tròn .25/.75 (`partial` khi thiếu kỹ năng); JLPT/HSK chỉ khai báo thang. `by_section`/`by_skill` có thêm `marks/max_marks`.
   `suggestTargetFor()` và `targetBucketFor()` theo loại thang.
3. **Chương trình đang học** lưu tường minh `iam.users.active_program` (migration 0012, FK `catalog.programs`); NULL → hành vi cũ. `PATCH /me
   {active_program}` tạo enrollment nếu chưa có (mục tiêu/ngày thi/lộ trình vẫn tách theo chương trình trong `learn.enrollments`). `GET /programs`
   thêm `status` (available ⇔ cờ ra mắt bật VÀ có ≥ 1 đề phát hành), `phase`, `skills`, `published_test_sets`, `question_types`; `Enrollment` thêm
   `is_active/is_current` (bổ sung – client cũ bỏ qua).
4. **Route web `/[program]/…`** (dashboard, test-sets, practice, errors, stats, plan, today, diagnostic, vocab): thư mục `toeic` đổi thành
   `[program]` nên mọi URL `/toeic/...` giữ nguyên; `ProgramGate` đặt ngữ cảnh chương trình và hiện trang "sắp ra mắt" + danh sách chờ (POST
   /waitlist) cho chương trình chưa có nội dung (HTTP 200); mã chương trình sai bị proxy trả **404 thật** (như S152). `useProgram()` = route →
   ProgramProvider → `me.active_program` → TOEIC; bộ chọn chương trình (`<select>` gốc) ở dải đầu nội dung mọi trang khu học (header md–xl không đủ chỗ), Cài đặt
   (mục tiêu theo chương trình) và onboarding (chỉ chương trình đã mở).
5. **14 dạng câu IELTS R/L** (`question/rl-types.ts`) là thành viên mới của discriminated union (mã = `catalog.question_types.code`, seed core):
   4 dạng nối (`matching_headings` có dòng ví dụ, `matching_information`, `matching_features`, `matching_sentence_endings`), 8 dạng gõ đáp án
   (`sentence/summary/note/table/flow_chart/form_completion`, `short_answer`, `diagram_labelling`), `summary_word_bank`, `plan_map_labelling`.
   Nguyên tắc: **đáp án luôn trong `answer_key`**; chỗ trống `{{id}}` trong văn bản; `superRefine` kiểm tham chiếu đáp án ↔ chỗ trống/mục/lựa
   chọn (CMS/API/AI sinh câu đều bị từ chối khi lệch); giới hạn từ `word_limit {max_words, allow_number, number_only}`; chuẩn hoá đáp án gõ
   (`normalize.ts`: hoa thường, khoảng trắng, dấu câu bao quanh, gạch nối/nháy, dấu phân cách nghìn, phần tuỳ chọn "(the)", vượt giới hạn từ = sai)
   + chính tả Anh/Mỹ khi khai báo (`spelling.ts`). TFNG/YNNG giữ `tfng` + `variant` (S1); "Choose TWO letters" = `mcq_multi.select_count`.
6. **Renderer web** cho 14 dạng + `matching` chung: `<input>`/`<select>` gốc là thao tác chính (bàn phím, trình đọc màn hình, mobile – phím tắt màn
   thi bỏ qua khi đang ở ô nhập/chọn); kéo thả HTML5 chỉ là phương án thêm cho chuột (không thư viện); ảnh sơ đồ/bản đồ có ghim theo toạ độ %,
   `alt` bắt buộc + khối "Mô tả bằng chữ" (không cần nhìn), ghim bản đồ là nút có nhãn; bảng nằm trong vùng cuộn riêng. Xem lại/practice dùng
   `details` từng mục (practice feedback có thêm `details`). Hàng chờ duyệt xem trước bằng chính renderer (điền sẵn `keyAnswerOf()`), CMS có khối
   "Xem trước" (`describeQuestion()` + lỗi Zod) và migration Payload thêm giá trị enum dạng câu.
7. **AI qua AiGateway**: `describeQuestion()` biến mọi dạng thành đề/lựa chọn/mục đánh số + đáp án cho `explain_mcq` (thêm biến `items`,
   `instructions`), `tutor_chat` (`referenced_question.items`, chỉ lộ đáp án khi reveal – ADR-0028) và `check_question` (`format_notes` + mục
   format_rules); `POST /ai/explain` nhận `answer` của dạng nhiều mục, khoá cache = `a:` + sha256 câu trả lời.

## Consequences
- C3 chỉ cần nội dung + luồng thi IELTS (nghe một lần theo phần, đánh số "Questions 1–40", band trên giao diện) – không phải sửa logic chung;
  JLPT/HSK cần bảng quy đổi (`implemented: true`) và blueprint chẩn đoán.
- Thêm chương trình = thêm vào registry + seed (`program-registry.test.ts` bắt lệch) + i18n `sections.*`.
- Dạng câu mới phải có fixture ≥ 3 (test chấm), JSON Schema sinh (`gen:question`), renderer, nhãn i18n, nhãn CMS + migration Payload enum.
- `explain_mcq` giờ phủ cả dạng nhiều mục – bộ eval `explain_mcq_v1` cần thêm câu IELTS trước khi bật model thật (S169).
