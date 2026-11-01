# growth (Sprint 8, 12)
Referral (`iam.referrals`), khuyến mãi, beta gate, onboarding khảo sát, thông báo tăng trưởng. Consumer outbox: user.registered, attempt.graded (lần đầu), order.paid.

## Sprint 6 – thông báo & Web Push
- `GET/PATCH /me/notification-preferences` (`ops.notification_preferences`), `GET/POST /me/push-subscriptions`, `DELETE /me/push-subscriptions/{id}` (`ops.push_subscriptions`, VAPID), `GET /push/vapid-public-key` (công khai), `POST /admin/notifications/test`.
- Sender: `web-push` khi có `VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY`; `PUSH_SENDER=memory` cho test. Sinh khoá dev: `pnpm --filter @allingo/api push:vapid`.
