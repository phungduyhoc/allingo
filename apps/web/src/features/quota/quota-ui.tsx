'use client';

import * as React from 'react';
import { Coins, Gauge, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, buttonVariants, cn, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useEntitlements } from '@/lib/queries';
import { parseInsufficientCredits, parseQuotaExceeded, quotaOf, resetParts, type QuotaInfo } from '@/lib/quota';
import { useProgram } from '@/features/program/program-context';

/** Đường dẫn CTA nâng cấp (trang /pricing – placeholder tới khi billing S7 xong) */
export const UPGRADE_HREF = '/pricing';

const subscribeMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 30_000);
  return () => window.clearInterval(id);
};
const nowMinute = () => Math.floor(Date.now() / 60_000) * 60_000;

/** Thời điểm hiện tại làm tròn phút (không gọi Date.now() trong render; server trả 0) */
export function useNowMinute(): number {
  return React.useSyncExternalStore(subscribeMinute, nowMinute, () => 0);
}

/** Nhãn tính năng trong câu thông báo (vd. "giải thích AI") */
export function useFeatureLabel(): (feature: string) => string {
  const t = useTranslations('quota');
  return (feature) => (t.has(`feature.${feature}` as never) ? t(`feature.${feature}` as never) : t('feature.unknown'));
}

/** "Lượt mới lúc 00:00 ngày mai (giờ Việt Nam)" */
export function ResetHint({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const t = useTranslations('quota');
  const locale = useLocale();
  const now = useNowMinute();
  const parts = now ? resetParts(iso, locale, new Date(now)) : null;
  if (!parts) return null;
  return (
    <span className={className} data-testid="quota-reset" data-reset-at={iso ?? ''}>
      {t('resetAt', { ...parts })}
    </span>
  );
}

/** Hạn mức của một tính năng từ GET /me/entitlements (chỉ hiển thị – server mới là nơi kiểm tra) */
export function useQuota(feature: string): { quota: QuotaInfo | null; isPending: boolean; isPro: boolean; credits: number | null; features: readonly string[] } {
  const program = useProgram();
  const ent = useEntitlements(program);
  return { quota: quotaOf(ent.data, feature), isPending: ent.isPending, isPro: !!ent.data?.is_pro, credits: ent.data?.credits ?? null, features: ent.data?.features ?? [] };
}

/**
 * "Còn x lượt giải thích hôm nay" / "Đề đầy đủ còn y lượt tháng này" + thời điểm reset (giờ VN).
 * Không có dòng hạn mức (Pro không giới hạn) → không hiện gì.
 */
export function QuotaLeft({ feature, bar = false, className }: { feature: 'ai_explain' | 'full_test'; bar?: boolean; className?: string }) {
  const t = useTranslations('quota');
  const { quota } = useQuota(feature);
  if (!quota || quota.limit === null || quota.remaining === null) return null;
  const pct = quota.limit > 0 ? (quota.remaining / quota.limit) * 100 : 0;
  const label = feature === 'ai_explain' ? t('explainLeft', { remaining: quota.remaining }) : t('fullTestLeft', { remaining: quota.remaining });
  return (
    <div
      className={cn('flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-sm', quota.remaining === 0 ? 'border-accent/60 bg-accent/10' : 'border-border bg-card', className)}
      data-testid={`quota-left-${feature}`}
      data-remaining={quota.remaining}
      data-limit={quota.limit}
      title={t('serverNote')}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Gauge className="size-4 text-muted-foreground" aria-hidden />
          {label}
        </span>
        <span className="tabular text-xs text-muted-foreground">{t('ofLimit', { remaining: quota.remaining, limit: quota.limit })}</span>
      </div>
      {bar ? <Progress value={pct} tone={pct < 34 ? 'gold' : 'primary'} label={label} className="h-1.5" /> : null}
      <ResetHint iso={quota.resetAt} className="text-xs text-muted-foreground" />
    </div>
  );
}

/** Chi tiết 429 quota_exceeded: đã dùng/giới hạn, còn lại, thời điểm reset (giờ VN), CTA nâng cấp */
export function QuotaExceededNotice({ error, className, testId = 'quota-exceeded' }: { error: unknown; className?: string; testId?: string }) {
  const t = useTranslations('quota');
  const featureLabel = useFeatureLabel();
  const info = parseQuotaExceeded(error);
  if (!info) return null;
  return (
    <Alert variant="gold" className={className} data-testid={testId} data-feature={info.feature} data-remaining={info.remaining ?? 0}>
      <TriangleAlert aria-hidden />
      <AlertTitle>{t('exceededTitle', { period: info.period, feature: featureLabel(info.feature) })}</AlertTitle>
      <AlertDescription>
        {info.limit !== null ? <p className="tabular">{t('exceededUsed', { used: info.used, limit: info.limit, remaining: info.remaining ?? 0 })}</p> : null}
        <ResetHint iso={info.resetAt} className="block" />
        <p>{t('exceededHint')}</p>
        <Link href={UPGRADE_HREF} className={cn(buttonVariants({ variant: 'gold', size: 'sm' }), 'mt-2')} data-testid="upgrade-cta">
          {t('upgradeCta')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/** 402 insufficient_credits: số credit cần/còn + CTA */
export function CreditsNotice({ error, className }: { error: unknown; className?: string }) {
  const t = useTranslations('quota');
  const info = parseInsufficientCredits(error);
  if (!info) return null;
  return (
    <Alert variant="gold" className={className} data-testid="credits-exceeded">
      <Coins aria-hidden />
      <AlertTitle>{t('creditsTitle')}</AlertTitle>
      <AlertDescription>
        <p>{info.required !== null && info.balance !== null ? t('creditsDesc', { required: info.required, balance: info.balance }) : t('creditsDescUnknown')}</p>
        <Link href={UPGRADE_HREF} className={cn(buttonVariants({ variant: 'gold', size: 'sm' }), 'mt-2')} data-testid="upgrade-cta">
          {t('creditsCta')}
        </Link>
      </AlertDescription>
    </Alert>
  );
}
