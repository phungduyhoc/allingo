'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Copy, Download, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { billingKeys, getOrder, payOrder } from '@/lib/billing-api';
import { formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { OrderStatusBadge } from './order-status-badge';

/** Chi tiết đơn (`/account/orders/{id}` – cũng là đích của thông báo order_paid/invoice_issued): thanh toán + hoá đơn điện tử */
export function OrderDetail({ orderId }: { orderId: string }) {
  const t = useTranslations('account');
  const tc = useTranslations('checkout');
  const tb = useTranslations('billing');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const locale = useLocale();
  const loc = useLocalized();
  const order = useQuery({ queryKey: billingKeys.order(orderId), queryFn: () => getOrder(orderId) });
  const [downloading, setDownloading] = React.useState(false);
  const retry = useMutation({
    mutationFn: (provider: string) => payOrder(orderId, { provider, return_url: `${window.location.origin}/${locale}/checkout/result`, locale: locale === 'en' ? 'en' : 'vi' }),
    onSuccess: (pay) => {
      if (pay.redirect_url) window.location.assign(pay.redirect_url);
      else if (pay.deeplink) window.location.href = pay.deeplink;
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });

  if (order.isPending) return <CardSkeleton lines={6} />;
  if (order.isError) return <ErrorState error={order.error} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const inv = o.invoice;
  const date = (iso: string | null | undefined) => (iso ? fmt.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  /** PDF là URL ký 10 phút – hết hạn thì tải lại đơn để lấy URL mới trước khi mở */
  const openPdf = async () => {
    setDownloading(true);
    try {
      let url = inv?.pdf_url ?? null;
      const exp = inv?.pdf_expires_at ? Date.parse(inv.pdf_expires_at) : 0;
      if (!url || exp - Date.now() < 30_000) url = (await order.refetch()).data?.invoice?.pdf_url ?? null;
      if (url) window.open(url, '_blank', 'noopener');
      else toast.error(t('invoice.pdfUnavailable'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="order-detail" data-status={o.status}>
      <PageHeader
        title={t('orderTitle')}
        description={`#${o.id.slice(0, 8)} · ${date(o.created_at)}`}
        actions={
          <Link href="/account/billing?tab=orders" className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden />
            {t('backToOrders')}
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{loc(o.plan.name)}</CardTitle>
              <OrderStatusBadge status={o.status} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              <Row label={tc('subtotal')} value={formatVnd(o.subtotal, locale)} />
              {o.discount ? <Row label={`${tc('discount')}${o.promotion_code ? ` (${o.promotion_code})` : ''}`} value={`−${formatVnd(o.discount, locale)}`} /> : null}
              {o.promotion?.bonus_credits ? <Row label={t('bonusCredits')} value={`+${o.promotion.bonus_credits}`} /> : null}
              <Row label={tc('total')} value={<span className="font-bold">{formatVnd(o.total, locale)}</span>} />
              <Row label={t('paidAt')} value={date(o.paid_at)} />
              {o.status === 'pending' ? <Row label={t('expiresAt')} value={date(o.expires_at)} /> : null}
            </dl>
            {o.payments.length ? (
              <div>
                <p className="mb-1.5 text-sm font-semibold">{t('payments')}</p>
                <ul className="space-y-1 text-sm">
                  {o.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-border px-3 py-2">
                      <span>
                        {tb.has(`providers.${p.provider}`) ? tb(`providers.${p.provider}`) : p.provider} · {date(p.created_at)}
                      </span>
                      <Badge variant={p.status === 'success' ? 'success' : p.status === 'failed' ? 'destructive' : 'muted'}>{t.has(`paymentStatus.${p.status}`) ? t(`paymentStatus.${p.status}`) : p.status}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {o.payable && o.payments.length ? (
              <Button variant="gold" disabled={retry.isPending} onClick={() => retry.mutate(o.payments.at(-1)!.provider)} data-testid="order-retry">
                {retry.isPending ? <Spinner aria-hidden /> : <RotateCcw aria-hidden />}
                {tc('result.retry')}
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card data-testid="invoice-card" data-invoice-status={inv?.status ?? 'none'}>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-2">
              <FileText className="size-5 text-muted-foreground" aria-hidden />
              {t('invoice.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!inv ? (
              <p className="text-sm text-muted-foreground">{o.status === 'paid' ? t('invoice.preparing') : t('invoice.afterPayment')}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={inv.status === 'issued' ? 'success' : inv.status === 'cancelled' ? 'outline' : inv.status === 'failed' || inv.status === 'error' ? 'destructive' : 'gold'} data-testid="invoice-status">
                    {t(`invoice.status.${inv.status}`)}
                  </Badge>
                  {inv.buyer_type ? <span className="text-xs text-muted-foreground">{t(`invoice.buyer.${inv.buyer_type}`)}</span> : null}
                </div>
                <dl className="space-y-1.5 text-sm">
                  <Row label={t('invoice.series')} value={inv.series ?? '—'} />
                  <Row label={t('invoice.number')} value={<span data-testid="invoice-number">{inv.invoice_no ?? '—'}</span>} />
                  <Row
                    label={t('invoice.lookupCode')}
                    value={
                      inv.lookup_code ? (
                        <span className="inline-flex items-center gap-1">
                          <code className="font-mono" data-testid="invoice-lookup">
                            {inv.lookup_code}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('invoice.copy')}
                            onClick={() => void navigator.clipboard?.writeText(inv.lookup_code!).then(() => toast.success(t('invoice.copied')), () => undefined)}
                          >
                            <Copy aria-hidden />
                          </Button>
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <Row label={t('invoice.issuedAt')} value={date(inv.issued_at)} />
                  {inv.cancelled_at ? <Row label={t('invoice.cancelledAt')} value={date(inv.cancelled_at)} /> : null}
                </dl>
                <div className="flex flex-wrap gap-2">
                  {inv.status === 'issued' || inv.pdf_url ? (
                    <Button variant="navy" disabled={downloading} onClick={() => void openPdf()} data-testid="invoice-pdf">
                      {downloading ? <Spinner aria-hidden /> : <Download aria-hidden />}
                      {t('invoice.download')}
                    </Button>
                  ) : null}
                  {inv.lookup_url ? (
                    <a href={inv.lookup_url} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })}>
                      <ExternalLink aria-hidden />
                      {t('invoice.lookup')}
                    </a>
                  ) : null}
                </div>
              </>
            )}
            {o.buyer_info ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                <p className="mb-1 font-semibold">{t('invoice.buyerInfo')}</p>
                {o.buyer_info.company ? <p>{o.buyer_info.company}</p> : null}
                {o.buyer_info.tax_code ? <p>{t('invoice.taxCode', { code: o.buyer_info.tax_code })}</p> : null}
                {o.buyer_info.address ? <p className="text-muted-foreground">{o.buyer_info.address}</p> : null}
                {o.buyer_info.name ? <p className="text-muted-foreground">{o.buyer_info.name}</p> : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular">{value}</dd>
    </div>
  );
}
