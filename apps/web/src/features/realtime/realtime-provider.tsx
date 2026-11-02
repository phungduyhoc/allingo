'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { notificationItemSchema } from '@allingo/schemas';
import { useRouter } from '@/i18n/navigation';
import { billingKeys } from '@/lib/billing-api';
import { realtimeHub } from '@/lib/realtime-hub';
import { queryKeys, useMe } from '@/lib/queries';
import { useFeedDispatch } from '@/features/notifications/use-notifications';
import { notificationText, resolveNotificationHref } from '@/features/notifications/notification-text';

/**
 * Kết nối realtime cho vùng (app) sau AuthGate (S7/S8). Sự kiện chung → làm mới dữ liệu (server vẫn là nguồn sự thật):
 *  - `order.updated` → đơn hàng + lịch sử đơn; `credits.changed` → số dư/sổ credit/entitlements;
 *  - `entitlements.changed` → entitlements + subscription; `notification.new` → thêm vào hộp thông báo + toast nhẹ.
 * Trang cụ thể (kết quả thanh toán…) đăng ký thêm qua `useRealtimeEvent`.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const qc = useQueryClient();
  const dispatch = useFeedDispatch();
  const t = useTranslations('notifications');
  const locale = useLocale();
  const router = useRouter();
  const userId = me.data?.id ?? null;

  React.useEffect(() => {
    if (!userId) return;
    realtimeHub.start(userId);
    // Đăng xuất / rời vùng (app) / đổi tài khoản → đóng kết nối của người dùng cũ
    return () => realtimeHub.stop();
  }, [userId]);

  React.useEffect(() => {
    const offs = [
      realtimeHub.on('order.updated', (data) => {
        const id = (data as { order_id?: string } | null)?.order_id;
        if (id) void qc.invalidateQueries({ queryKey: billingKeys.order(id) });
        void qc.invalidateQueries({ queryKey: billingKeys.myOrders });
      }),
      realtimeHub.on('credits.changed', () => {
        void qc.invalidateQueries({ queryKey: billingKeys.credits });
        void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
      }),
      realtimeHub.on('entitlements.changed', () => {
        void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
        void qc.invalidateQueries({ queryKey: billingKeys.subscriptions });
      }),
      realtimeHub.on('notification.new', (data) => {
        const parsed = notificationItemSchema.safeParse(data);
        if (!parsed.success) {
          void qc.invalidateQueries({ queryKey: ['me', 'notifications'] });
          return;
        }
        const item = parsed.data;
        if (item.channel && item.channel !== 'inapp') return;
        dispatch({ type: 'received', item });
        const text = notificationText(item, t, locale);
        const href = resolveNotificationHref(item.url ?? null);
        toast(text.title, {
          id: `notification-${item.id}`,
          description: text.body ?? undefined,
          duration: 6000,
          action: href ? { label: t('center.open'), onClick: () => router.push(href) } : undefined,
        });
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [dispatch, locale, qc, router, t]);

  return <>{children}</>;
}

/** Đăng ký một sự kiện realtime trong vòng đời component (handler mới nhất luôn được gọi) */
export function useRealtimeEvent(event: string, handler: (data: unknown) => void): void {
  const ref = React.useRef(handler);
  React.useEffect(() => {
    ref.current = handler;
  });
  React.useEffect(() => realtimeHub.on(event, (d) => ref.current(d)), [event]);
}
