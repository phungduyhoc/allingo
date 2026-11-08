'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Headset, UserCheck } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { adminSupportReplySchema, SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, SUPPORT_STATUSES } from '@allingo/schemas/api/s12';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Label, NativeSelect, Spinner, Textarea } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import { getAdminTicket, listAdminTickets, patchAdminTicket, replyAdminTicket, s12Keys, type AdminReplyInput, type AdminSupportTicket } from '@/lib/s12-api';
import { TICKET_STATUS_VARIANT } from '@/lib/support';
import { CardSkeleton, ErrorState } from '@/components/states';
import { DataTable, FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';
import { SlaChip } from '@/features/support/support-page';
import { ConfirmDialog } from './confirm-dialog';
import { JsonBlock, useInitialParam } from './admin-ops-shell';

type Status = (typeof SUPPORT_STATUSES)[number];
type Priority = (typeof SUPPORT_PRIORITIES)[number];

/**
 * Ticket hỗ trợ (SLA phản hồi đầu 24 giờ): lọc trạng thái/ưu tiên/loại/quá hạn/từ khoá; chi tiết hội thoại + tóm tắt người dùng
 * (PII che), đổi trạng thái/ưu tiên/nhận xử lý, trả lời (in-app + email qua NotificationService – `support.reply`) kèm tuỳ chọn
 * cấp credit bù (ghi chú BẮT BUỘC, xác nhận trước khi gửi – ledger `admin_adjust` + audit `user.grant_credits` ở server).
 */
export function SupportAdmin() {
  const t = useTranslations('adminOps');
  const ts = useTranslations('support');
  const initial = useInitialParam('ticket');
  const [filter, setFilter] = React.useState({ status: '', priority: '', category: '', overdue: '', q: '' });
  const { q, rows } = useCursorList(s12Keys.admin('tickets', filter), (cursor) => listAdminTickets({ ...filter, overdue: filter.overdue === 'true' ? true : undefined, cursor }));
  const counts = (q.data?.pages[0] as { counts?: Record<string, number> } | undefined)?.counts ?? {};
  const [selected, setSelected] = React.useState<string | null>(initial);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(counts).map(([k, v]) => (
          <Badge key={k} variant="outline">
            {SUPPORT_STATUSES.includes(k as Status) ? ts(`status.${k as Status}`) : k}: {v}
          </Badge>
        ))}
      </div>
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: SUPPORT_STATUSES.map((s) => ({ value: s, label: ts(`status.${s}`) })) },
          { name: 'priority', label: t('support.priority'), type: 'select', options: SUPPORT_PRIORITIES.map((p) => ({ value: p, label: t(`support.priorities.${p}`) })) },
          { name: 'category', label: t('support.category'), type: 'select', options: SUPPORT_CATEGORIES.map((c) => ({ value: c, label: ts(`categories.${c}`) })) },
          { name: 'overdue', label: t('content.overdue'), type: 'select', options: [{ value: 'true', label: t('content.overdueOnly') }] },
          { name: 'q', label: t('support.search'), placeholder: t('support.searchPlaceholder') },
        ]}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="min-w-0">
          <DataTable<AdminSupportTicket>
            list={{ q }}
            rows={rows}
            rowKey={(r) => r.id}
            rowTestId="admin-ticket-row"
            rowAttrs={(r) => ({ 'data-id': r.id, 'data-status': r.status, ...(r.id === selected ? { 'aria-selected': 'true' } : {}) })}
            empty={t('empty')}
            columns={[
              {
                key: 'subj',
                header: t('support.subject'),
                className: 'max-w-[16rem]',
                cell: (r) => (
                  <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => setSelected(r.id)} data-testid="admin-ticket-open">
                    <span className="line-clamp-2 break-words">{r.subject}</span>
                  </button>
                ),
              },
              { key: 'user', header: t('user'), cell: (r) => <span className="text-xs">{r.user?.display_name ?? '—'}</span> },
              { key: 'status', header: t('status'), cell: (r) => <Badge variant={TICKET_STATUS_VARIANT[r.status]}>{ts(`status.${r.status}`)}</Badge> },
              { key: 'prio', header: t('support.priority'), cell: (r) => <span className={cn(r.priority === 'urgent' && 'font-bold text-destructive', r.priority === 'high' && 'font-semibold')}>{t(`support.priorities.${r.priority}`)}</span> },
              { key: 'sla', header: t('content.sla'), cell: (r) => <SlaChip ticket={r} admin /> },
              { key: 'at', header: t('support.lastMessage'), cell: (r) => <When iso={r.last_message_at ?? r.updated_at} /> },
            ]}
          />
        </div>
        <div className="min-w-0">{selected ? <TicketDetail key={selected} id={selected} onClose={() => setSelected(null)} /> : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('support.pick')}</p>}</div>
      </div>
    </div>
  );
}

function TicketDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('adminOps');
  const ts = useTranslations('support');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const qc = useQueryClient();
  const me = useMe();
  const ticket = useQuery({ queryKey: s12Keys.admin('ticket', { id }), queryFn: () => getAdminTicket(id) });
  const refresh = (data?: AdminSupportTicket) => {
    if (data) qc.setQueryData(s12Keys.admin('ticket', { id }), data);
    void qc.invalidateQueries({ queryKey: ['admin', 's12', 'tickets'] });
  };
  const patch = useMutation({
    mutationFn: (body: { status?: Status; priority?: Priority; assigned_to?: string | null }) => patchAdminTicket(id, body),
    onSuccess: (d) => {
      toast.success(t('saved'));
      refresh(d);
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });

  const [message, setMessage] = React.useState('');
  const [channels, setChannels] = React.useState<Array<'inapp' | 'email'>>(['inapp', 'email']);
  const [after, setAfter] = React.useState<Status>('waiting_user');
  const [withCredit, setWithCredit] = React.useState(false);
  const [delta, setDelta] = React.useState('');
  const [note, setNote] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [confirm, setConfirm] = React.useState<AdminReplyInput | null>(null);
  const reply = useMutation({
    mutationFn: (body: AdminReplyInput) => replyAdminTicket(id, body),
    onSuccess: (d) => {
      toast.success(d.credit ? t('support.repliedCredit', { delta: d.credit.delta }) : t('support.replied'));
      setMessage('');
      setWithCredit(false);
      setDelta('');
      setNote('');
      setConfirm(null);
      refresh(d);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body = { message: message.trim(), channels, status: after, ...(withCredit ? { credit: { delta: Number(delta), note: note.trim() } } : {}) };
    const parsed = adminSupportReplySchema.safeParse(body);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) {
        const k = i.path.join('.');
        errs[k] ??= k === 'message' ? t('support.errMessage') : k.startsWith('credit.delta') ? t('support.errDelta') : k.startsWith('credit.note') ? t('support.errNote') : k === 'channels' ? t('support.errChannels') : t('support.errForm');
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    // Có credit → xác nhận (khó đảo ngược); không → gửi ngay
    if (parsed.data.credit) setConfirm(parsed.data);
    else reply.mutate(parsed.data);
  };

  if (ticket.isPending) return <CardSkeleton lines={6} />;
  if (ticket.isError) return <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />;
  const d = ticket.data;
  return (
    <Card data-testid="admin-ticket-detail" data-status={d.status}>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base break-words">{d.subject}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant={TICKET_STATUS_VARIANT[d.status]}>{ts(`status.${d.status}`)}</Badge>
          <span>{ts(`categories.${d.category}`)}</span>
          <SlaChip ticket={d} admin />
          <ShortId id={d.id} />
        </div>
        {d.user ? (
          <p className="text-sm">
            <Link href={`/admin/users?user=${d.user.id}`} className="font-medium text-primary hover:underline" data-testid="admin-ticket-user">
              {d.user.display_name}
            </Link>{' '}
            <span className="font-mono text-xs text-muted-foreground">{d.user.email_masked ?? ''}</span> <Badge variant="outline">{d.user.status}</Badge>
          </p>
        ) : null}
        {Object.keys(d.context ?? {}).length ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">{t('support.context')}</summary>
            <JsonBlock value={d.context} />
          </details>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="tk-status" className="text-xs">
              {t('status')}
            </Label>
            <NativeSelect id="tk-status" value={d.status} onChange={(e) => patch.mutate({ status: e.target.value as Status })} className="h-8 w-40 text-xs" disabled={patch.isPending} data-testid="admin-ticket-status">
              {SUPPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ts(`status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tk-prio" className="text-xs">
              {t('support.priority')}
            </Label>
            <NativeSelect id="tk-prio" value={d.priority} onChange={(e) => patch.mutate({ priority: e.target.value as Priority })} className="h-8 w-32 text-xs" disabled={patch.isPending}>
              {SUPPORT_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t(`support.priorities.${p}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button variant="outline" size="sm" disabled={patch.isPending || d.assigned_to === me.data?.id} onClick={() => patch.mutate({ assigned_to: me.data?.id ?? null })}>
            <UserCheck aria-hidden />
            {d.assigned_to === me.data?.id ? t('support.assignedToMe') : t('support.assignMe')}
          </Button>
        </div>

        <ol className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label={ts('threadLabel')} data-testid="admin-ticket-thread">
          {(d.messages ?? []).map((m) => (
            <li key={m.id} className={cn('rounded-lg border px-3 py-2 text-sm', m.author === 'agent' ? 'border-navy/30 bg-secondary/30' : 'border-border')} data-author={m.author}>
              <p className="mb-0.5 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{ts(`author.${m.author}`)}</span> · {fmt.dateTime(new Date(m.created_at ?? 0), { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              <p className="break-words whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>

        {d.status === 'closed' ? (
          <p className="text-sm text-muted-foreground">{t('support.closedNoReply')}</p>
        ) : (
          <form className="space-y-3 border-t border-border pt-4" onSubmit={submit} noValidate data-testid="admin-reply-form">
            <div className="space-y-1.5">
              <Label htmlFor="tk-reply" className="flex items-center gap-1.5">
                <Headset className="size-4" aria-hidden />
                {t('support.reply')}
              </Label>
              <Textarea id="tk-reply" rows={4} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 8000))} aria-invalid={errors.message ? true : undefined} data-testid="admin-reply-message" />
              {errors.message ? <p className="text-xs text-destructive">{errors.message}</p> : null}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t('support.channels')}</span>
              {(['inapp', 'email'] as const).map((c) => (
                <label key={c} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" className="size-4" checked={channels.includes(c)} onChange={(e) => setChannels((xs) => (e.target.checked ? [...xs, c] : xs.filter((x) => x !== c)))} />
                  {t(`support.channel.${c}`)}
                </label>
              ))}
              {errors.channels ? <span className="text-xs text-destructive">{errors.channels}</span> : null}
              <label className="inline-flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">{t('support.after')}</span>
                <NativeSelect value={after} onChange={(e) => setAfter(e.target.value as Status)} className="h-8 w-40 text-xs" aria-label={t('support.after')}>
                  {SUPPORT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {ts(`status.${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={withCredit} onChange={(e) => setWithCredit(e.target.checked)} data-testid="admin-reply-credit-toggle" />
              <Coins className="size-4" aria-hidden />
              {t('support.grantCredit')}
            </label>
            {withCredit ? (
              <div className="grid gap-3 rounded-lg border border-accent/60 bg-accent/5 p-3 sm:grid-cols-[8rem_1fr]">
                <div className="space-y-1">
                  <Label htmlFor="tk-delta" className="text-xs">
                    {t('support.delta')}
                  </Label>
                  <Input id="tk-delta" type="number" min={1} max={100000} value={delta} onChange={(e) => setDelta(e.target.value)} className="h-9" aria-invalid={errors['credit.delta'] ? true : undefined} data-testid="admin-reply-delta" />
                  {errors['credit.delta'] ? <p className="text-xs text-destructive">{errors['credit.delta']}</p> : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tk-note" className="text-xs">
                    {t('support.note')}
                  </Label>
                  <Input id="tk-note" value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} placeholder={t('support.notePlaceholder')} className="h-9" aria-invalid={errors['credit.note'] ? true : undefined} data-testid="admin-reply-note" />
                  {errors['credit.note'] ? <p className="text-xs text-destructive">{errors['credit.note']}</p> : null}
                </div>
              </div>
            ) : null}
            {reply.isError && !confirm ? (
              <p role="alert" className="text-sm text-destructive">
                {te(`codes.${getErrorCode(reply.error)}`)}
              </p>
            ) : null}
            <Button type="submit" variant="navy" disabled={reply.isPending} data-testid="admin-reply-submit">
              {reply.isPending ? <Spinner aria-hidden /> : null}
              {t('support.send')}
            </Button>
          </form>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={t('support.confirmCreditTitle', { delta: confirm?.credit?.delta ?? 0 })}
        description={t('support.confirmCreditDesc', { name: d.user?.display_name ?? '—', note: confirm?.credit?.note ?? '' })}
        confirmLabel={t('support.send')}
        pending={reply.isPending}
        error={reply.isError ? te(`codes.${getErrorCode(reply.error)}`) : null}
        onConfirm={() => confirm && reply.mutate(confirm)}
        testId="admin-credit-confirm"
      />
    </Card>
  );
}
