'use client';

import { PowerOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, cn } from '@allingo/ui';

/** Thông báo thay cho một tính năng đang bị kill-switch tắt (S11) – không lộ tên cờ, gợi ý quay lại sau */
export function FeatureDisabledNotice({ flag, className }: { flag: string; className?: string }) {
  const t = useTranslations('errors');
  return (
    <Alert className={cn('border-border bg-muted/60', className)} data-testid="feature-disabled" data-flag={flag} role="status">
      <PowerOff aria-hidden />
      <AlertTitle>{t('featureDisabled.title')}</AlertTitle>
      <AlertDescription>{t('feature_disabled')}</AlertDescription>
    </Alert>
  );
}
