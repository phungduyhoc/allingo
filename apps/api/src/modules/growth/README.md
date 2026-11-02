# growth (Sprint 8, 12)
Referral (`iam.referrals`), khuyến mãi, beta gate, onboarding khảo sát, thông báo tăng trưởng. Consumer outbox: user.registered, attempt.graded (lần đầu), order.paid.

## Sprint 6 – thông báo & Web Push
- `GET/PATCH /me/notification-preferences` (`ops.notification_preferences`), `GET/POST /me/push-subscriptions`, `DELETE /me/push-subscriptions/{id}` (`ops.push_subscriptions`, VAPID), `GET /push/vapid-public-key` (công khai), `POST /admin/notifications/test`.
- Sender: `web-push` khi có `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY`; `PUSH_SENDER=memory` cho test. Sinh khoá dev: `pnpm --filter @allingo/api push:vapid`.

## Sprint 8 – thông báo đa kênh & referral (ADR-0030)
- `NotificationService.send(userId, template, data, {channels, dedupeKey, emailTo, attachments})` (`notify/`): mẫu Handlebars vi/en
  (`notify/templates.ts` – thêm mẫu = thêm mục + mã vào `NOTIFICATION_TEMPLATE_CODES`), email HTML + plain-text (MailerService:
  smtp/ses/resend/memory), push (`NotificationsService.pushToUser`), in-app (`ops.notifications` + Socket.IO `notification.new`).
  Chính sách `decideDelivery`: kênh → loại (`categories`) → tần suất (≤ 1 email marketing/7 ngày, ≤ 2 push/ngày) → giờ yên lặng VN.
  Job `notification.dispatch` (mỗi phút) giao hàng đã hẹn giờ.
- Endpoint: `GET /me/notifications` (+ `unread`, `unread_count`), `POST /me/notifications/{id}/read`, `POST /me/notifications/read-all`,
  `GET/POST /notifications/unsubscribe`, `GET/PATCH /notifications/manage` (token HMAC trong email).
- Sự kiện billing → thông báo (`billing-notifications.listener.ts`): order_paid, invoice_issued (email kèm PDF), subscription_expiring/
  expired, trial_started/ending/ended, admin.invoice_failed.
- Referral (`referral/`): `GET /me/referral`, `GET /referrals/{code}`, `GET /r/{code}` (OG + chuyển hướng); chuỗi outbox user.registered
  → attempt.graded → order.paid; thưởng `ff.growth.referral.rules.config`; chống lạm dụng `referral-rules.ts`. growth sở hữu `iam.referrals`.
