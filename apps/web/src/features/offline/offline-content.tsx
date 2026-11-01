'use client';

import { WifiOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@allingo/ui';
import { LogoMark } from '@/components/logo';

export function OfflineContent() {
  const t = useTranslations('offline');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-4 text-center">
      <LogoMark className="size-12" />
      <WifiOff className="size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="max-w-md text-muted-foreground">{t('desc')}</p>
      <Button variant="navy" onClick={() => window.location.reload()}>
        {t('retry')}
      </Button>
    </main>
  );
}
