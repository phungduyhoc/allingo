'use client';

import * as React from 'react';
import { CheckCheck, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, Card, CardContent, Spinner, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { NotificationRow } from './notification-row';
import { useNotificationActions, useNotificationFeed } from './use-notifications';

/** Trang "Thông báo": tất cả / chưa đọc, tải thêm theo cursor, đánh dấu đã đọc tất cả, liên kết cài đặt */
export function NotificationsPage() {
  const t = useTranslations('notifications');
  const feed = useNotificationFeed();
  const { markRead, markAll, loadMore } = useNotificationActions();
  const [tab, setTab] = React.useState<'all' | 'unread'>('all');
  const items = (feed.data?.items ?? []).filter((n) => tab === 'all' || !n.read_at);
  const unread = feed.data?.unread ?? 0;

  return (
    <div className="space-y-6" data-testid="notifications-page">
      <PageHeader
        title={t('center.title')}
        description={t('center.subtitle')}
        actions={
          <>
            <Button variant="outline" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()} data-testid="notifications-page-read-all">
              <CheckCheck aria-hidden />
              {t('center.readAll')}
            </Button>
            <Link href="/settings/notifications" className={buttonVariants({ variant: 'ghost' })}>
              <Settings2 aria-hidden />
              {t('openSettings')}
            </Link>
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'all' | 'unread')}>
        <TabsList aria-label={t('center.title')}>
          <TabsTrigger value="all">{t('center.tabAll')}</TabsTrigger>
          <TabsTrigger value="unread">{t('center.tabUnread', { count: unread })}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Card>
        <CardContent className="p-2 sm:p-3">
          {feed.isPending ? (
            <CardSkeleton lines={4} className="border-0" />
          ) : feed.isError ? (
            <ErrorState error={feed.error} onRetry={() => void feed.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState title={tab === 'unread' ? t('center.emptyUnread') : t('center.empty')} className="border-0" />
          ) : (
            <ul className="space-y-1">
              {items.map((n) => (
                <NotificationRow key={n.id} item={n} onRead={(id) => markRead.mutate(id)} />
              ))}
            </ul>
          )}
          {feed.data?.next_cursor ? (
            <div className="flex justify-center p-3">
              <Button variant="outline" size="sm" disabled={loadMore.isPending} onClick={() => loadMore.mutate(feed.data.next_cursor!)}>
                {loadMore.isPending ? <Spinner aria-hidden /> : null}
                {t('center.loadMore')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
