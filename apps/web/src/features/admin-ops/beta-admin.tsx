'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, MailPlus, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { BETA_INVITE_STATUSES } from '@allingo/schemas/api/s12';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, Spinner, Tabs, TabsList, TabsTrigger, Textarea } from '@allingo/ui';
import { getErrorCode } from '@/lib/errors';
import { createInvites, getBetaReport, listInvites, listWaitlist, revokeInvite, s12Keys, sendInvitesNow, type AdminBetaInvite, type AdminWaitlistEntry } from '@/lib/s12-api';
import { Markdown } from '@/components/markdown';
import { CardSkeleton, ErrorState } from '@/components/states';
import { DataTable, FilterBar, useCursorList, When } from '@/features/admin/ui';
import { ConfirmDialog } from './confirm-dialog';
import { pct, StatTile, useSubTab } from './admin-ops-shell';

const TABS = ['waitlist', 'invites', 'report'] as const;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
const todayBatch = () => `dot-${new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')}`;

const INVITE_VARIANT: Record<string, 'gold' | 'secondary' | 'success' | 'muted' | 'destructive'> = { queued: 'muted', sent: 'secondary', redeemed: 'success', revoked: 'destructive', expired: 'muted', failed: 'destructive' };

/** Beta: danh sách chờ → chọn → xếp hàng mời theo đợt; lời mời (gửi ngay trong hạn mức/ngày, thu hồi); báo cáo KPI tuần */
export function BetaAdmin({ initialTab }: { initialTab: string | null }) {
  const t = useTranslations('adminOps');
  const [tab, go] = useSubTab(TABS, initialTab);
  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => go(v as (typeof TABS)[number])}>
        <TabsList aria-label={t('sections.beta.title')}>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`beta-tab-${k}`}>
              {t(`beta.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={t(`beta.tabs.${tab}`)}>
        {tab === 'waitlist' ? <WaitlistTab /> : tab === 'invites' ? <InvitesTab /> : <ReportTab />}
      </div>
    </div>
  );
}

function WaitlistTab() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ program: 'toeic', status: 'waiting' });
  const { q, rows } = useCursorList(s12Keys.admin('waitlist', filter), (cursor) => listWaitlist({ ...filter, cursor }));
  const counts = (q.data?.pages[0] as { counts?: Record<string, number> } | undefined)?.counts ?? {};
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [batch, setBatch] = React.useState(todayBatch);
  const [confirm, setConfirm] = React.useState(false);
  const create = useMutation({
    mutationFn: () => createInvites({ waitlist_entry_ids: [...selected], batch: batch.trim() || undefined, program: 'toeic' }),
    onSuccess: (r) => {
      toast.success(t('beta.queuedToast', { queued: r.queued, skipped: r.skipped, batch: r.batch }));
      setSelected(new Set());
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'waitlist'] });
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'invites'] });
    },
  });
  const selectable = rows.filter((r) => r.status === 'waiting');
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('beta.counts')}>
        {Object.entries(counts).map(([k, v]) => (
          <Badge key={k} variant="outline">
            {t(`beta.waitStatus.${k}`)}: {v}
          </Badge>
        ))}
      </div>
      <FilterBar
        value={filter}
        onApply={(f) => {
          setFilter(f);
          setSelected(new Set());
        }}
        fields={[
          { name: 'program', label: t('beta.program'), type: 'select', options: ['toeic', 'ielts', 'jlpt', 'hsk'].map((p) => ({ value: p, label: p.toUpperCase() })) },
          { name: 'status', label: t('status'), type: 'select', options: ['waiting', 'invited', 'joined', 'removed'].map((s) => ({ value: s, label: t(`beta.waitStatus.${s}`) })) },
        ]}
      />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/40 p-3">
        <Button variant="outline" size="sm" onClick={() => setSelected(new Set(selectable.map((r) => r.id)))} disabled={!selectable.length}>
          {t('beta.selectPage', { count: selectable.length })}
        </Button>
        <div className="space-y-1">
          <Label htmlFor="beta-batch" className="text-xs">
            {t('beta.batch')}
          </Label>
          <Input id="beta-batch" value={batch} onChange={(e) => setBatch(e.target.value.slice(0, 64))} className="h-9 w-44" data-testid="beta-batch" />
        </div>
        <Button variant="navy" size="sm" className="h-9" disabled={!selected.size} onClick={() => setConfirm(true)} data-testid="beta-queue-selected">
          <MailPlus aria-hidden />
          {t('beta.queueSelected', { count: selected.size })}
        </Button>
      </div>
      <DataTable<AdminWaitlistEntry>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.id}
        rowTestId="waitlist-row"
        empty={t('empty')}
        columns={[
          {
            key: 'sel',
            header: t('select'),
            cell: (r) => (
              <input type="checkbox" className="size-4" checked={selected.has(r.id)} disabled={r.status !== 'waiting'} onChange={() => toggle(r.id)} aria-label={t('beta.selectRow', { email: r.email_masked })} data-testid="waitlist-select" />
            ),
          },
          { key: 'email', header: t('email'), cell: (r) => <span className="font-mono text-xs">{r.email_masked}</span> },
          { key: 'program', header: t('beta.program'), cell: (r) => r.program.toUpperCase() },
          { key: 'locale', header: t('locale'), cell: (r) => r.locale },
          { key: 'source', header: t('beta.source'), cell: (r) => r.source ?? '—' },
          { key: 'consent', header: t('beta.marketing'), cell: (r) => (r.consent_marketing ? t('yes') : t('no')) },
          { key: 'status', header: t('status'), cell: (r) => <Badge variant="outline">{t(`beta.waitStatus.${r.status}`)}</Badge> },
          { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
        ]}
      />
      <EmailInvites />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('beta.confirmQueueTitle', { count: selected.size })}
        description={t('beta.confirmQueueDesc', { batch: batch.trim() || '—' })}
        confirmLabel={t('beta.queueSelected', { count: selected.size })}
        pending={create.isPending}
        error={create.isError ? te(`codes.${getErrorCode(create.error)}`) : null}
        onConfirm={() => create.mutate()}
        testId="beta-queue-confirm"
      />
    </div>
  );
}

function EmailInvites() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [text, setText] = React.useState('');
  const [batch, setBatch] = React.useState(todayBatch);
  const [confirm, setConfirm] = React.useState(false);
  const emails = React.useMemo(() => [...new Set(text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))], [text]);
  const invalid = emails.filter((e) => !EMAIL_RE.test(e));
  const create = useMutation({
    mutationFn: () => createInvites({ emails, batch: batch.trim() || undefined, program: 'toeic' }),
    onSuccess: (r) => {
      toast.success(t('beta.queuedToast', { queued: r.queued, skipped: r.skipped, batch: r.batch }));
      setText('');
      setConfirm(false);
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'invites'] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('beta.emailTitle')}</CardTitle>
        <CardDescription>{t('beta.emailDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label htmlFor="beta-emails" className="sr-only">
          {t('beta.emailTitle')}
        </Label>
        <Textarea id="beta-emails" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('beta.emailPlaceholder')} data-testid="beta-emails" />
        {invalid.length ? (
          <p role="alert" className="text-sm text-destructive">
            {t('beta.invalidEmails', { list: invalid.slice(0, 3).join(', ') })}
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="beta-email-batch" className="text-xs">
              {t('beta.batch')}
            </Label>
            <Input id="beta-email-batch" value={batch} onChange={(e) => setBatch(e.target.value.slice(0, 64))} className="h-9 w-44" />
          </div>
          <Button variant="navy" size="sm" className="h-9" disabled={!emails.length || invalid.length > 0 || emails.length > 500} onClick={() => setConfirm(true)} data-testid="beta-queue-emails">
            <MailPlus aria-hidden />
            {t('beta.queueEmails', { count: emails.length })}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('beta.confirmQueueTitle', { count: emails.length })}
        description={t('beta.confirmQueueDesc', { batch: batch.trim() || '—' })}
        confirmLabel={t('beta.queueEmails', { count: emails.length })}
        pending={create.isPending}
        error={create.isError ? te(`codes.${getErrorCode(create.error)}`) : null}
        onConfirm={() => create.mutate()}
        testId="beta-email-confirm"
      />
    </Card>
  );
}

function InvitesTab() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ status: '', batch: '' });
  const { q, rows } = useCursorList(s12Keys.admin('invites', filter), (cursor) => listInvites({ ...filter, cursor }));
  const first = q.data?.pages[0];
  const today = first?.today;
  // B6/S147: 'all' = mọi lời mời đang xếp hàng (hoặc chỉ đợt đang lọc); 'selected' = các lời mời đã chọn (theo thứ tự chọn)
  const [sendOpen, setSendOpen] = React.useState<'all' | 'selected' | null>(null);
  const [limit, setLimit] = React.useState('50');
  const [revoke, setRevoke] = React.useState<AdminBetaInvite | null>(null);
  const [lastResult, setLastResult] = React.useState<Record<string, unknown> | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const queuedRows = rows.filter((r) => r.status === 'queued');
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin', 's12', 'invites'] });
  const batchFilter = filter.batch.trim();
  const send = useMutation({
    mutationFn: (mode: 'all' | 'selected') => {
      const max = Math.max(1, Math.min(500, Number(limit) || 1));
      return mode === 'selected' ? sendInvitesNow({ limit: max, invite_ids: picked }) : sendInvitesNow({ limit: max, batch: batchFilter || undefined });
    },
    onSuccess: (r, mode) => {
      setLastResult(r.result ?? { mode: r.mode, job_id: r.job_id });
      toast.success(t('beta.sendDone', { mode: r.mode }));
      setSendOpen(null);
      if (mode === 'selected') setPicked([]);
      refresh();
    },
  });
  const rev = useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onSuccess: () => {
      toast.success(t('beta.revoked'));
      setRevoke(null);
      refresh();
    },
  });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label={t('beta.todaySent')} value={today?.sent ?? '—'} testId="beta-today-sent" />
        <StatTile label={t('beta.todayLimit')} value={today?.limit ?? '—'} />
        <StatTile label={t('beta.todayRemaining')} value={today?.remaining ?? '—'} tone={today && today.remaining === 0 ? 'warn' : 'default'} testId="beta-today-remaining" />
        <div className="flex flex-col justify-center gap-2 rounded-xl border border-border p-4">
          <Button variant="navy" size="sm" onClick={() => setSendOpen('all')} disabled={!today?.remaining} data-testid="beta-send-now">
            <Send aria-hidden />
            {batchFilter ? t('beta.sendBatch', { batch: batchFilter }) : t('beta.sendNow')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSendOpen('selected')} disabled={!today?.remaining || !picked.length} data-testid="beta-send-selected">
            <Send aria-hidden />
            {t('beta.sendSelected', { count: picked.length })}
          </Button>
          <p className="text-xs text-muted-foreground">{batchFilter ? t('beta.sendBatchHint', { batch: batchFilter }) : t('beta.sendHint')}</p>
        </div>
      </div>
      {lastResult ? (
        <pre className="max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs" data-testid="beta-send-result">
          {JSON.stringify(lastResult, null, 1)}
        </pre>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {Object.entries(first?.counts ?? {}).map(([k, v]) => (
          <Badge key={k} variant="outline">
            {t(`beta.inviteStatus.${k}`)}: {v}
          </Badge>
        ))}
      </div>
      <FilterBar
        value={filter}
        onApply={(f) => {
          setFilter(f);
          setPicked([]);
        }}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: BETA_INVITE_STATUSES.map((s) => ({ value: s, label: t(`beta.inviteStatus.${s}`) })) },
          { name: 'batch', label: t('beta.batch'), placeholder: 'dot-1' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => setPicked(queuedRows.map((r) => r.id))} disabled={!queuedRows.length} data-testid="invite-select-page">
          {t('beta.selectQueuedPage', { count: queuedRows.length })}
        </Button>
        {picked.length ? (
          <Button variant="ghost" size="sm" onClick={() => setPicked([])}>
            {t('beta.clearSelection')}
          </Button>
        ) : null}
      </div>
      <DataTable<AdminBetaInvite>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.id}
        rowTestId="invite-row"
        rowAttrs={(r) => ({ 'data-status': r.status })}
        empty={t('empty')}
        columns={[
          {
            key: 'sel',
            header: t('select'),
            cell: (r) => (
              <input type="checkbox" className="size-4" checked={picked.includes(r.id)} disabled={r.status !== 'queued'} onChange={() => togglePick(r.id)} aria-label={t('beta.selectRow', { email: r.email_masked })} data-testid="invite-select" />
            ),
          },
          { key: 'email', header: t('email'), cell: (r) => <span className="font-mono text-xs">{r.email_masked}</span> },
          { key: 'status', header: t('status'), cell: (r) => <Badge variant={INVITE_VARIANT[r.status] ?? 'outline'}>{t(`beta.inviteStatus.${r.status}`)}</Badge> },
          { key: 'batch', header: t('beta.batch'), cell: (r) => r.batch ?? '—' },
          { key: 'sent', header: t('beta.sentAt'), cell: (r) => <When iso={r.sent_at} /> },
          { key: 'exp', header: t('beta.expiresAt'), cell: (r) => <When iso={r.expires_at} /> },
          { key: 'red', header: t('beta.redeemedAt'), cell: (r) => <When iso={r.redeemed_at} /> },
          { key: 'att', header: t('beta.attempts'), cell: (r) => <span title={r.last_error ?? undefined}>{r.send_attempts}</span> },
          {
            key: 'act',
            header: t('actions'),
            cell: (r) =>
              r.status === 'queued' || r.status === 'sent' ? (
                <Button variant="ghost" size="sm" onClick={() => setRevoke(r)} data-testid="invite-revoke">
                  <Ban aria-hidden />
                  {t('beta.revoke')}
                </Button>
              ) : null,
          },
        ]}
      />
      <ConfirmDialog
        open={sendOpen !== null}
        onOpenChange={(o) => !o && setSendOpen(null)}
        title={sendOpen === 'selected' ? t('beta.confirmSendSelectedTitle', { count: picked.length }) : batchFilter ? t('beta.confirmSendBatchTitle', { batch: batchFilter }) : t('beta.confirmSendTitle')}
        description={t('beta.confirmSendDesc', { remaining: today?.remaining ?? 0 })}
        confirmLabel={sendOpen === 'selected' ? t('beta.sendSelected', { count: picked.length }) : t('beta.sendNow')}
        pending={send.isPending}
        error={send.isError ? te(`codes.${getErrorCode(send.error)}`) : null}
        onConfirm={() => sendOpen && send.mutate(sendOpen)}
        testId="beta-send-confirm"
      >
        <div className="space-y-1">
          <Label htmlFor="beta-send-limit">{t('beta.sendLimit')}</Label>
          <Input id="beta-send-limit" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(e.target.value)} className="h-9 w-28" />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={!!revoke}
        onOpenChange={(o) => !o && setRevoke(null)}
        destructive
        title={t('beta.confirmRevokeTitle')}
        description={t('beta.confirmRevokeDesc', { email: revoke?.email_masked ?? '' })}
        confirmLabel={t('beta.revoke')}
        pending={rev.isPending}
        error={rev.isError ? te(`codes.${getErrorCode(rev.error)}`) : null}
        onConfirm={() => revoke && rev.mutate(revoke.id)}
        testId="invite-revoke-confirm"
      />
    </div>
  );
}

type Kpis = {
  simulated?: boolean;
  cohort?: { testers?: number; invites_sent?: number; invites_redeemed?: number; waitlist?: number };
  activation?: { rate?: number | null };
  retention?: Record<'d1' | 'd7' | 'd14', { rate?: number | null; eligible?: number }>;
  engagement?: { sessions_per_active_tester?: number; questions_per_tester?: number; explains_per_tester?: number };
  ai?: { thumbs_up_rate?: number | null; cost_per_tester_usd?: number };
  nps?: { score?: number | null; responses?: number };
  conversion?: { checkout_rate?: number | null };
  support?: { tickets_overdue?: number; content_reports_overdue?: number; median_first_response_hours?: number | null };
  crash_free?: { rate?: number | null; source?: string };
};

function ReportTab() {
  const t = useTranslations('adminOps');
  const [week, setWeek] = React.useState('');
  const [applied, setApplied] = React.useState('');
  const report = useQuery({ queryKey: s12Keys.admin('beta-report', { week: applied }), queryFn: () => getBetaReport(applied || undefined) });
  const k = (report.data?.kpis ?? {}) as Kpis;
  const valid = !week || /^\d{4}-W\d{2}$/.test(week);
  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) setApplied(week);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="beta-week" className="text-xs">
            {t('beta.week')}
          </Label>
          <Input id="beta-week" value={week} onChange={(e) => setWeek(e.target.value.toUpperCase())} placeholder={t('beta.weekPlaceholder')} className="h-9 w-36" aria-invalid={!valid || undefined} />
        </div>
        <Button type="submit" variant="navy" size="sm" className="h-9" disabled={!valid}>
          {t('apply')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('beta.weekHint')}</p>
      </form>
      {report.isPending ? (
        <CardSkeleton lines={6} />
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : (
        <div className="space-y-4" data-testid="beta-report" data-week={report.data.week}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{report.data.week}</Badge>
            {k.simulated ? <Badge variant="gold">{t('beta.simulated')}</Badge> : null}
            {report.data.posthog ? null : <Badge variant="muted">{t('beta.noPosthog')}</Badge>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t('beta.kpi.testers')} value={k.cohort?.testers ?? '—'} hint={t('beta.kpi.invites', { sent: k.cohort?.invites_sent ?? 0, redeemed: k.cohort?.invites_redeemed ?? 0 })} />
            <StatTile label={t('beta.kpi.activation')} value={pct(k.activation?.rate)} tone={(k.activation?.rate ?? 0) >= 0.6 ? 'ok' : 'warn'} hint={t('beta.kpi.target', { target: '60%' })} />
            <StatTile label={t('beta.kpi.d7')} value={pct(k.retention?.d7?.rate)} tone={(k.retention?.d7?.rate ?? 0) >= 0.35 ? 'ok' : 'warn'} hint={t('beta.kpi.retention', { d1: pct(k.retention?.d1?.rate), d14: pct(k.retention?.d14?.rate) })} />
            <StatTile label={t('beta.kpi.nps')} value={k.nps?.score ?? '—'} tone={(k.nps?.score ?? -100) >= 30 ? 'ok' : 'warn'} hint={t('beta.kpi.responses', { count: k.nps?.responses ?? 0 })} />
            <StatTile label={t('beta.kpi.thumbs')} value={pct(k.ai?.thumbs_up_rate)} tone={(k.ai?.thumbs_up_rate ?? 0) >= 0.8 ? 'ok' : 'warn'} hint={t('beta.kpi.target', { target: '80%' })} />
            <StatTile label={t('beta.kpi.engagement')} value={k.engagement?.questions_per_tester ?? '—'} hint={t('beta.kpi.engagementHint', { sessions: k.engagement?.sessions_per_active_tester ?? 0, explains: k.engagement?.explains_per_tester ?? 0 })} />
            <StatTile label={t('beta.kpi.cost')} value={k.ai?.cost_per_tester_usd !== undefined ? `$${k.ai.cost_per_tester_usd.toFixed(3)}` : '—'} />
            <StatTile label={t('beta.kpi.crashFree')} value={pct(k.crash_free?.rate, 1)} hint={k.crash_free?.rate === null ? t('beta.kpi.notConnected') : undefined} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('beta.markdown')}</CardTitle>
            </CardHeader>
            <CardContent>
              {report.data.markdown ? <Markdown source={report.data.markdown} className="text-sm" /> : <Spinner />}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
