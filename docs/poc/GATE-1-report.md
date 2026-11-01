# GATE-1 — Báo cáo PoC chấm Writing (PoC-W) và Pronunciation (PoC-P)

- **Trạng thái:** KHUNG BÁO CÁO + kết quả chạy **MOCK** ngày 01/11/2026 để kiểm chứng harness.
- **Kết luận GATE-1:** **CHƯA KẾT LUẬN ĐƯỢC.** Chưa có dataset có band giáo viên, chưa có API key AI/Azure Speech trong phiên. Mọi con số ở mục 5 do MockProvider/MockSpeechProvider sinh ra, **KHÔNG phải số liệu thật** và không được dùng cho quyết định.
- **Mã nguồn:** `eval/poc/` (không ảnh hưởng runtime) · ADR-0025 (media pipeline & SpeechProvider) · ngưỡng: `docs/spec/allingo-prompts.yaml` (`prompts[].eval.thresholds`).

## 1. Câu hỏi quyết định

| PoC | Câu hỏi | Quyết định phụ thuộc |
| --- | --- | --- |
| PoC-W | LLM chấm IELTS Writing (Task 1/2) qua `grade_writing_ielts` có đạt độ lệch so với giáo viên trong ngưỡng không? Model nào làm mặc định? | Bật tính năng chấm Writing ở GĐ2; `ai.model_routes` cho `grade_writing_ielts`; giá credit (60/bài) |
| PoC-P | Azure Pronunciation Assessment + bảng ánh xạ PA → band có khớp band Pronunciation của giáo viên không? Chi phí/độ trễ? | Dùng Azure làm `SpeechProvider` mặc định; giữ/hiệu chỉnh `scoring_rules.ielts_pronunciation_from_pa` |

## 2. Ngưỡng (nguồn: `docs/spec/allingo-prompts.yaml`)

### 2.1 PoC-W — `grade_writing_ielts`, eval set `ielts_writing_v1`

| Khoá | Ngưỡng | Metric trong harness | Định nghĩa |
| --- | --- | --- | --- |
| `mae_overall_max` | ≤ 0,5 | `mae_overall` | Trung bình \|overall AI − overall GV\| (GV = trung bình 2 giáo viên) |
| `within_0_5_min` | ≥ 0,8 | `within_0_5` | Tỉ lệ bài lệch ≤ 0,5 band |
| `pearson_min` | ≥ 0,8 | `pearson` | Tương quan Pearson overall AI vs GV |
| `criterion_mae_max` | ≤ 0,6 | `criterion_mae` | MAE lớn nhất trong 4 tiêu chí (TR/TA, CC, LR, GRA) |
| `consistency_std_max` | ≤ 0,25 | `consistency_std` | Trung bình độ lệch chuẩn mẫu (n−1) của overall qua N lần chạy lặp trên tập con |
| `cost_usd_max` | ≤ 0,06 | `cost_usd` | Chi phí trung bình/bài (ước tính từ token theo bảng giá trong adapter) |
| `latency_p95_ms_max` | ≤ 45 000 | `latency_p95_ms` | p95 độ trễ end-to-end của `AiGateway.runTask` |

### 2.2 PoC-P — Pronunciation Assessment

Spec chưa có eval set riêng cho PA (đề xuất SPEC-ISSUE). Harness dùng các ngưỡng áp dụng được cho **một tiêu chí** từ `grade_speaking_ielts` (`ielts_speaking_v1`):

| Khoá | Ngưỡng | Metric | Định nghĩa |
| --- | --- | --- | --- |
| `criterion_mae_max` | ≤ 0,6 | `criterion_mae` | MAE band PA→band vs band Pronunciation GV |
| `within_0_5_min` | ≥ 0,8 | `within_0_5` | Tỉ lệ lệch ≤ 0,5 band |
| `pearson_min` | ≥ 0,8 | `pearson` | Tương quan band PA vs GV (báo kèm `pearson_pa_score` trên thang 0–100) |
| Điều kiện dữ liệu | ≥ 100 ghi âm, ≥ 10 người, A2–C1 | `n_ok`, `speakers` | Theo prompt Sprint 2; thiếu → `insufficient_data` |

Ánh xạ PA → band: `scoring_rules.ielts_pronunciation_from_pa` (`pa_score = 0,5·accuracy + 0,25·fluency + 0,25·prosody`), cài đặt duy nhất ở `@allingo/scoring.paToIeltsBand`, gọi qua `pronunciationBandFromPa()` (module speech). Prosody thiếu → thay bằng fluency và đếm `prosody_imputed`.

## 3. Phương pháp PoC-W

- **Dataset:** JSONL theo `eval/poc/writing/dataset.schema.json` — `task_type` (task2 | task1_academic | task1_general), đề, mô tả biểu đồ (bắt buộc với Task 1 Academic), bài viết, `teacher_bands[]` (2 giáo viên, đủ overall + 4 tiêu chí), `band_source` (`teacher` | `assumed`). Bài tự biên soạn hoặc bài người học nội bộ đã ẩn danh; không dùng đề/bài mẫu Cambridge/IDP/BC.
- **Chạy:** mỗi model route (`POC_W_MODELS`, mặc định `anthropic:claude-sonnet,openai:gpt,google:gemini-pro`) chấm toàn bộ dataset 1 lần + `POC_W_REPEATS−1` lần trên `POC_W_REPEAT_SUBSET` bài đầu (mặc định 3 lần × 40 bài như spec). Gọi thật qua `AiGateway.runTask('grade_writing_ielts')` (registry DB, Handlebars, validate Zod → repair → fallback, metering `ai.ai_tasks` với `user_id = null`, không trừ credit). Route được ghi đè **trong tiến trình** (bọc `TaskRegistry.resolve`, primary = alias đang thử, không fallback) — không sửa `ai.model_routes`.
- **Bảo vệ kết quả:** chế độ `live` mà provider thiếu key (router rơi về mock) → model đó được đánh dấu `not_configured`, không tính là kết quả.
- **Đầu ra:** `eval/poc/writing/results/<timestamp>.json` (metrics, checks theo ngưỡng, verdict `go | no_go | insufficient_data | mock_only`, kết quả từng bài, độ đồng thuận giữa 2 giáo viên làm "trần" tham chiếu).

## 4. Phương pháp PoC-P

- **Manifest:** JSONL theo `eval/poc/pronunciation/manifest.schema.json` — `speaker_id` ẩn danh, `audio_path` (WAV/OGG/MP3/WEBM/M4A), `reference_text`, `locale`, `cefr_level`, `teacher_pron_bands[]`, `band_source`.
- **Chạy:** nhận dạng chữ ký tệp → ffmpeg chuyển WAV PCM 16 kHz mono → `SpeechProvider.assessPronunciation` (Azure REST short-audio, header `Pronunciation-Assessment` base64 JSON, `HundredMark`, `Comprehensive`, prosody bật) → PA → band.
- **Thống kê:** phân bố accuracy/fluency/prosody/completeness/PronScore/pa_score (mean, std, min, p10, p50, p90, max), histogram band, theo CEFR, MAE/within/Pearson vs GV, p50/p95 độ trễ, real-time factor, chi phí/phút = `POC_P_PRICE_PER_AUDIO_HOUR_USD`/60 (mặc định 1 USD/giờ — **cần xác nhận bảng giá Azure hiện hành**).
- **Giới hạn REST short-audio:** ~30 s/đoạn; đoạn dài hơn được gắn cờ `over_30s_rest_limit` (bản S6 dùng SDK/continuous hoặc cắt đoạn).
- **Đầu ra:** `eval/poc/pronunciation/results/<timestamp>.json`.

## 5. Kết quả chạy MOCK (01/11/2026) — KHÔNG PHẢI SỐ LIỆU THẬT

> Mục đích duy nhất: chứng minh harness chạy end-to-end, đọc đúng ngưỡng và tính đúng metric. MockProvider luôn trả overall 6,0; MockSpeechProvider trả điểm giả lập xác định theo hash trên audio sine tổng hợp; band trong dataset mẫu là **giả định**.

### 5.1 PoC-W (`AI_PROVIDER=mock`, 5 bài mẫu tự biên soạn: 3 Task 2, 1 Task 1 Academic, 1 Task 1 General; band giả định)

| Model route | Model thực chạy | n | MAE | within 0,5 | Pearson | criterion MAE | std lặp (3×5) | USD/bài | p95 ms | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| anthropic:claude-sonnet | mock:mock-1 | 5/5 | 0,85 | 0,40 | — (dự đoán hằng) | 0,90 | 0 | 0 | 78 | mock_only |
| openai:gpt | mock:mock-1 | 5/5 | 0,85 | 0,40 | — | 0,90 | 0 | 0 | 8 | mock_only |
| google:gemini-pro | mock:mock-1 | 5/5 | 0,85 | 0,40 | — | 0,90 | 0 | 0 | 16 | mock_only |

Kiểm chứng tính tay: band "GV" giả định 7; 5,5; 4,5; 6,25; 7 so với 6,0 → MAE = 4,25/5 = 0,85; within = 2/5 = 0,40; Pearson không xác định vì phương sai dự đoán = 0 (harness trả `null`, không trả NaN). Đồng thuận 2 "giáo viên" giả định: MAE 0,10, within 1,00.

### 5.2 PoC-P (`SPEECH_PROVIDER=mock`, 12 câu tham chiếu tự biên soạn, 6 người nói giả lập, audio sine tổng hợp)

| n | Người nói | Phút audio | accuracy (mean / p50) | fluency | prosody | pa_score | MAE band | within 0,5 | Pearson | p95 ms | USD/phút | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 12/12 | 6 | 0,93 | 76,0 / 79,6 | 68,0 / 64,3 | 61,8 / 58,0 | 70,5 / 72,7 | 1,19 | 0,25 | 0,09 | 8 | 0 | mock_only |

Histogram band (mock): 4,0 ×3 · 5,0 ×3 · 5,5 ×1 · 6,0 ×4 · 6,5 ×1. Kiểm tra điều kiện dữ liệu báo đúng: 12/100 ghi âm, 6/10 người nói, audio tổng hợp, band không phải của giáo viên → `insufficient_data` nếu là provider thật.

## 6. Đề xuất hiện tại

- **Go/No-go:** chưa có. Không suy diễn từ kết quả mock.
- **`ai.model_routes` cho `grade_writing_ielts`:** giữ nguyên spec (`anthropic:claude-sonnet`, fallback `openai:gpt`, `google:gemini-pro`) cho tới khi có kết quả thật; chọn model mặc định = model đạt **tất cả** ngưỡng với chi phí/bài thấp nhất, hoà thì chọn std lặp thấp hơn.
- **SpeechProvider:** Azure (adapter REST đã viết, kiểm bằng fetch giả). Nếu PoC-P không đạt `pearson_min`, hiệu chỉnh bảng PA → band bằng hồi quy trên 100 ghi âm có band GV trước khi đổi nhà cung cấp.

## 7. Cần để có số liệu thật

| # | Hạng mục | Chi tiết | Ai cung cấp |
| --- | --- | --- | --- |
| 1 | Dataset Writing | 200 bài theo `ielts_writing_v1` (Task 2: 120, Task 1 Academic: 50, Task 1 General: 30), tự biên soạn hoặc bài người học nội bộ đã ẩn danh, phủ band 4–8,5 | Nội dung |
| 2 | Chấm giáo viên | 2 giáo viên IELTS chấm độc lập cả overall + 4 tiêu chí (bước 0,5), không xem điểm của nhau; ghi `band_source = teacher` | Học thuật |
| 3 | Ghi âm | 100 ghi âm tiếng Anh đọc câu tham chiếu (≤ 30 s/đoạn), ≥ 10 người, mức A2–C1, có đồng ý `voice_processing`; lưu ngoài repo | Vận hành + pháp chế (đồng ý) |
| 4 | Band Pronunciation | 2 giáo viên chấm band Pronunciation cho từng ghi âm | Học thuật |
| 5 | API key AI | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`; xác nhận model id thật (`CLAUDE_SONNET_MODEL`, `OPENAI_GPT_MODEL`, `GEMINI_PRO_MODEL`) | Chủ dự án |
| 6 | Azure Speech | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` (đề xuất `southeastasia`); xác nhận bảng giá STT/PA để đặt `POC_P_PRICE_PER_AUDIO_HOUR_USD` | Chủ dự án |

**Ước tính chi phí chạy thật (chặn trên theo ngưỡng):** mỗi model 200 + 40×2 = 280 lời gọi; 3 model = 840 lời gọi × ≤ 0,06 USD ≈ ≤ 50 USD. PoC-P: 100 ghi âm × ~20 s ≈ 33 phút ≈ 0,6 USD với giả định 1 USD/giờ audio.

## 8. Cách chạy

```bash
# PoC-W – mock (kiểm chứng harness)
AI_PROVIDER=mock pnpm --filter @allingo/api poc:w

# PoC-W – thật (cần DB dev đã seed prompts + API key; kết quả ghi ai.ai_tasks với user_id null)
AI_PROVIDER=live POC_W_DATASET=/duong-dan/ielts_writing_v1.jsonl \
POC_W_MODELS=anthropic:claude-sonnet,openai:gpt,google:gemini-pro \
POC_W_REPEATS=3 POC_W_REPEAT_SUBSET=40 POC_W_CONCURRENCY=2 \
pnpm --filter @allingo/api poc:w

# PoC-P – mock (audio thiếu → sine tổng hợp)
SPEECH_PROVIDER=mock pnpm --filter @allingo/api poc:p

# PoC-P – Azure
SPEECH_PROVIDER=azure AZURE_SPEECH_KEY=… AZURE_SPEECH_REGION=southeastasia \
POC_P_MANIFEST=/duong-dan/manifest.jsonl POC_P_PRICE_PER_AUDIO_HOUR_USD=1.0 \
pnpm --filter @allingo/api poc:p

# Typecheck mã PoC
pnpm --filter @allingo/api poc:typecheck
```

Kết quả JSON nằm ở `eval/poc/*/results/` (gitignore); bản chạy thật dùng cho quyết định commit bằng `git add -f` và dán bảng vào mục 5 thay cho kết quả mock. `pnpm eval:build && pnpm eval:run` (Promptfoo) vẫn dùng cho kiểm thử prompt; harness PoC đi qua AiGateway để đo đúng đường chạy production (validate/repair/fallback/metering).

## 9. Giới hạn & rủi ro đã biết

- Bảng `ielts_pronunciation_from_pa` trong YAML có khoảng chồng lấn (`85-91` và `88-91 với prosody>=85`); `paToIeltsBand` giải theo thứ tự ưu tiên điều kiện chặt hơn. Prompt Sprint 2 gọi là `scoring_rules.pa_to_band` — tên khoá thật là `ielts_pronunciation_from_pa`.
- Ngưỡng PoC-P mượn từ `ielts_speaking_v1` (chấm 4 tiêu chí) — cần ngưỡng riêng cho PA.
- REST short-audio: ~30 s/đoạn; prosody có thể không trả ở một số vùng/ngôn ngữ (harness thay bằng fluency và đếm).
- Chi phí PoC-W lấy từ ước tính token × bảng giá trong `vercel.provider.ts`; đối chiếu hoá đơn thật sau lần chạy đầu.
- Dataset 5 bài/12 câu mẫu chỉ để chạy thử; không mở rộng bằng bài AI sinh rồi tự chấm (vòng lặp tự xác nhận).
