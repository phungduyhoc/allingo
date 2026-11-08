# Runbook — On-call & escalation

## Lịch trực
- GĐ1 (beta kín, ≤ 300 người): 1 người trực chính + 1 dự phòng / tuần, đổi ca thứ Hai 09:00 VN. Giờ cao điểm học/thi: 19:00–23:00.
- Kênh: Slack `#allingo-oncall` (alert `severity=page`) + Telegram nhóm on-call; `#allingo-alerts` cho `severity=ticket` (giờ hành chính).
- Uptime ngoài: Better Stack/UptimeRobot kiểm `https://api.allingo.vn/v1/health/ready` và landing mỗi 1′ (cần tài khoản – chưa tạo,
  HANDOFF); Azure Application Insights standard web test (Terraform `modules/observability`) làm lớp thứ hai.

## Mức độ & thời gian phản hồi
| Mức | Ví dụ | Phản hồi | Escalate |
| --- | --- | --- | --- |
| SEV-1 | API/DB sập, rò rỉ dữ liệu, thanh toán cấp sai quyền hàng loạt | 15′ (24/7) | Ngay: Tech Lead → CTO/CEO; rò rỉ: `data-breach.md` |
| SEV-2 | 5xx > 1 %, p95 lưu nháp > 500 ms, webhook thất bại, AI fallback > 20 %, DLQ tăng | 30′ (07:00–24:00) | sau 1 giờ chưa giảm → Tech Lead |
| SEV-3 | ticket: cert < 14 ngày, disk 80 %, chi phí AI tăng nhẹ | ngày làm việc kế tiếp | – |

## Quy trình
1. Ack trên Slack/Alertmanager (silence có hạn + lý do). 2. Mở luồng sự cố: thời gian, ảnh hưởng, người xử lý. 3. Theo runbook ở
`runbook_url` của alert. 4. Cập nhật 30′/lần. 5. Đóng: xác nhận alert resolved + dashboard bình thường. 6. Postmortem (SEV-1/2) trong 3
ngày: timeline, nguyên nhân gốc, hành động có người + hạn.

<a id="error-budget"></a>
## Error budget (ErrorBudgetFastBurn)
Burn 14,4× ⇒ hết budget 30 ngày trong ~2 ngày. Dừng deploy tính năng, chỉ hotfix; xem `docs/slo.md` §Chính sách đóng băng.
