# Mẫu nhập câu hỏi hàng loạt (CMS)

Trang admin **Nhập câu hỏi (JSON/CSV)** (`/admin/import-questions`) hoặc endpoint `POST /api/questions/import`
(body `{ "text": "<nội dung tệp>", "fileName": "x.json|x.csv", "format"?: "json"|"csv", "dryRun"?: true }`).
Mỗi dòng hợp lệ tạo một câu hỏi ở trạng thái **draft**; dòng lỗi được trả về trong `errors[{ row, message }]`.
Dòng có `import_key` trùng với câu đã có sẽ bị **bỏ qua** (`skipped`) – dùng để nhập lại an toàn.

## 1. JSON (mọi dạng câu)

Mảng các phần tử (hoặc `{ "questions": [...] }`):

| Trường | Bắt buộc | Giá trị |
| --- | --- | --- |
| `program` | ✓ | `toeic` \| `ielts` \| `jlpt` \| `hsk` |
| `section_code` | ✓ | mã phần, vd. `part5`; lấy từ `GET /api/questions/reference` |
| `question_type` | ✓ | 1 trong 12 mã: `mcq_single`, `mcq_multi`, `fill_blank`, `matching`, `drag_drop`, `map_label`, `tfng`, `ordering`, `dictation`, `essay`, `speaking`, `handwriting` |
| `difficulty` | | `A1..C2`, `N5..N1`, `HSK1..HSK7_9`, `mixed` |
| `topic_code` | | mã chủ đề (catalog.topics) |
| `subskill_codes` | | mảng mã kỹ năng con |
| `source` | | `human` (mặc định) \| `ai` \| `licensed` |
| `import_key` | | khoá idempotent, vd. `demo:toeic:p5-01` |
| `content` | ✓ | JSON theo `questionContentSchema` của `@allingo/schemas` (xem `QUESTION_FIXTURES[type].content` để lấy mẫu từng dạng) |

Ví dụ đầy đủ: `samples/questions.sample.json` (16 câu TOEIC Part 5/Part 2 tự soạn, `source = human`).

## 2. CSV (chỉ `mcq_single`)

Header bắt buộc (không phân biệt hoa thường), UTF-8, dấu phẩy, giá trị có dấu phẩy/ngoặc kép đặt trong `"..."`:

```
program,section_code,question_type,difficulty,stem,option_a,option_b,option_c,option_d,correct,explanation_vi,explanation_en,evidence
```

- Bắt buộc: `program, section_code, question_type (= mcq_single), stem, option_a, option_b, correct`.
- `option_c`, `option_d` (và `option_e`, `option_f`) tuỳ chọn – bỏ trống để có câu 2–3 lựa chọn (Part 2).
- `correct`: chữ cái A–F của đáp án đúng.
- Tuỳ chọn thêm: `topic_code`, `subskill_codes` (phân cách bằng `|`), `tags` (phân cách `|`), `source`, `import_key`.
- Listening Part 1/2 có thể để `stem` trống trong JSON; CSV yêu cầu `stem` nên dùng JSON cho các dạng này.

Ví dụ: `samples/questions.sample.csv`.

## 3. Quy tắc validate

- `content.type` phải trùng `question_type`; đáp án đúng phải nằm trong `options`; mã lựa chọn không trùng.
- Lỗi Zod được trả theo đường dẫn trường, vd. `options[1].text: Too big...`.
- Không nhập nội dung sao chép từ đề thi thật (ETS/Cambridge/JLPT/HSK). Nội dung AI sinh phải ghi `source = ai`.
