'use client';

import * as React from 'react';
import { Cookie } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { CONSENT_EVENT, CONSENT_KEY, CONSENT_OPEN_EVENT, parseConsent, writeConsent, type ConsentState } from '@/lib/analytics/consent';

/**
 * Thanh đồng ý cookie (S10) – nằm trong luồng trang (trên header), không phủ nội dung. Có sẵn trong HTML tĩnh để không gây CLS;
 * người đã chọn → `html[data-consent]` (script khởi động ở layout gốc) + CSS ẩn trước khi vẽ, sau hydrate thì gỡ khỏi cây.
 * "Cài đặt cookie" ở chân trang phát `allingo:consent-open` → hiện lại (data-open) với lựa chọn hiện tại.
 */
/** Lựa chọn hiện tại đọc từ localStorage như một nguồn ngoài (đổi khi chọn trong trang hoặc ở tab khác) */
function subscribe(cb: () => void): () => void {
  window.addEventListener(CONSENT_EVENT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(CONSENT_EVENT, cb);
    window.removeEventListener('storage', cb);
  };
}
const clientSnapshot = () => {
  try {
    return window.localStorage.getItem(CONSENT_KEY) ?? '';
  } catch {
    return '';
  }
};
// SSR + lần hydrate đầu: chưa biết lựa chọn → render thanh (CSS ẩn nếu html[data-consent])
const serverSnapshot = () => null;

export function CookieBanner() {
  const t = useTranslations('consent');
  const raw = React.useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const state: ConsentState | null | undefined = raw === null ? undefined : parseConsent(raw);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      window.setTimeout(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    };
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, onOpen);
  }, []);

  if (state && !open) return null;

  const choose = (analytics: boolean) => {
    writeConsent(analytics);
    setOpen(false);
  };

  return (
    <div ref={ref} data-consent-banner="" data-open={open ? 'true' : undefined} className="border-b border-border bg-card" data-testid="cookie-banner">
      <section aria-label={t('label')} className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-start gap-2 text-muted-foreground">
          <Cookie className="mt-0.5 size-4 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
          <span>
            {t('text')}{' '}
            <Link href="/privacy" className="font-medium text-foreground underline underline-offset-4">
              {t('policy')}
            </Link>
            {state ? <span className="ml-1">{t(state.analytics ? 'currentAccepted' : 'currentRejected')}</span> : null}
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => choose(false)} data-testid="consent-reject">
            {t('reject')}
          </Button>
          <Button size="sm" variant="navy" onClick={() => choose(true)} data-testid="consent-accept">
            {t('accept')}
          </Button>
        </div>
      </section>
    </div>
  );
}

/** Nút "Cài đặt cookie" (chân trang) – mở lại thanh đồng ý */
export function ConsentSettingsButton({ className }: { className?: string }) {
  const t = useTranslations('consent');
  return (
    <button
      type="button"
      className={className ?? 'underline underline-offset-4 hover:text-foreground'}
      onClick={() => {
        window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}
      data-testid="consent-settings"
    >
      {t('settings')}
    </button>
  );
}
