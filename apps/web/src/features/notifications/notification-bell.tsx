'use client';

import * as React from 'react';
import { Bell, CheckCheck, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, cn, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { badgeText } from './feed';
import { NotificationRow } from './notification-row';
import { useNotificationActions, useNotificationFeed } from './use-notifications';

const PREVIEW = 8;

/**
 * Chuông thông báo trong header (S8): số chưa đọc (cập nhật realtime qua Socket.IO `notification.new`), bảng xổ xuống gồm
 * 8 thông báo mới nhất, "Đánh dấu đã đọc tất cả", liên kết trang đầy đủ + cài đặt. Esc / bấm ra ngoài → đóng, trả focus.
 */
export function NotificationBell() {
  const t = useTranslations('notifications');
  const [open, setOpen] = React.useState(false);
  const feed = useNotificationFeed();
  const { markRead, markAll } = useNotificationActions();
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const unread = feed.data?.unread ?? 0;
  const badge = badgeText(unread);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items = feed.data?.items.slice(0, PREVIEW) ?? [];

  return (
    <div ref={wrapRef} className="relative">
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        aria-label={badge ? t('center.bellUnread', { count: unread }) : t('center.bell')}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid="notification-bell"
        data-unread={unread}
      >
        <Bell aria-hidden />
        {badge ? (
          <span
            className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] leading-none font-bold text-accent-foreground"
            data-testid="notification-badge"
            aria-hidden
          >
            {badge}
          </span>
        ) : null}
      </Button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t('center.title')}
          className="fixed inset-x-2 top-16 z-50 flex max-h-[min(32rem,calc(100dvh-5rem))] flex-col rounded-xl border border-border bg-card text-foreground shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-96"
          data-testid="notification-panel"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <p className="font-semibold">{t('center.title')}</p>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={unread === 0 || markAll.isPending}
                onClick={() => markAll.mutate()}
                data-testid="notifications-read-all"
              >
                {markAll.isPending ? <Spinner aria-hidden /> : <CheckCheck aria-hidden />}
                {t('center.readAll')}
              </Button>
              <Link href="/settings/notifications" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })} aria-label={t('openSettings')} onClick={() => setOpen(false)}>
                <Settings2 aria-hidden />
              </Link>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {feed.isPending ? (
              <div className="flex justify-center py-8">
                <Spinner label={t('center.loading')} />
              </div>
            ) : feed.isError ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('center.loadError')}</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground" data-testid="notifications-empty">
                {t('center.empty')}
              </p>
            ) : (
              <ul className="space-y-1" data-testid="notification-list">
                {items.map((n) => (
                  <NotificationRow key={n.id} item={n} compact onRead={(id) => markRead.mutate(id)} onNavigate={() => setOpen(false)} />
                ))}
              </ul>
            )}
          </div>
          <div className="border-t border-border p-2">
            <Link href="/notifications" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-full')} onClick={() => setOpen(false)} data-testid="notifications-see-all">
              {t('center.seeAll')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
