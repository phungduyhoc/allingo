'use client';

import type * as React from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, cn, Skeleton } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { getErrorCode } from '@/lib/errors';

export function ErrorState({ error, onRetry, title, className }: { error: unknown; onRetry?: () => void; title?: string; className?: string }) {
  const t = useTranslations('errors');
  const tc = useTranslations('common');
  const code = getErrorCode(error);
  return (
    <div role="alert" className={cn('flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-10 text-center', className)}>
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <p className="font-semibold">{title ?? t('title')}</p>
      <p className="max-w-md text-sm text-muted-foreground">{t(`codes.${code}`)}</p>
      <div className="flex gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            {tc('retry')}
          </Button>
        ) : null}
        {code === 'unauthorized' ? (
          <Link href="/login" className={buttonVariants({ variant: 'navy', size: 'sm' })}>
            {t('relogin')}
          </Link>
        ) : null}
        {/* S12: beta kín → trang nhập mã; thao tác admin cần MFA → cài đặt bảo mật */}
        {code === 'beta_required' ? (
          <Link href="/beta" className={buttonVariants({ variant: 'navy', size: 'sm' })} data-testid="error-beta-cta">
            {t('betaCta')}
          </Link>
        ) : null}
        {code === 'mfa_required' ? (
          <Link href="/settings/security" className={buttonVariants({ variant: 'navy', size: 'sm' })} data-testid="error-mfa-cta">
            {t('mfaCta')}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, className }: { title: string; description?: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center', className)}>
      <Inbox className="size-6 text-muted-foreground" aria-hidden />
      <p className="font-semibold">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-3 rounded-xl border border-border bg-card p-5', className)}>
      <Skeleton className="h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i % 2 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
