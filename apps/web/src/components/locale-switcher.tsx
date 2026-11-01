'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { NativeSelect } from '@allingo/ui';
import { routing } from '@/i18n/routing';
import { usePathname, useRouter } from '@/i18n/navigation';

export function LocaleSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('nav');
  const tl = useTranslations('settings.locales');
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <NativeSelect
      aria-label={t('language')}
      className={className}
      value={locale}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value as (typeof routing.locales)[number];
        startTransition(() => router.replace(pathname, { locale: next }));
      }}
    >
      {routing.locales.map((l) => (
        <option key={l} value={l}>
          {tl(l)}
        </option>
      ))}
    </NativeSelect>
  );
}
