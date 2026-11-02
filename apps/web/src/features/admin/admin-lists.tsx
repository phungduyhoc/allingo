'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins, Undo2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { INVOICE_STATUSES, ORDER_STATUSES, PAYMENT_PROVIDER_CODES, PAYMENT_STATUSES, SUBSCRIPTION_STATUSES, refundInputSchema } from '@allingo/schemas';
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, Spinner, Textarea } from '@allingo/ui';
import { adminKeys, listAdminInvoices, listAdminOrders, listAdminPayments, listAdminSubscriptions, refundOrder, type AdminOrder } from '@/lib/admin-api';
import { formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { OrderStatusBadge } from '@/features/account/order-status-badge';
import { DataTable, FilterBar, ShortId, useCursorList, When } from './ui';

const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));
const UUID = /^[0-9a-f-]{36}$/i;
const uuidOrEmpty = (v: string) => (UUID.test(v.trim()) ? v.trim() : undefined);

// ----------------------------------------------------------------------------- Đơn hàng + hoàn tiền

export function OrdersTab({ onCredit }: { onCredit: (userId: string) => void }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const loc = useLocalized();
  const [f, setF] = React.useState({ status: '', provider: '', user_id: '', from: '', to: '' });
  const query = { ...f, user_id: uuidOrEmpty(f.user_id), limit: 20 };
  const { q, rows } = useCursorList(adminKeys.list('orders', query), (cursor) => listAdminOrders({ ...query, cursor }));
  const [refund, setRefund] = React.useState<AdminOrder | null>(null);
  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onApply={setF}
        testId="orders-filter"
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: opts(ORDER_STATUSES) },
          { name: 'provider', label: t('provider'), type: 'select', options: opts(PAYMENT_PROVIDER_CODES) },
          { name: 'user_id', label: t('userId'), placeholder: 'uuid' },
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
        ]}
      />
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(o) => o.id}
        rowTestId="admin-order-row"
        rowAttrs={(o) => ({ 'data-order': o.id, 'data-status': o.status, 'data-user': o.user_id })}
        empty={t('empty')}
        columns={[
          { key: 'created', header: t('createdAt'), cell: (o) => <When iso={o.created_at} /> },
          { key: 'id', header: t('order'), cell: (o) => <ShortId id={o.id} /> },
          { key: 'user', header: t('user'), cell: (o) => <ShortId id={o.user_id} onClick={() => setF((x) => ({ ...x, user_id: o.user_id }))} title={t('filterUser')} /> },
          { key: 'plan', header: t('plan'), cell: (o) => loc(o.plan.name) },
          { key: 'total', header: t('total'), cell: (o) => <span className="tabular">{formatVnd(o.total, locale)}</span>, className: 'text-right' },
          { key: 'promo', header: t('promo'), cell: (o) => (o.promotion_code ? <Badge variant="outline">{o.promotion_code}</Badge> : '—') },
          { key: 'status', header: t('status'), cell: (o) => <OrderStatusBadge status={o.status} /> },
          { key: 'provider', header: t('provider'), cell: (o) => o.payments.map((p) => p.provider).join(', ') || '—' },
          { key: 'invoice', header: t('invoice'), cell: (o) => (o.invoice ? `${o.invoice.status}${o.invoice.invoice_no ? ` · ${o.invoice.invoice_no}` : ''}` : '—') },
          {
            key: 'actions',
            header: '',
            cell: (o) => (
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label={t('creditUser')} title={t('creditUser')} onClick={() => onCredit(o.user_id)} data-testid="order-credit">
                  <Coins aria-hidden />
                </Button>
                {o.status === 'paid' ? (
                  <Button variant="ghost" size="icon-sm" aria-label={t('refund')} title={t('refund')} onClick={() => setRefund(o)} data-testid="order-refund">
                    <Undo2 aria-hidden />
                  </Button>
                ) : null}
              </div>
            ),
          },
        ]}
      />
      <RefundDialog order={refund} onClose={() => setRefund(null)} />
    </div>
  );
}

function RefundDialog({ order, onClose }: { order: AdminOrder | null; onClose: () => void }) {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [revoke, setRevoke] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => refundOrder(order!.id, { reason: reason.trim(), revoke_credits: revoke }),
    onSuccess: (r) => {
      const shortfall = (r.revoked as { credits_shortfall?: number } | undefined)?.credits_shortfall;
      toast.success(shortfall ? t('refundDoneShortfall', { shortfall }) : t('refundDone'));
      void qc.invalidateQueries({ queryKey: adminKeys.all });
      setReason('');
      onClose();
    },
    onError: (err) => setError(getErrorCode(err) === 'conflict' ? t('refundConflict') : te(`codes.${getErrorCode(err)}`)),
  });
  return (
    <Dialog open={!!order} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('refundTitle')}</DialogTitle>
          <DialogDescription>{order ? t('refundDesc', { id: order.id.slice(0, 8), total: formatVnd(order.total, locale) }) : null}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            const parsed = refundInputSchema.safeParse({ reason, revoke_credits: revoke });
            if (!parsed.success) {
              setError(t('reasonRequired'));
              return;
            }
            m.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">{t('refundReason')}</Label>
            <Textarea id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('refundReasonHint')} data-testid="refund-reason" />
          </div>
          <label className="flex items-start gap-2 text-sm" htmlFor="refund-revoke">
            <input id="refund-revoke" type="checkbox" className="mt-0.5 size-4" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} data-testid="refund-revoke" />
            <span>
              {t('revokeCredits')}
              <span className="block text-xs text-muted-foreground">{t('revokeCreditsHint')}</span>
            </span>
          </label>
          {error ? <p className="text-sm text-destructive" data-testid="refund-error">{error}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="destructive" disabled={m.isPending} data-testid="refund-confirm">
              {m.isPending ? <Spinner aria-hidden /> : null}
              {t('refundConfirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- Thanh toán

export function PaymentsTab() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [f, setF] = React.useState({ status: '', provider: '', order_id: '', user_id: '', from: '', to: '' });
  const query = { ...f, order_id: uuidOrEmpty(f.order_id), user_id: uuidOrEmpty(f.user_id), limit: 20 };
  const { q, rows } = useCursorList(adminKeys.list('payments', query), (cursor) => listAdminPayments({ ...query, cursor }));
  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onApply={setF}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: opts(PAYMENT_STATUSES) },
          { name: 'provider', label: t('provider'), type: 'select', options: opts(PAYMENT_PROVIDER_CODES) },
          { name: 'order_id', label: t('orderId'), placeholder: 'uuid' },
          { name: 'user_id', label: t('userId'), placeholder: 'uuid' },
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
        ]}
      />
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(p) => p.id}
        rowTestId="admin-payment-row"
        empty={t('empty')}
        columns={[
          { key: 'created', header: t('createdAt'), cell: (p) => <When iso={p.created_at} /> },
          { key: 'order', header: t('order'), cell: (p) => <ShortId id={p.order_id} /> },
          { key: 'provider', header: t('provider'), cell: (p) => p.provider },
          { key: 'txn', header: t('txn'), cell: (p) => <code className="font-mono text-xs">{p.provider_txn_id ?? '—'}</code> },
          { key: 'ref', header: t('merchantRef'), cell: (p) => <code className="font-mono text-xs break-all">{p.merchant_ref ?? '—'}</code> },
          { key: 'amount', header: t('total'), cell: (p) => formatVnd(p.amount, locale), className: 'text-right' },
          { key: 'status', header: t('status'), cell: (p) => <Badge variant={p.status === 'success' ? 'success' : p.status === 'failed' ? 'destructive' : 'muted'}>{p.status}</Badge> },
          { key: 'sig', header: t('signature'), cell: (p) => (p.signature_valid === null ? '—' : p.signature_valid ? '✓' : '✗') },
          { key: 'flags', header: t('flags'), cell: (p) => p.flags.join(', ') || '—' },
        ]}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------- Hoá đơn

export function InvoicesTab() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [f, setF] = React.useState({ status: '', order_id: '', user_id: '', from: '', to: '' });
  const query = { ...f, order_id: uuidOrEmpty(f.order_id), user_id: uuidOrEmpty(f.user_id), limit: 20 };
  const { q, rows } = useCursorList(adminKeys.list('invoices', query), (cursor) => listAdminInvoices({ ...query, cursor }));
  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onApply={setF}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: opts(INVOICE_STATUSES) },
          { name: 'order_id', label: t('orderId'), placeholder: 'uuid' },
          { name: 'user_id', label: t('userId'), placeholder: 'uuid' },
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
        ]}
      />
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(i) => i.id}
        rowTestId="admin-invoice-row"
        empty={t('empty')}
        columns={[
          { key: 'created', header: t('createdAt'), cell: (i) => <When iso={i.created_at} /> },
          { key: 'order', header: t('order'), cell: (i) => <ShortId id={i.order_id} /> },
          { key: 'orderStatus', header: t('orderStatus'), cell: (i) => <OrderStatusBadge status={i.order_status} /> },
          { key: 'total', header: t('total'), cell: (i) => formatVnd(i.total, locale), className: 'text-right' },
          { key: 'status', header: t('status'), cell: (i) => <Badge variant={i.status === 'issued' ? 'success' : i.status === 'failed' || i.status === 'error' ? 'destructive' : 'muted'}>{i.status}</Badge> },
          { key: 'number', header: t('invoiceNo'), cell: (i) => (i.invoice_no ? `${i.series ?? ''}-${i.invoice_no}` : '—') },
          { key: 'lookup', header: t('lookupCode'), cell: (i) => <code className="font-mono text-xs">{i.lookup_code ?? '—'}</code> },
          { key: 'attempts', header: t('attempts'), cell: (i) => i.attempts },
          { key: 'error', header: t('lastError'), cell: (i) => <span className="text-xs text-destructive">{i.last_error ?? ''}</span> },
        ]}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------- Subscription

export function SubscriptionsTab() {
  const t = useTranslations('admin');
  const loc = useLocalized();
  const [f, setF] = React.useState({ status: '', user_id: '', plan_code: '', program: '', expiring_within_days: '' });
  const query = { ...f, user_id: uuidOrEmpty(f.user_id), expiring_within_days: f.expiring_within_days ? Number(f.expiring_within_days) : undefined, limit: 20 };
  const { q, rows } = useCursorList(adminKeys.list('subscriptions', query), (cursor) => listAdminSubscriptions({ ...query, cursor }));
  return (
    <div className="space-y-4">
      <FilterBar
        value={f}
        onApply={setF}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: opts(SUBSCRIPTION_STATUSES) },
          { name: 'user_id', label: t('userId'), placeholder: 'uuid' },
          { name: 'plan_code', label: t('planCode'), placeholder: 'toeic_pro_monthly' },
          { name: 'program', label: t('program'), type: 'select', options: opts(['toeic', 'ielts', 'jlpt', 'hsk']) },
          { name: 'expiring_within_days', label: t('expiringWithin'), placeholder: '7' },
        ]}
      />
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(s) => s.id}
        rowTestId="admin-subscription-row"
        empty={t('empty')}
        columns={[
          { key: 'user', header: t('user'), cell: (s) => <ShortId id={s.user_id} /> },
          { key: 'plan', header: t('plan'), cell: (s) => loc(s.plan.name) },
          { key: 'status', header: t('status'), cell: (s) => <Badge variant={s.status === 'active' || s.status === 'lifetime' ? 'success' : s.status === 'trialing' ? 'gold' : 'muted'}>{s.cancel_at_period_end ? `${s.status} · ${t('cancelling')}` : s.status}</Badge> },
          { key: 'start', header: t('periodStart'), cell: (s) => <When iso={s.current_period_start} /> },
          { key: 'end', header: t('periodEnd'), cell: (s) => <When iso={s.current_period_end} /> },
          { key: 'days', header: t('daysLeft'), cell: (s) => s.days_left ?? '—' },
          { key: 'order', header: t('order'), cell: (s) => <ShortId id={s.source_order_id} /> },
        ]}
      />
    </div>
  );
}
