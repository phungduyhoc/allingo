'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Coins, Crown, Gift, ReceiptText } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import type { LedgerEntry, Order, Subscription } from '@allingo/schemas';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@allingo/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { billingKeys, cancelSubscription, getCredits, listLedger, listMyOrders, listSubscriptions } from '@/lib/billing-api';
import { detailReasonOf, formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { queryKeys, useMe } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { OrderStatusBadge } from './order-status-badge';

const TABS = ['plan', 'orders', 'credits'] as const;
type Tab = (typeof TABS)[number];

/** Tài khoản → Thanh toán (S7/S8): gói hiện tại + huỷ gia hạn, lịch sử đơn (cursor), sổ credit (cursor) */
export function BillingPage() {
  const t = useTranslations('account');
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const initial = (TABS as readonly string[]).includes(search.get('tab') ?? '') ? (search.get('tab') as Tab) : 'plan';
  const [tab, setTab] = React.useState<Tab>(initial);

  return (
    <div className="space-y-6" data-testid="billing-page">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Link href="/pricing" className={buttonVariants({ variant: 'gold' })}>
            <Crown aria-hidden />
            {t('upgrade')}
          </Link>
        }
      />
      {me.data?.is_guest ? (
        <Alert variant="gold">
          <AlertDescription>
            {t('guestNote')}{' '}
            <Link href="/signup?next=/account/billing" className="font-semibold text-primary underline-offset-4 hover:underline">
              {t('signup')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as Tab);
          router.replace(`${pathname}?tab=${v}`, { scroll: false });
        }}
      >
        <TabsList aria-label={t('title')}>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`billing-tab-${k}`}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="plan">{tab === 'plan' ? <PlanTab /> : null}</TabsContent>
        <TabsContent value="orders">{tab === 'orders' ? <OrdersTab /> : null}</TabsContent>
        <TabsContent value="credits">{tab === 'credits' ? <CreditsTab /> : null}</TabsContent>
      </Tabs>
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <Gift className="size-5 text-accent" aria-hidden />
            <div>
              <p className="font-semibold">{t('referralTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('referralDesc')}</p>
            </div>
          </div>
          <Link href="/referral" className={buttonVariants({ variant: 'outline' })} data-testid="billing-referral-link">
            {t('referralCta')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function PlanTab() {
  const t = useTranslations('account');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const loc = useLocalized();
  const qc = useQueryClient();
  const subs = useQuery({ queryKey: billingKeys.subscriptions, queryFn: listSubscriptions });
  const credits = useQuery({ queryKey: billingKeys.credits, queryFn: getCredits });
  const [confirm, setConfirm] = React.useState<Subscription | null>(null);
  const cancel = useMutation({
    mutationFn: (id: string) => cancelSubscription(id),
    onSuccess: (s) => {
      toast.success(t('cancelDone', { date: s.current_period_end ? fmt.dateTime(new Date(s.current_period_end), { dateStyle: 'medium' }) : '' }));
      setConfirm(null);
      void qc.invalidateQueries({ queryKey: billingKeys.subscriptions });
      void qc.invalidateQueries({ queryKey: queryKeys.entitlements });
    },
    onError: (err) => {
      const r = detailReasonOf(err);
      toast.error(r === 'lifetime' ? t('cancelLifetime') : getErrorCode(err) === 'conflict' ? t('cancelConflict') : te(`codes.${getErrorCode(err)}`));
    },
  });

  if (subs.isPending) return <CardSkeleton lines={3} />;
  if (subs.isError) return <ErrorState error={subs.error} onRetry={() => void subs.refetch()} />;
  const current = subs.data.filter((s) => s.is_current);
  const upcoming = subs.data.filter((s) => s.upcoming);
  const past = subs.data.filter((s) => !s.is_current && !s.upcoming);
  const date = (iso: string | null) => (iso ? fmt.dateTime(new Date(iso), { dateStyle: 'medium' }) : '—');

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        {current.length === 0 ? (
          <Card data-testid="current-plan" data-plan="free">
            <CardHeader>
              <CardTitle>{t('freePlan')}</CardTitle>
              <CardDescription>{t('freePlanDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/pricing" className={buttonVariants({ variant: 'navy' })}>
                {t('seePlans')}
              </Link>
            </CardContent>
          </Card>
        ) : (
          current.map((s) => (
            <Card key={s.id} data-testid="current-plan" data-plan={s.plan.code} data-status={s.status}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{loc(s.plan.name)}</CardTitle>
                  <SubStatusBadge s={s} />
                </div>
                <CardDescription>
                  {s.current_period_end
                    ? s.cancel_at_period_end || s.status === 'cancelled'
                      ? t('endsOn', { date: date(s.current_period_end), days: s.days_left ?? 0 })
                      : t('renewsOn', { date: date(s.current_period_end), days: s.days_left ?? 0 })
                    : t('lifetime')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {s.source_order_id ? (
                  <Link href={`/account/orders/${s.source_order_id}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    <ReceiptText aria-hidden />
                    {t('viewOrder')}
                  </Link>
                ) : null}
                {s.current_period_end && !s.cancel_at_period_end && (s.status === 'active' || s.status === 'trialing') ? (
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(s)} data-testid="subscription-cancel">
                    {s.status === 'trialing' ? t('cancelTrial') : t('cancel')}
                  </Button>
                ) : null}
                <Link href="/pricing" className={buttonVariants({ variant: 'gold', size: 'sm' })}>
                  {t('renew')}
                </Link>
              </CardContent>
            </Card>
          ))
        )}
        {upcoming.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('upcoming')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {upcoming.map((s) => (
                  <li key={s.id} className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{loc(s.plan.name)}</span>
                    <span className="text-muted-foreground">{t('periodRange', { from: date(s.current_period_start), to: date(s.current_period_end) })}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
        {past.length ? (
          <details className="rounded-xl border border-border bg-card p-4">
            <summary className="cursor-pointer text-sm font-semibold">{t('pastPlans', { count: past.length })}</summary>
            <ul className="mt-3 space-y-2 text-sm">
              {past.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {loc(s.plan.name)} <SubStatusBadge s={s} />
                  </span>
                  <span className="text-muted-foreground">{t('periodRange', { from: date(s.current_period_start), to: date(s.current_period_end) })}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
      <Card data-testid="credit-balance" data-balance={credits.data?.balance ?? ''}>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Coins className="size-5 text-accent" aria-hidden />
            {t('creditBalance')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {credits.isPending ? <Spinner /> : credits.isError ? <p className="text-sm text-muted-foreground">{te(`codes.${getErrorCode(credits.error)}`)}</p> : <p className="text-3xl font-extrabold tabular">{fmt.number(credits.data.balance)}</p>}
          {credits.data?.expiring_soon.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {credits.data.expiring_soon.map((x, i) => (
                <li key={i}>{t('expiringSoon', { amount: x.amount, date: date(x.expires_at) })}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
      <Dialog open={!!confirm} onOpenChange={(o) => (o ? null : setConfirm(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.status === 'trialing' ? t('cancelTrialTitle') : t('cancelTitle')}</DialogTitle>
            <DialogDescription>{t('cancelDesc', { plan: confirm ? loc(confirm.plan.name) : '', date: date(confirm?.current_period_end ?? null) })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)}>
              {t('keep')}
            </Button>
            <Button variant="destructive" disabled={cancel.isPending} onClick={() => confirm && cancel.mutate(confirm.id)} data-testid="subscription-cancel-confirm">
              {cancel.isPending ? <Spinner aria-hidden /> : null}
              {t('cancelConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubStatusBadge({ s }: { s: Subscription }) {
  const t = useTranslations('account');
  const key = s.cancel_at_period_end && s.status === 'active' ? 'cancelling' : s.status;
  const variant = key === 'active' || key === 'lifetime' ? 'success' : key === 'trialing' ? 'gold' : key === 'cancelling' ? 'outline' : 'muted';
  return (
    <Badge variant={variant} data-testid="subscription-status" data-status={key}>
      {t(`subStatus.${key}`)}
    </Badge>
  );
}

function OrdersTab() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const fmt = useFormatter();
  const locale = useLocale();
  const loc = useLocalized();
  const q = useInfiniteQuery({
    queryKey: billingKeys.myOrders,
    queryFn: ({ pageParam }) => listMyOrders(pageParam, 10),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  if (q.isPending) return <CardSkeleton lines={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const orders: Order[] = q.data.pages.flatMap((p) => p.data);
  if (orders.length === 0) return <EmptyState title={t('noOrders')} action={<Link href="/pricing" className={buttonVariants({ variant: 'navy', size: 'sm' })}>{t('seePlans')}</Link>} />;
  return (
    <Card>
      <CardContent className="p-0">
        <ul className="divide-y divide-border" data-testid="order-list">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href={`/account/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted" data-testid="order-row" data-status={o.status}>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{loc(o.plan.name)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {fmt.dateTime(new Date(o.created_at), { dateStyle: 'medium', timeStyle: 'short' })} · #{o.id.slice(0, 8)}
                    {o.invoice?.invoice_no ? ` · ${t('invoiceShort', { series: o.invoice.series ?? '', no: o.invoice.invoice_no })}` : ''}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-semibold tabular">{formatVnd(o.total, locale)}</span>
                  <OrderStatusBadge status={o.status} />
                </span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
        {q.hasNextPage ? (
          <div className="flex justify-center p-3">
            <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} data-testid="orders-more">
              {q.isFetchingNextPage ? <Spinner aria-hidden /> : null}
              {tc('next')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function LedgerList({ entries, testId = 'ledger-list' }: { entries: LedgerEntry[]; testId?: string }) {
  const t = useTranslations('account');
  const fmt = useFormatter();
  return (
    <ul className="divide-y divide-border" data-testid={testId}>
      {entries.map((e) => (
        <li key={e.id} className="flex items-center gap-3 px-4 py-3" data-testid="ledger-row" data-reason={e.reason} data-delta={e.delta}>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t.has(`ledgerReason.${e.reason}`) ? t(`ledgerReason.${e.reason}`) : e.reason}</span>
            <span className="block text-xs text-muted-foreground">
              {fmt.dateTime(new Date(e.created_at), { dateStyle: 'medium', timeStyle: 'short' })}
              {e.note ? ` · ${e.note}` : ''}
              {e.expires_at ? ` · ${t('expires', { date: fmt.dateTime(new Date(e.expires_at), { dateStyle: 'medium' }) })}` : ''}
            </span>
          </span>
          <span className="text-right">
            <span className={cn('block font-semibold tabular', e.delta >= 0 ? 'text-success' : 'text-destructive')}>
              {e.delta >= 0 ? '+' : '−'}
              {fmt.number(Math.abs(e.delta))}
            </span>
            <span className="block text-xs text-muted-foreground tabular">{t('balanceAfter', { balance: e.balance_after })}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function CreditsTab() {
  const t = useTranslations('account');
  const tc = useTranslations('common');
  const q = useInfiniteQuery({
    queryKey: billingKeys.ledger,
    queryFn: ({ pageParam }) => listLedger(pageParam, 20),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  if (q.isPending) return <CardSkeleton lines={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const entries = q.data.pages.flatMap((p) => p.data);
  if (entries.length === 0) return <EmptyState title={t('noLedger')} />;
  return (
    <Card>
      <CardContent className="p-0">
        <LedgerList entries={entries} />
        {q.hasNextPage ? (
          <div className="flex justify-center p-3">
            <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? <Spinner aria-hidden /> : null}
              {tc('next')}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
