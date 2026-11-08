# Báo cáo GATE-2 — Kết thúc GĐ1 (TOEIC L&R) · bản kỹ thuật 08/11/2026

> **Trạng thái: CHƯA ĐỦ ĐIỀU KIỆN THÔNG QUA GATE-2.** Phần mềm GĐ1 đã hoàn thành ở mức mã nguồn (S0–S12, kiểm thử tự động xanh). Các tiêu chí phụ thuộc người dùng thật, nội dung đủ khối lượng, hạ tầng staging, cổng thanh toán/hoá đơn/AI thật **chưa có số liệu**. Báo cáo này là bản kỹ thuật để ban điều hành quyết định các bước còn lại; số liệu beta phải được điền lại sau 2 tuần beta kín thật.

## 1. Tóm tắt điều hành

| Hạng mục | Kết luận |
| --- | --- |
| Tính năng GĐ1 | Đủ luồng người học TOEIC L&R: đăng ký/OAuth/OTP → chẩn đoán → lộ trình → đề full 200 câu (Exam Mode, Listening phát một lần) → review → giải thích AI/gia sư → từ vựng FSRS → sổ lỗi → dashboard; thanh toán 3 cổng, hoá đơn điện tử, khuyến mãi, referral, thông báo đa kênh; beta gate, hỗ trợ, admin |
| Chất lượng kỹ thuật | ≈ 1.250 test tự động (unit + integration + E2E) xanh; hợp đồng API và DDL không lệch; pentest tự kiểm 10 kịch bản đã vá; diễn tập PITR cục bộ RPO 0 |
| Chặn GATE-2 | (1) Chưa có beta thật 300 người – không có KPI thật; (2) nội dung mới 224 câu / 1 đề L&R full – cần ≥ 3.000 câu, ≥ 10 đề full; (3) chưa có staging – chưa đo 5.000 CCU, SLO 2 tuần; (4) cổng thanh toán, MISA, AI, Azure Speech, PostHog, Sentry chưa có credential thật; (5) pháp lý chưa duyệt (điều khoản, hoàn tiền/hoá đơn, xử lý giọng nói) |
| Đề xuất | Không mở beta công khai; thực hiện **kế hoạch 6 tuần trước GATE-2** ở mục 6, sau đó chạy beta kín 2 tuần và điền lại báo cáo này |

## 2. Checklist GATE-2 (mục D – ALLINGO-SPRINT-PROMPTS)

| # | Hạng mục | Bằng chứng hiện có | Trạng thái |
| --- | --- | --- | --- |
| 1 | Luồng người học TOEIC L&R đầy đủ | Playwright E2E (mock + API thật) cho từng màn: onboarding, chẩn đoán, plan, Exam/Listening, review, explain, tutor, flashcard, sổ lỗi, dashboard; chưa có demo staging | ◐ Đạt trên môi trường dev |
| 2 | Nội dung: ≥ 10 đề full + 30 mini + 60 drill, ≥ 3.000 câu published, 0 sao chép | 224 câu published tự biên soạn (`source = human`): 1 đề Reading 01, 1 đề Listening 01, 1 đề L&R 200 câu, 5 mini (2 tự sinh), 7 drill, 1 đề chẩn đoán 61 câu; từ điển 1.750 mục; 11 bộ TOEIC 600 | ✗ Thiếu ≈ 93 % số câu |
| 3 | AI: explain ≥ 4/5, 👍 ≥ 80 %, guard recall ≥ 98 %, chi phí trong dự toán, fallback | Pipeline eval 179 câu chạy được nhưng chỉ với mock (`mock=true, passed=false`); fallback/breaker kiểm bằng test; chi phí ước ≈ 1 USD/1.000 explain | ✗ Cần khoá AI thật + eval |
| 4 | Billing: 3 cổng sandbox + hoá đơn, đối soát 0 lệch, gating server-side, referral/khuyến mãi | Vector chữ ký tính độc lập + IPN tự ký; E2E với cổng mock; gating ma trận plan × feature; MISA mock | ◐ Mã sẵn sàng, chưa sandbox thật |
| 5 | Phi chức năng: SLO 2 tuần, k6 5.000 CCU, pentest 1 không còn high, restore PITR | Máy phiên ≈ 1.500 VU: p95 PUT /answers 50 ms, submit 116 ms, review 49 ms, 0 % lỗi; pentest-1 đã vá High; PITR cục bộ RTO 3,2 s / RPO 0 | ◐ Chưa staging |
| 6 | Tuân thủ: điều khoản/riêng tư/hoàn tiền, cookie consent, xoá dữ liệu 72 giờ, log không PII, disclaimer | Consent banner; xoá dữ liệu + purge; test redaction; tuyên bố không liên kết ETS; văn bản pháp lý `draft_pending_legal_review` | ◐ Chờ luật sư + kế toán |
| 7 | Beta: activation ≥ 60 %, D7 ≥ 35 %, NPS ≥ 30, crash-free ≥ 99,5 % | Chỉ có số từ **dữ liệu giả lập** (`beta-demo`) để kiểm script `pnpm report:beta` | ✗ Chưa chạy beta |
| 8 | Kỹ thuật: CI xanh, diff xanh, coverage domain ≥ 80 %, ADR/HANDOFF/runbooks, tag `v0.9.0-beta` | Lint/typecheck/test xanh cục bộ; `db:diff`/`api:diff` xanh; 35 ADR, 20+ runbook; CI GitHub chưa chạy lần nào (chưa push); coverage chưa đo tổng hợp | ◐ Chờ push + CI |

## 3. Số liệu beta (chưa có – mẫu từ dữ liệu giả lập)

Script `pnpm report:beta` đã chạy được trên seed `beta-demo` (50 tester giả lập) – các số dưới đây **chỉ chứng minh công cụ đo hoạt động, không dùng để ra quyết định**:

| KPI | Mục tiêu | Giả lập W45 |
| --- | --- | --- |
| Activation (chẩn đoán ≤ 24 giờ) | ≥ 60 % | 66,0 % |
| D7 retention | ≥ 35 % | 34,4 % |
| NPS | ≥ 30 | 13,3 |
| Tỉ lệ 👍 explain | ≥ 80 % | 72,3 % |
| Crash-free | ≥ 99,5 % | chưa có (cần Sentry) |
| Chi phí AI / tester / tuần | trong dự toán | 0,0039 USD (mock) |

## 4. Lỗi/rủi ro mở theo mức

| Mức | Hạng mục | Ghi chú / hướng xử lý |
| --- | --- | --- |
| Cao | Khối lượng nội dung | Cần quy trình sản xuất: AI sinh nháp (`content.generate`) + 2 lớp duyệt; ước 3.000 câu ≈ 6–8 tuần với 2 biên tập viên + 2 giáo viên |
| Cao | Pháp lý hoá đơn khi hoàn tiền | Đang huỷ hoá đơn; NĐ 123/2020, NĐ 70/2025 thường yêu cầu điều chỉnh/thay thế (S90) – kế toán xác nhận |
| Cao | Chưa có staging/CI chạy thật | Push GitHub, chạy CI, dựng staging theo ADR-0023 |
| Trung bình | 3 bảng billing có `org_id` chưa bật RLS (S124) | Bật trước khi bán B2B |
| Trung bình | Lighthouse dashboard mobile 75–77 | Đang tối ưu ở giao diện Sprint 11 (mục tiêu ≥ 85) |
| Trung bình | 5 GHSA bắc cầu (đã override 3 gói) | Theo dõi Renovate, hạn 30/11/2026 |
| Thấp | Optimizer FSRS tự viết | So với optimizer chính thức khi có ≥ 1.000 lượt ôn/người |
| Thấp | Bộ lọc guard dạng luật có thể chặn nhầm | Theo dõi mẫu refused trong admin AI |

## 5. Đề xuất phạm vi GĐ2 (IELTS + chấm Writing/Speaking + ra mắt)

- IELTS Reading/Listening (tái dùng test engine, Listening, review), chấm Writing (Task 1/2) và Speaking (Part 1–3) theo rubric `allingo-prompts.yaml` + Azure Pronunciation Assessment (harness PoC GATE-1 đã có), shadowing/dictation, i18n en cho toàn sản phẩm, gán nhãn lỗi bằng AI.
- Hạ tầng cho 10.000 người dùng hoạt động (ước tính thô, cần đo): API 4–6 replica × 1 vCPU, PostgreSQL GP D4ds_v5 + PgBouncer, Redis Standard C1, R2/CDN; AI ≈ 0,02–0,05 USD/người/tháng cho explain/tutor (TOEIC) – Writing/Speaking GĐ2 sẽ chiếm phần lớn chi phí AI.

## 6. Kế hoạch trước khi chạy beta kín (đề xuất 6 tuần)

| Tuần | Việc | Chủ trì |
| --- | --- | --- |
| 1 | Push GitHub, CI xanh, dựng staging (Terraform ADR-0023), Payload `migrate`, khoá AI/Azure/PostHog/Sentry vào Key Vault | Kỹ thuật |
| 1–2 | Credential sandbox VNPay/MoMo/ZaloPay + MISA; chạy thử theo runbook payments/invoices; kế toán chốt thuế suất + hoàn tiền | Kỹ thuật + Kế toán |
| 1–6 | Sản xuất nội dung: 9 đề L&R full + 25 mini + 50 drill (AI nháp + duyệt 2 lớp) | Nội dung |
| 2 | Eval AI thật (explain ≥ 4/5, guard recall ≥ 98 %), chọn model chính/dự phòng theo chi phí | AI |
| 3 | k6 5.000 VU/30′ trên staging, tối ưu; ZAP nightly; pentest ngoài (nếu có ngân sách) | SRE/Bảo mật |
| 3–4 | Luật sư duyệt điều khoản/riêng tư/hoàn tiền/xử lý giọng nói | Pháp chế |
| 5–6 | Mời đợt 1 (50) → theo dõi 3 ngày → đợt 2–6 (tổng 300); vận hành hỗ trợ; điền lại báo cáo này | Sản phẩm |

## 7. Checklist "sẵn sàng ra mắt công khai" (còn thiếu)

- [ ] Beta kín 2 tuần đạt KPI mục 3; không lỗi "chặn học" mở > 48 giờ
- [ ] ≥ 3.000 câu, ≥ 10 đề full, đã rà ngẫu nhiên 50 câu không sao chép
- [ ] SLO 2 tuần trên staging/production; k6 5.000 CCU đạt
- [ ] 3 cổng thanh toán + hoá đơn điện tử chạy thật; đối soát 1 tháng 0 lệch
- [ ] Văn bản pháp lý đã duyệt; đầu mối bảo vệ dữ liệu cá nhân theo quy định hiện hành (pháp chế xác nhận văn bản áp dụng)
- [ ] Sentry/PostHog/Grafana thật; on-call lịch trực
- [ ] Tag `v0.9.0-beta` sau khi CI xanh trên GitHub
