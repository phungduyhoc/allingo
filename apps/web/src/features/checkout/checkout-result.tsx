'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, ReceiptText, RotateCcw, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, cn, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { billingKeys, getOrder, payOrder } from '@/lib/billing-api';
import { formatVnd, isSettledOrderStatus, orderPollInterval } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { queryKeys, useEntitlements } from '@/lib/queries';
import { ErrorState } from '@/components/states';
import { useRealtimeEvent } from '@/features/realtime/realtime-provider';
import { growthKeys } from '@/lib/growth-api';
import { clearCheckoutKeys } from './checkout-session';
import { DEFAULT_PROGRAM } from '@allingo/schemas/program/registry';

/**
 * `/checkout/result?order_id=&status=&provider=` – trang cổng chuyển về. CHỈ hiển thị: trạng thái thật đọc từ GET /orders/{id}
 * (polling 2 → 5 → 10 s) hoặc Socket.IO `order.updated`; `status` trên URL chỉ là gợi ý của cổng, không mở quyền.
 * paid → làm mới entitlements/credit/subscription; failed/cancelled còn hạn → "Thử lại" (POST /pay cùng cổng).
 */
export function CheckoutResult() {
  const t = useTranslations('checkout');
  const te = useTranslations('errors');
  const locale = useLocale();
  const loc = useLocalized();
  const qc = useQueryClient();
  const search = useSearchParams();
  const orderId = search.get('order_id') ?? '';
  const provider = search.get('provider');
  const hint = search.get('status');
  const [startedAt] = React.useState(() => Date.now());

  const order = useQuery({
    queryKey: billingKeys.order(orderId),
    queryFn: () => getOrder(orderId),
    enabled: !!orderId,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      if (s && isSettledOrderStatus(s)) return false;
      return orderPollInterval(Date.now() - startedAt);
    },
    refetchIntervalInBackground: true,
    retry: 2,
  });
  useRealtimeEvent('order.updated', (data) => {
    if ((data as { order_id?: string } | null)?.order_id === orderId) void order.refetch();
  });

  const status = order.data?.status ?? null;
  const program = order.data?.plan.programs[0] ?? DEFAULT_PROGRAM;
  const ent = useEntitlements(program, { enabled: status === 'paid' });

  // Đã thanh toán → làm mới quyền, credit, gói, lịch sử, thông báo (một lần)
  const refreshed = React.useRef(false);
  React.useEffect(() => {
    if (status !== 'paid' || refreshed.current) return;
    refreshed.current = true;
    clearCheckoutKeys();
    for (const key of [queryKeys.entitlements, billingKeys.credits, billingKeys.ledger, billingKeys.subscriptions, billingKeys.myOrders, growthKeys.notifications]) void qc.invalidateQueries({ queryKey: key });
  }, [status, qc]);

  const retry = useMutation({
    mutationFn: () =>
      payOrder(orderId, {
        provider: provider ?? order.data?.payments.at(-1)?.provider ?? 'mock',
        return_url: `${window.location.origin}/${locale}/checkout/result`,
        locale: locale === 'en' ? 'en' : 'vi',
      }),
    onSuccess: (pay) => {
      if (pay.redirect_url) window.location.assign(pay.redirect_url);
      else if (pay.deeplink) window.location.href = pay.deeplink;
      else void order.refetch();
    },
  });

  if (!orderId) {
    return (
      <Alert variant="destructive" data-testid="checkout-result" data-status="missing">
        <AlertDescription>{t('result.missing')}</AlertDescription>
      </Alert>
    );
  }
  if (order.isPending) {
    return (
      <div className="flex justify-center py-16" data-testid="checkout-result" data-status="loading">
        <Spinner label={t('result.loading')} />
      </div>
    );
  }
  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;

  const o = order.data;
  const payable = o.payable;
  const tone = o.status === 'paid' ? 'success' : o.status === 'pending' ? 'pending' : 'error';
  const Icon = tone === 'success' ? CheckCircle2 : tone === 'pending' ? Clock : XCircle;

  return (
    <div className="mx-auto max-w-xl space-y-6" data-testid="checkout-result" data-status={o.status}>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <span className={cn('flex size-16 items-center justify-center rounded-full', tone === 'success' ? 'bg-success/15 text-success' : tone === 'pending' ? 'bg-accent/20 text-accent-foreground' : 'bg-destructive/10 text-destructive')}>
            {tone === 'pending' ? <Spinner className="size-7" aria-hidden /> : <Icon className="size-8" aria-hidden />}
          </span>
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold" data-testid="result-title">
              {t(`result.title.${o.status}`)}
            </h1>
            <p className="text-muted-foreground">{t(`result.desc.${o.status}`, { plan: loc(o.plan.name) })}</p>
            {o.status === 'pending' && hint === 'paid' ? <p className="text-sm text-muted-foreground">{t('result.gatewaySaysPaid')}</p> : null}
          </div>
          <dl className="w-full space-y-1 rounded-lg border border-border bg-muted/40 p-4 text-left text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('result.plan')}</dt>
              <dd className="font-medium">{loc(o.plan.name)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('total')}</dt>
              <dd className="font-semibold tabular" data-testid="result-total" data-total={o.total}>
                {formatVnd(o.total, locale)}
              </dd>
            </div>
            {o.promotion_code ? (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('result.promo')}</dt>
                <dd>
                  <Badge variant="outline">{o.promotion_code}</Badge>
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{t('result.orderId')}</dt>
              <dd className="font-mono text-xs">{o.id.slice(0, 8)}</dd>
            </div>
          </dl>
          {o.status === 'paid' ? (
            <p className="text-sm" data-testid="result-entitlement" data-pro={ent.data?.is_pro ? 'true' : 'false'}>
              {ent.isPending ? <Spinner aria-hidden /> : ent.data?.is_pro ? t('result.proActive') : o.plan.kind === 'credit_pack' ? t('result.creditsAdded', { credits: o.plan.credits_included }) : t('result.syncing')}
            </p>
          ) : null}
          {o.status === 'pending' ? <p className="text-xs text-muted-foreground">{t('result.pendingNote')}</p> : null}
          {retry.isError ? (
            <Alert variant="destructive" className="text-left">
              <AlertDescription>{te(`codes.${getErrorCode(retry.error)}`)}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            {o.status === 'paid' ? (
              <>
                <Link href={`/${program}/dashboard`} className={buttonVariants({ variant: 'navy' })} data-testid="result-start">
                  {t('result.start')}
                </Link>
                <Link href={`/account/orders/${o.id}`} className={buttonVariants({ variant: 'outline' })} data-testid="result-order-link">
                  <ReceiptText aria-hidden />
                  {t('result.viewOrder')}
                </Link>
              </>
            ) : (o.status === 'failed' || o.status === 'cancelled') && payable ? (
              <Button variant="gold" onClick={() => retry.mutate()} disabled={retry.isPending} data-testid="result-retry">
                {retry.isPending ? <Spinner aria-hidden /> : <RotateCcw aria-hidden />}
                {t('result.retry')}
              </Button>
            ) : o.status !== 'pending' ? (
              <Link href="/pricing" className={buttonVariants({ variant: 'outline' })} data-testid="result-new-order">
                {t('result.newOrder')}
              </Link>
            ) : null}
            {o.status !== 'paid' ? (
              <Link href="/account/billing" className={buttonVariants({ variant: 'ghost' })}>
                {t('result.history')}
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
