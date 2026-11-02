'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { billingKeys, listSubscriptions } from '@/lib/billing-api';
import { useLocalized } from '@/lib/localized';
import { useMe } from '@/lib/queries';
import { useNowMinute } from '@/features/quota/quota-ui';
import { pickBanner } from './banner';

const DISMISS_KEY = 'allingo.sub-banner.dismissed';
function readDismissed(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** Banner trong AppShell: dùng thử còn N ngày / sắp hết hạn / vừa hết hạn – CTA về /pricing; ẩn được trong phiên */
export function SubscriptionBanner() {
  const t = useTranslations('billing.banner');
  const loc = useLocalized();
  const me = useMe();
  const now = useNowMinute();
  const enabled = !!me.data && !me.data.is_guest;
  const subs = useQuery({ queryKey: billingKeys.subscriptions, queryFn: listSubscriptions, enabled, staleTime: 60_000 });
  const [dismissed, setDismissed] = React.useState<string | null>(() => (typeof window === 'undefined' ? null : readDismissed()));
  if (!enabled || !subs.data || !now) return null;
  const pick = pickBanner(subs.data, now);
  if (!pick) return null;
  const key = `${pick.kind}:${pick.sub.id}`;
  if (dismissed === key) return null;
  const plan = loc(pick.sub.plan.name);
  const days = Math.max(0, pick.sub.days_left ?? 0);
  return (
    <div className={cn('border-b', pick.kind === 'trialing' ? 'border-primary/30 bg-primary/10' : 'border-accent/50 bg-accent/15')} data-testid="subscription-banner" data-kind={pick.kind}>
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="flex items-start gap-2">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t(pick.kind, { plan, days })}</span>
        </p>
        <div className="flex items-center gap-2">
          <Link href="/pricing" className={buttonVariants({ variant: 'navy', size: 'sm' })} data-testid="subscription-banner-cta">
            {t(`${pick.kind}Cta`)}
          </Link>
          <button
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            aria-label={t('dismiss')}
            onClick={() => {
              try {
                window.sessionStorage.setItem(DISMISS_KEY, key);
              } catch {
                /* bỏ qua */
              }
              setDismissed(key);
            }}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
