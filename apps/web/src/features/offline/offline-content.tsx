'use client';

import * as React from 'react';
import { BookOpen, Wifi, WifiOff } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Badge, Button } from '@allingo/ui';
import { LogoMark } from '@/components/logo';
import { readViewed, type ViewedEntry } from './viewed-store';

/** `#from=/vi/...` → đường dẫn tương đối cùng origin (chặn `//host`, giao thức) */
function returnPathFromHash(hash: string): string | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get('from');
  return raw && raw.startsWith('/') && !raw.startsWith('//') && !/[\s\\]/.test(raw) ? raw : null;
}

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

/**
 * Trang offline (service worker trả về khi điều hướng mà mất mạng): thông báo + danh sách đề đã xem lưu trên thiết bị
 * (localStorage, không chứa đáp án). Có mạng lại → nút tải lại. Liên kết dùng `<a>` thường (điều hướng đầy đủ khi online).
 */
export function OfflineContent() {
  const t = useTranslations('offline');
  const locale = useLocale();
  const fmt = useFormatter();
  const online = React.useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => false,
  );
  const [viewed, setViewed] = React.useState<ViewedEntry[] | null>(null);
  const [from, setFrom] = React.useState<string | null>(null);
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      setViewed(readViewed());
      setFrom(returnPathFromHash(window.location.hash));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);
  // Có mạng lại: quay về trang người học định mở (service worker chuyển hướng tới đây kèm #from=…)
  const retry = () => {
    if (from) window.location.assign(from);
    else window.location.reload();
  };
  const kindLabel = (k: ViewedEntry['kind']) =>
    k === 'result'
      ? t('kindResult')
      : k === 'review'
        ? t('kindReview')
        : k === 'attempt'
          ? t('kindAttempt')
          : t('kindTestSet');

  return (
    <main
      className="mx-auto flex min-h-dvh max-w-xl flex-col items-center gap-5 px-4 py-12 text-center"
      data-testid="offline-page"
      data-online={online}
    >
      <LogoMark className="size-12" />
      {online ? (
        <Wifi className="size-8 text-success" aria-hidden />
      ) : (
        <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      )}
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('desc')}</p>
      <p className="sr-only" role="status">
        {online ? t('online') : ''}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="navy" onClick={retry} data-testid="offline-retry">
          {t('retry')}
        </Button>
        <a
          href={`/${locale}/toeic/dashboard`}
          className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm font-semibold hover:bg-muted"
        >
          {t('goDashboard')}
        </a>
      </div>

      <section className="mt-4 w-full text-left" aria-labelledby="viewed-title" data-testid="offline-viewed">
        <h2 id="viewed-title" className="flex items-center gap-2 text-base font-semibold">
          <BookOpen className="size-4 text-muted-foreground" aria-hidden />
          {t('viewedTitle')}
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">{t('viewedDesc')}</p>
        {viewed === null ? null : viewed.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
            data-testid="offline-viewed-empty"
          >
            {t('viewedEmpty')}
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {viewed.map((v) => (
              <li key={v.id} data-testid="offline-viewed-item" data-kind={v.kind}>
                <a href={`/${locale}${v.href}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{v.title ?? kindLabel(v.kind)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t('viewedAt', {
                        date: fmt.dateTime(new Date(v.at), { dateStyle: 'medium', timeStyle: 'short' }),
                      })}
                    </span>
                  </span>
                  <Badge variant="secondary">{kindLabel(v.kind)}</Badge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
