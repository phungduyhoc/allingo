'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, ShieldAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BILLING_JOBS, type BillingJob } from '@allingo/schemas/api/billing';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner, Switch, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { FLAGS_QUERY_KEY } from '@/features/flags/flags-provider';
import { adminKeys, getBillingSummary, getInvoiceReconciliation, runBillingJob, setFlag, type JobRunResult } from '@/lib/admin-api';
import { billingKeys, getPaymentProviders } from '@/lib/billing-api';
import { formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useMe } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { isAdmin } from './is-admin';
import { InvoicesTab, OrdersTab, PaymentsTab, SubscriptionsTab } from './admin-lists';
import { CreditsTab } from './admin-credits';
import { DeadLettersTab, ReconciliationsTab } from './admin-ops';
import { PromotionsTab } from './admin-promotions';
import { FilterBar } from './ui';
import { ADMIN_TABS, type AdminTab } from './admin-tabs';

// B6/S152: danh sách tab ở module thường (proxy kiểm tra đường dẫn `/admin/billing/<tab>` → 404 thật)
export { ADMIN_TABS, type AdminTab } from './admin-tabs';

/**
 * Billing admin `/admin/billing[/<tab>]` (S7/S8) – chỉ vai trò admin/superadmin: client ẩn menu + chặn route, SERVER vẫn trả 403.
 * Tổng quan, đơn/thanh toán/hoá đơn/subscription có lọc, hoàn tiền, cấp/trừ credit (ghi chú bắt buộc), dead-letter hoá đơn,
 * đối soát (CSV dán/tải lên), khuyến mãi CRUD + thống kê, chạy job thủ công, cờ bán hàng.
 */
export function AdminBillingPage({ tab }: { tab: string | null }) {
  const t = useTranslations('admin');
  const me = useMe();
  const locale = useLocale();
  const [active, setActive] = React.useState<AdminTab>(() => ((ADMIN_TABS as readonly string[]).includes(tab ?? '') ? (tab as AdminTab) : 'overview'));
  const [creditUser, setCreditUser] = React.useState('');

  if (!isAdmin(me.data)) {
    return (
      <Alert variant="destructive" data-testid="admin-forbidden">
        <ShieldAlert aria-hidden />
        <AlertTitle>{t('forbiddenTitle')}</AlertTitle>
        <AlertDescription>{t('forbiddenDesc')}</AlertDescription>
      </Alert>
    );
  }
  const go = (next: AdminTab) => {
    setActive(next);
    // S11: chỉ đổi URL (History API – Next đồng bộ usePathname) thay vì router.replace: mỗi trang giờ render động (CSP nonce) nên
    // phản hồi RSC về muộn hơn và DỰNG LẠI trang (đổi tham số [[...tab]]) → mất bộ lọc/hộp thoại người dùng đang thao tác
    window.history.replaceState(null, '', `/${locale}${next === 'overview' ? '/admin/billing' : `/admin/billing/${next}`}`);
  };

  return (
    <div className="space-y-6" data-testid="admin-billing" data-tab={active}>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <Tabs value={active} onValueChange={(v) => go(v as AdminTab)}>
        <TabsList aria-label={t('title')} className="max-w-full flex-wrap justify-start">
          {ADMIN_TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`admin-tab-${k}`}>
              {t(`tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={t(`tabs.${active}`)}>
        {active === 'overview' ? <OverviewTab /> : null}
        {active === 'orders' ? (
          <OrdersTab
            onCredit={(userId) => {
              setCreditUser(userId);
              go('credits');
            }}
          />
        ) : null}
        {active === 'payments' ? <PaymentsTab /> : null}
        {active === 'invoices' ? <InvoicesTab /> : null}
        {active === 'subscriptions' ? <SubscriptionsTab /> : null}
        {active === 'credits' ? <CreditsTab key={creditUser} initialUserId={creditUser} /> : null}
        {active === 'dead-letters' ? <DeadLettersTab /> : null}
        {active === 'reconciliations' ? <ReconciliationsTab /> : null}
        {active === 'promotions' ? <PromotionsTab /> : null}
        {active === 'jobs' ? <JobsTab /> : null}
      </div>
    </div>
  );
}

const vnMonth = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);

function OverviewTab() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [range, setRange] = React.useState({ from: '', to: '' });
  const [month, setMonth] = React.useState(vnMonth);
  const summary = useQuery({ queryKey: adminKeys.summary(range), queryFn: () => getBillingSummary(range) });
  const recon = useQuery({ queryKey: adminKeys.invoiceRecon(month), queryFn: () => getInvoiceReconciliation(month), enabled: /^\d{4}-\d{2}$/.test(month) });

  return (
    <div className="space-y-6">
      <FilterBar
        value={range}
        onApply={setRange}
        fields={[
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
        ]}
      />
      {summary.isPending ? (
        <CardSkeleton lines={3} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3" data-testid="admin-summary">
            <Stat label={t('revenue')} value={formatVnd(summary.data.revenue_total, locale)} testId="summary-revenue" />
            <Stat label={t('paidOrders')} value={String(summary.data.orders_by_status.paid ?? 0)} testId="summary-paid" />
            <Stat label={t('stuckPending')} value={String(summary.data.stuck_pending)} testId="summary-stuck" warn={summary.data.stuck_pending > 0} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('ordersByStatus')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {Object.entries(summary.data.orders_by_status).map(([k, v]) => (
                  <Badge key={k} variant="outline">
                    {k}: {v}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('byDay')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {summary.data.by_day.length === 0 ? <li className="text-muted-foreground">{t('empty')}</li> : null}
                  {summary.data.by_day.map((d) => (
                    <li key={`${d.day}-${d.provider}`} className="flex justify-between gap-3">
                      <span>
                        {d.day} · {d.provider}
                      </span>
                      <span className="tabular">
                        {d.paid} · {formatVnd(d.revenue, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <Card data-testid="invoice-reconciliation">
        <CardHeader>
          <CardTitle className="text-base">{t('invoiceRecon')}</CardTitle>
          <CardDescription>{t('invoiceReconDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="recon-month" className="text-xs">
                {t('month')}
              </Label>
              <Input id="recon-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 w-44" />
            </div>
          </div>
          {recon.isPending ? (
            <Spinner />
          ) : recon.isError ? (
            <ErrorState error={recon.error} />
          ) : (
            <div className="space-y-2 text-sm">
              <Badge variant={recon.data.matched ? 'success' : 'destructive'} data-testid="invoice-recon-status">
                {recon.data.matched ? t('matched') : t('mismatched')}
              </Badge>
              <p className="tabular">
                {t('reconLine', {
                  paid: recon.data.orders_paid,
                  refunded: recon.data.orders_refunded,
                  expected: recon.data.expected_invoices,
                  issued: recon.data.invoices_issued,
                  cancelled: recon.data.invoices_cancelled,
                  pending: recon.data.invoices_pending,
                  failed: recon.data.invoices_failed,
                })}
              </p>
              {recon.data.missing.length ? <p className="text-destructive">{t('reconMissing', { ids: recon.data.missing.map((m) => m.order_id.slice(0, 8)).join(', ') })}</p> : null}
              {recon.data.unexpected.length ? <p className="text-destructive">{t('reconUnexpected', { ids: recon.data.unexpected.map((m) => m.order_id.slice(0, 8)).join(', ') })}</p> : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, testId, warn = false }: { label: string; value: string; testId: string; warn?: boolean }) {
  return (
    <Card className={warn ? 'border-accent' : undefined}>
      <CardContent className="p-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-extrabold tabular" data-testid={testId}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function JobsTab() {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const [results, setResults] = React.useState<Partial<Record<BillingJob, JobRunResult>>>({});
  const qc = useQueryClient();
  // Trạng thái cờ bán hàng đọc gián tiếp qua GET /payments/providers (`checkout_enabled`) – API không có GET cờ
  const providers = useQuery({ queryKey: billingKeys.providers, queryFn: getPaymentProviders });
  const checkout = providers.data?.checkout_enabled ?? null;
  const run = useMutation({
    mutationFn: (job: BillingJob) => runBillingJob(job),
    onSuccess: (r, job) => {
      setResults((x) => ({ ...x, [job]: r }));
      toast.success(t('jobDone', { job, status: r.status }));
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  const flag = useMutation({
    mutationFn: (enabled: boolean) => setFlag('ff.billing.checkout', { enabled }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: billingKeys.providers });
      // S11: cờ công khai (GET /flags) của chính trang này cập nhật ngay
      void qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
      toast.success(t('flagSaved'));
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('jobsTitle')}</CardTitle>
          <CardDescription>{t('jobsDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {BILLING_JOBS.map((job) => (
              <li key={job} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <code className="font-mono text-sm font-semibold">{job}</code>
                  <span className="block text-xs text-muted-foreground">{t(`jobs.${job.replace('.', '_')}`)}</span>
                  {results[job] ? (
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted p-2 text-xs" data-testid={`job-result-${job}`}>
                      {JSON.stringify(results[job]?.result ?? results[job], null, 1)}
                    </pre>
                  ) : null}
                </span>
                <Button variant="outline" size="sm" disabled={run.isPending} onClick={() => run.mutate(job)} data-testid={`job-run-${job}`}>
                  {run.isPending && run.variables === job ? <Spinner aria-hidden /> : <Play aria-hidden />}
                  {t('run')}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('flagTitle')}</CardTitle>
          <CardDescription>{t('flagDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch checked={checkout ?? true} disabled={flag.isPending} onCheckedChange={(v) => flag.mutate(v)} aria-label={t('flagTitle')} data-testid="flag-checkout" />
          <span className="text-sm text-muted-foreground">{checkout === null ? t('flagUnknown') : checkout ? t('flagOn') : t('flagOff')}</span>
        </CardContent>
      </Card>
    </div>
  );
}
