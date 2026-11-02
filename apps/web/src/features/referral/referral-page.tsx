'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Gift, MessageCircle, Share2, TriangleAlert, UserPlus, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { getReferral, growthKeys } from '@/lib/growth-api';
import { isApiError } from '@/lib/errors';
import { useMe } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';

/** Sao chép vào clipboard (API Clipboard; không có → chọn chữ trong ô để người dùng tự sao chép) */
async function copyText(text: string, input?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    input?.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/**
 * Trang Giới thiệu bạn bè (S8): mã + link chia sẻ (UTM, trang OG `/r/{code}`), sao chép, chia sẻ Facebook/Messenger/Zalo
 * (Zalo: Web Share API trên thiết bị hỗ trợ, ngược lại sao chép link để dán vào Zalo – Zalo Share SDK cần OA id), thống kê
 * joined/started/upgraded, credit đã nhận, trần thưởng tháng, danh sách gần đây (tên đã che). Khách → 403 → mời đăng ký.
 */
export function ReferralPage() {
  const t = useTranslations('referral');
  const fmt = useFormatter();
  const me = useMe();
  const q = useQuery({ queryKey: growthKeys.referral, queryFn: getReferral, enabled: !!me.data && !me.data.is_guest, retry: false });
  const linkRef = React.useRef<HTMLInputElement>(null);
  const [copied, setCopied] = React.useState<'link' | 'code' | null>(null);

  const doCopy = async (what: 'link' | 'code', text: string) => {
    const ok = await copyText(text, what === 'link' ? linkRef.current : null);
    if (ok) {
      setCopied(what);
      toast.success(what === 'link' ? t('copiedLink') : t('copiedCode'));
      window.setTimeout(() => setCopied(null), 2000);
    } else toast.error(t('copyFailed'));
  };

  if (me.data?.is_guest) {
    return (
      <div className="space-y-6" data-testid="referral-page" data-state="guest">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState
          title={t('guestTitle')}
          description={t('guestDesc')}
          action={
            <Link href="/signup?next=/referral" className={buttonVariants({ variant: 'navy' })}>
              <UserPlus aria-hidden />
              {t('guestCta')}
            </Link>
          }
        />
      </div>
    );
  }
  if (q.isPending) return <CardSkeleton lines={6} />;
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 403) return <EmptyState title={t('guestTitle')} description={t('guestDesc')} />;
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  }
  const r = q.data;
  const capPct = r.rewards.monthly_cap > 0 ? Math.min(100, (r.rewards.this_month / r.rewards.monthly_cap) * 100) : 0;
  const share = async (channel: 'zalo' | 'native') => {
    const data = { title: r.og.title, text: r.share.text, url: r.link };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(data);
        return;
      } catch {
        /* người dùng huỷ hoặc không hỗ trợ → sao chép */
      }
    }
    await doCopy('link', r.link);
    if (channel === 'zalo') toast.info(t('zaloPaste'));
  };

  return (
    <div className="space-y-6" data-testid="referral-page" data-code={r.code}>
      <PageHeader title={t('title')} description={t('subtitle', { referrer: r.config.rewards.started.referrer, referee: r.config.rewards.started.referee })} />
      {!r.enabled ? (
        <Alert variant="gold" data-testid="referral-disabled">
          <TriangleAlert aria-hidden />
          <AlertDescription>{t('disabled')}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader>
            <CardTitle>{t('shareTitle')}</CardTitle>
            <CardDescription>{t('shareDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-muted-foreground">{t('yourCode')}</span>
              <code className="rounded-lg border border-dashed border-accent bg-accent/10 px-3 py-1.5 font-mono text-xl font-bold tracking-widest" data-testid="referral-code">
                {r.code}
              </code>
              <Button variant="ghost" size="sm" onClick={() => void doCopy('code', r.code)} data-testid="referral-copy-code">
                {copied === 'code' ? <Check aria-hidden /> : <Copy aria-hidden />}
                {t('copyCode')}
              </Button>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="referral-link" className="text-sm font-medium">
                {t('yourLink')}
              </label>
              <div className="flex gap-2">
                <Input id="referral-link" ref={linkRef} readOnly value={r.link} onFocus={(e) => e.currentTarget.select()} data-testid="referral-link" data-landing={r.landing_url} />
                <Button variant="navy" onClick={() => void doCopy('link', r.link)} data-testid="referral-copy-link">
                  {copied === 'link' ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {t('copyLink')}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={r.share.facebook} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })} data-testid="share-facebook">
                <Share2 aria-hidden />
                Facebook
              </a>
              <a href={r.share.messenger} className={buttonVariants({ variant: 'outline' })} data-testid="share-messenger">
                <MessageCircle aria-hidden />
                Messenger
              </a>
              <Button variant="outline" onClick={() => void share('zalo')} data-testid="share-zalo" data-href={r.share.zalo}>
                <MessageCircle aria-hidden />
                Zalo
              </Button>
              <Button variant="ghost" onClick={() => void share('native')}>
                <Share2 aria-hidden />
                {t('shareMore')}
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
              <p className="mb-2 font-semibold">{t('howTitle')}</p>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>{t('how1')}</li>
                <li>{t('how2', { referrer: r.config.rewards.started.referrer, referee: r.config.rewards.started.referee })}</li>
                <li>{t('how3', { referrer: r.config.rewards.upgraded.referrer, referee: r.config.rewards.upgraded.referee })}</li>
              </ol>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card data-testid="referral-stats" data-joined={r.joined} data-started={r.started} data-upgraded={r.upgraded}>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Users className="size-5 text-muted-foreground" aria-hidden />
                {t('statsTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-3 gap-2 text-center">
                {(['joined', 'started', 'upgraded'] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-muted/60 p-2">
                    <dd className="text-2xl font-extrabold tabular" data-testid={`referral-${k}`}>
                      {r[k]}
                    </dd>
                    <dt className="text-xs text-muted-foreground">{t(`stage.${k}`)}</dt>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="inline-flex items-center gap-2">
                <Gift className="size-5 text-accent" aria-hidden />
                {t('rewardsTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="text-2xl font-extrabold tabular" data-testid="referral-credits">
                  {fmt.number(r.credits_earned)}
                </span>{' '}
                {t('creditsEarned')}
              </p>
              <div className="space-y-1">
                <p className="text-muted-foreground">{t('monthCap', { used: r.rewards.this_month, cap: r.rewards.monthly_cap })}</p>
                <Progress value={capPct} tone={capPct >= 100 ? 'gold' : 'primary'} label={t('monthCap', { used: r.rewards.this_month, cap: r.rewards.monthly_cap })} className="h-1.5" />
              </div>
              {r.rewards.skipped ? <p className="text-xs text-muted-foreground">{t('skipped', { count: r.rewards.skipped })}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('recentTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {r.recent.length === 0 ? (
            <EmptyState title={t('recentEmpty')} className="m-4" />
          ) : (
            <ul className="divide-y divide-border" data-testid="referral-recent">
              {r.recent.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="referral-item" data-status={x.status}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{x.display_name}</span>
                    <span className="block text-xs text-muted-foreground">{t('joinedAt', { date: fmt.dateTime(new Date(x.joined_at), { dateStyle: 'medium' }) })}</span>
                  </span>
                  <Badge variant={x.status === 'upgraded' ? 'success' : x.status === 'started' ? 'gold' : 'secondary'}>{t(`stage.${x.status}`)}</Badge>
                  {x.blocked_reason ? (
                    <Badge variant="muted" title={t(`blocked.${x.blocked_reason}`)}>
                      {t('notRewarded')}
                    </Badge>
                  ) : x.rewarded.started || x.rewarded.upgraded ? (
                    <Badge variant="outline" className={cn('border-success/50 text-success')}>
                      {t('rewarded')}
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
