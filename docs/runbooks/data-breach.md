# Runbook — Sự cố rò rỉ dữ liệu cá nhân (quy trình 72 giờ)

Cơ sở: NĐ 13/2023/NĐ-CP – thông báo Bộ Công an (A05 – Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao) **trong 72 giờ**
kể từ khi phát hiện vi phạm (mẫu số 03); thông báo chủ thể dữ liệu khi có nguy cơ gây hại. Cần pháp chế xác nhận lại theo văn bản
hiện hành (Luật Bảo vệ dữ liệu cá nhân 2025 có hiệu lực 01/01/2026) – SPEC-ISSUES S128.

| Giờ | Việc | Người |
| --- | --- | --- |
| 0 | Phát hiện (alert, báo cáo, bên thứ ba) → mở kênh sự cố mức **SEV-1**, ghi thời điểm phát hiện (UTC + VN) | On-call |
| 0–4 | **Ngăn chặn**: thu hồi khoá/secret lộ (`secrets-rotation.md`), thu hồi phiên (`iam.sessions.revoked_at`), chặn IP/route ở WAF, kill-switch tính năng liên quan, giữ nguyên bằng chứng (snapshot DB, log Loki/Tempo, audit_logs – KHÔNG xoá) | On-call lead + Security |
| 4–24 | **Đánh giá**: loại dữ liệu (email/phone/bài làm/ghi âm/hoá đơn), số chủ thể, thời gian, nguyên nhân; truy vấn `ops.audit_logs`, log truy cập theo `trace_id` | Security + Backend |
| 24–48 | Soạn thông báo cơ quan (mẫu 03: mô tả, thời gian, loại & số lượng dữ liệu, biện pháp, đầu mối), thông báo người dùng (email/in-app qua growth, mẫu i18n) | DPO/Pháp chế + CEO |
| ≤ 72 | **Gửi thông báo** cơ quan; lưu bằng chứng gửi | DPO |
| sau | Khắc phục gốc, test hồi quy (thêm vào `s11-pentest.test.ts`), postmortem, cập nhật `docs/security/pentest-1.md` | Team |

Không: tự ý liên hệ kẻ tấn công, công bố thông tin chưa xác minh, xoá dữ liệu bằng chứng.
