# Báo cáo hiệu năng Sprint 11 (trước/sau tối ưu)

> Đo trong phiên phát triển, không phải staging. Số liệu dùng để so sánh tương đối giữa các vòng tối ưu; ngưỡng GATE-2 phải đo lại trên staging bằng `tests/load/exam-day.js` (5.000 VU / 30 phút).

## 1. Môi trường

| Hạng mục | Giá trị |
| --- | --- |
| Máy | 2 vCPU / 8 GB, dùng chung với web dev và các tác vụ khác |
| API | 1 tiến trình Node (NestJS/Fastify), không cluster |
| Cơ sở dữ liệu | PostgreSQL 16 cục bộ, DB riêng `allingo_load` |
| Dữ liệu | 2.000 người dùng, 20.000 attempt, 2.075.460 câu trả lời (≈ 962 MB), seed bằng `COPY` trong 124 s (`tests/load/seed-big.ts`) |
| Hồ sơ tải | 300 VU, think-time chia 5 (≈ 1.500 VU thời gian thực), mỗi lượt ≤ 2 phút; tỉ lệ 60 % làm đề / 20 % review + explain / 10 % dashboard / 10 % catalog |

## 2. Kết quả theo vòng (p95)

| Chỉ số | R0 (trước) | R1c | R2b | R3 | R5b (cuối) |
| --- | --- | --- | --- | --- | --- |
| `PUT /attempts/{id}/answers` | timeout | 246 ms | 245 ms | 102 ms | **50 ms** |
| `POST /attempts/{id}/submit` | timeout | – | – | – | **116 ms** |
| `GET /attempts/{id}/review` | timeout | 1.308 ms | 718 ms | 122 ms | **49 ms** |
| `POST /ai/explain` (cache hit) | 4.713 ms | 1.325 ms | 509 ms | 85 ms | **42 ms** |
| Đọc (GET khác) | timeout | – | – | – | **32 ms** |
| Tỉ lệ lỗi | 8,31 % | | | | **0 %** |
| Thông lượng | 25,9 rps | | | | **103 rps** |
| CPU PostgreSQL (trung bình) | 15 % | | | | 25 % (đỉnh 39 %) |

**Điểm bão hoà:** 500 VU đạt 155 rps nhưng p95 `PUT /answers` 448 ms, review 2.025 ms; 800 VU đạt 178 rps và bão hoà do event loop của một tiến trình (CPU API 78 %). Giới hạn nằm ở API một tiến trình, không ở PostgreSQL.

## 3. Phát hiện và cách sửa

| # | Mức | Vấn đề | Cách sửa |
| --- | --- | --- | --- |
| P1 | Critical | Deadlock pool kết nối, API treo: gamification/SRS chạy truy vấn ngoài transaction trong khi đang giữ transaction | Đọc dữ liệu trước khi mở transaction |
| P2 | High | Review N+1 khi đọc cache giải thích | `getMany` (MGET + 1 SELECT, đánh dấu âm 300 s) |
| P3 | Medium | Sổ lỗi N+1 | INSERT nhiều dòng |
| P4 | Medium | `answeredTotal` quét toàn bảng | Truy vấn LATERAL |
| P5 | Medium | Không cắt tỉa partition `attempt_answers` | Điều kiện `created_at >= started_at` |
| P6 | Medium | `saveAnswers` cập nhật từng dòng | `UPDATE … FROM VALUES` khớp theo id + attempt_id |
| P7 | Low | Đọc phiên bản câu hỏi lặp lại | Cache 30 s |
| P8 | Low | Thiếu index tra XP theo tham chiếu | `ix_xp_events_ref` (migration 0008, `CREATE INDEX CONCURRENTLY`) |
| P9 | High | `POST /submit` 500 khi truyền Date vào SQL thô | `toISOString()` |
| P10 | Medium | Race tạo enrollment trả 500 | `ON CONFLICT` |
| P11 | — | Hàng đợi không ưu tiên | Backpressure: `grading` ưu tiên hơn `notify`/`analytics` |

## 4. Ước tính cho staging (5.000 VU / 30 phút ≈ 850 req/s)

| Thành phần | Đề xuất |
| --- | --- |
| API | 8–10 replica × 1 vCPU (Azure Container Apps), autoscale theo CPU/req |
| PostgreSQL | General Purpose D4ds_v5 + PgBouncer (transaction pooling) |
| Redis | Standard C1 |

Phải chạy `tests/load/exam-day.js` với cấu hình mặc định trên staging và ghi kết quả vào mục 5 trước GATE-2.

## 5. Kết quả staging

Chưa chạy (chưa có staging).

## 6. Tái lập

```bash
TOKENS_ONLY=1 tsx tests/load/seed-big.ts     # tạo lại token (dữ liệu allingo_load được giữ lại)
k6 run tests/load/exam-day.js                # trên staging: cấu hình mặc định 5.000 VU
# dọn: dropdb -h localhost -U allingo allingo_load && rm -rf tests/load/.out
```
