'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/logo';
import { captureException } from '@/components/telemetry';

/**
 * Ranh giới lỗi của mọi trang theo locale (S11): báo Sentry (đã che PII – lỗi đã bắt → phiên `errored`) rồi cho thử lại / về trang
 * chủ. `digest` là mã lỗi server của Next (không chứa chi tiết) – gửi kèm để đối chiếu log.
 */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('common');
  const te = useTranslations('errors');
  React.useEffect(() => {
    captureException(error, { tags: { boundary: 'locale', digest: error.digest } });
  }, [error]);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center" role="alert" data-testid="error-boundary">
      <LogoMark className="size-12" />
      <h1 className="text-2xl font-bold">{te('title')}</h1>
      <p className="max-w-md text-muted-foreground">{te('codes.internal')}</p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => reset()}>
          {t('retry')}
        </Button>
        <Link href="/" className={buttonVariants({ variant: 'navy' })}>
          {t('goHome')}
        </Link>
      </div>
    </main>
  );
}
