# Báo cáo beta kín – tuần 2026-W45

Khoảng: 2026-11-01T17:00:00.000Z → 2026-11-08T17:00:00.000Z (tuần ISO theo giờ VN) · sinh lúc 2026-11-08T02:39:10.960Z bởi `pnpm report:beta` (DB replica).

> **DỮ LIỆU GIẢ LẬP** – nhóm tester có tài khoản `@beta-demo.allingo.test` (seed `beta-demo`). Không dùng số này cho quyết định GATE-2.

## 1. KPI so với mục tiêu GATE-2

| KPI | Giá trị | Mẫu | Mục tiêu | Trạng thái |
| --- | --- | --- | --- | --- |
| Activation (chẩn đoán xong ≤ 24 giờ) | 66.0 % | 33/50 | ≥ 60 % | ĐẠT |
| Giữ chân D1 | 42.0 % | 21/50 | – | – |
| Giữ chân D7 | 34.4 % | 11/32 | ≥ 35 % | CHƯA ĐẠT |
| Giữ chân D14 | — | 0/0 | – | – |
| NPS (ngày 7 + 14, tích luỹ) | 13.3 | 15 trả lời | ≥ 30 | CHƯA ĐẠT |
| Tỉ lệ hữu ích (thumbs-up) giải thích AI | 72.3 % | 73/101 | ≥ 80 % | CHƯA ĐẠT |
| Crash-free sessions | — | chưa có (Sentry Release Health chưa cấu hình) | ≥ 99,5 % | chưa đủ dữ liệu |

## 2. Nhóm tester & mời

- Tester: **50** (mới trong tuần: 11); danh sách chờ: 80; lời mời đã gửi: 60, đã đổi: 50 (83.3 %).

## 3. Mức độ sử dụng (trong tuần)

- Tester hoạt động: 43/50
- Phiên học (khoảng nghỉ ≤ 30 phút): 167 · 3.88 phiên/tester hoạt động · 3.34 phiên/tester
- Số câu đã làm/tester: 65.34
- Lượt giải thích AI/tester: 3.42

## 4. AI

- Phản hồi hữu ích/không: 101 (hữu ích 73) · tác vụ bị guardrail từ chối: 0
- Chi phí AI tuần: 0.1954 USD · 0.0039 USD/tester (×4,3 ≈ 0.0168 USD/tester/tháng)

## 5. NPS

- Promoter 6 · Passive 5 · Detractor 4
- Ngày 7: 13.3 (15 trả lời) · Ngày 14: — (0 trả lời)

## 6. Ý định mua (sandbox)

- Tester đã thử checkout: 4 (8.0 %) · đơn đã thanh toán (sandbox/giả lập): 2

## 7. Phản hồi & hỗ trợ

- Góp ý in-app tuần: 16
- Báo lỗi câu: 10 trong tuần · đang mở 2 · quá hạn 48 giờ 2
- Ticket: 8 trong tuần · đang mở 4 · quá hạn phản hồi 24 giờ 1 · trung vị phản hồi đầu 8.7 giờ

## 8. PostHog

chưa có (POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY chưa cấu hình hoặc không gọi được – số phễu client & Web Vitals bổ sung khi có key).

---
Định nghĩa KPI: docs/analytics/events.md · SQL: docs/analytics/kpi.sql. Số liệu không chứa PII.
