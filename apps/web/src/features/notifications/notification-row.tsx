'use client';

import { Bell, CreditCard, GraduationCap, Megaphone, ShieldAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { NotificationItem } from '@allingo/schemas/api/billing';
import { cn } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { useNowMinute } from '@/features/quota/quota-ui';
import { notificationText, resolveNotificationHref } from './notification-text';
import { useProgram } from '@/features/program/program-context';

const ICONS = { billing: CreditCard, learning: GraduationCap, marketing: Megaphone, system: ShieldAlert } as const;

/** Một dòng thông báo: chấm chưa đọc, tiêu đề/nội dung đã dịch theo template_code, thời gian tương đối; bấm → đọc + mở url */
export function NotificationRow({ item, onRead, onNavigate, compact = false }: { item: NotificationItem; onRead: (id: string) => void; onNavigate?: () => void; compact?: boolean }) {
  const program = useProgram();
  const t = useTranslations('notifications');
  const locale = useLocale();
  const fmt = useFormatter();
  const router = useRouter();
  const now = useNowMinute();
  const text = notificationText(item, t, locale);
  const href = resolveNotificationHref(item.url ?? null, program);
  const unread = !item.read_at;
  const category = (item.category ?? 'system') as keyof typeof ICONS;
  const Icon = ICONS[category] ?? Bell;
  const at = new Date(item.sent_at ?? item.scheduled_at);

  return (
    <li>
      <button
        type="button"
        onClick={() => {
          if (unread) onRead(item.id);
          if (href) {
            onNavigate?.();
            router.push(href);
          }
        }}
        className={cn(
          'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40',
          unread && 'bg-primary/5',
        )}
        data-testid="notification-item"
        data-template={item.template_code}
        data-unread={unread}
        data-source={text.source}
      >
        <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full', unread ? 'bg-accent/20 text-accent-foreground' : 'bg-muted text-muted-foreground')}>
          <Icon className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm', unread ? 'font-semibold' : 'font-medium')}>{text.title}</span>
          {text.body ? <span className={cn('block text-sm text-muted-foreground', compact && 'line-clamp-2')}>{text.body}</span> : null}
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {now ? fmt.relativeTime(at, new Date(Math.max(now, at.getTime()))) : fmt.dateTime(at, { dateStyle: 'short', timeStyle: 'short' })}
            {' · '}
            {t(`category.${category}`)}
          </span>
        </span>
        {unread ? (
          <span className="mt-2 size-2 shrink-0 rounded-full bg-accent" aria-label={t('center.unreadDot')} />
        ) : null}
      </button>
    </li>
  );
}
