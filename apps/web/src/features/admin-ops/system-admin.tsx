'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Switch, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { FLAGS_QUERY_KEY } from '@/features/flags/flags-provider';
import { setFlag } from '@/lib/admin-api';
import { getErrorCode } from '@/lib/errors';
import { getSystemStatus, listAdminFlags, listDeadLettersAll, replayDeadLetterAll, s12Keys, type DeadLetterItem, type FeatureFlag } from '@/lib/s12-api';
import { CardSkeleton, ErrorState } from '@/components/states';
import { DataTable, FilterBar, useCursorList, When } from '@/features/admin/ui';
import { ConfirmDialog } from './confirm-dialog';
import { StatTile, useSubTab } from './admin-ops-shell';

const TABS = ['status', 'dead-letters', 'flags'] as const;

/** Hệ thống: trạng thái (hàng đợi BullMQ, Redis, DLQ, partition, SLA, outbox), dead-letter mọi hàng đợi + replay (xác nhận), cờ tính năng */
export function SystemAdmin({ initialTab }: { initialTab: string | null }) {
  const t = useTranslations('adminOps');
  const [tab, go] = useSubTab(TABS, initialTab);
  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => go(v as (typeof TABS)[number])}>
        <TabsList aria-label={t('sections.system.title')}>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`system-tab-${k}`}>
              {t(`system.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={t(`system.tabs.${tab}`)}>
        {tab === 'status' ? <StatusTab /> : tab === 'dead-letters' ? <DeadLettersAllTab /> : <FlagsTab />}
      </div>
    </div>
  );
}

export function StatusTab() {
  const t = useTranslations('adminOps');
  const status = useQuery({ queryKey: s12Keys.admin('system-status'), queryFn: getSystemStatus, refetchInterval: 30_000 });
  if (status.isPending) return <CardSkeleton lines={6} />;
  if (status.isError) return <ErrorState error={status.error} onRetry={() => void status.refetch()} />;
  const s = status.data;
  const missing = (s.partitions ?? []).filter((p) => (p.missing ?? []).length);
  return (
    <div className="space-y-6" data-testid="system-status">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t('system.redis')} value={s.redis_healthy ? t('system.healthy') : t('system.down')} tone={s.redis_healthy ? 'ok' : 'bad'} testId="system-redis" />
        <StatTile label={t('system.dlqUnreplayed')} value={s.dead_letters?.unreplayed ?? 0} tone={(s.dead_letters?.unreplayed ?? 0) > 0 ? 'warn' : 'ok'} hint={t('system.dlqHint', { total: s.dead_letters?.total ?? 0, day: s.dead_letters?.last_24h ?? 0 })} testId="system-dlq" />
        <StatTile label={t('system.slaOverdue')} value={(s.sla?.support_tickets_overdue ?? 0) + (s.sla?.content_reports_overdue ?? 0)} tone={(s.sla?.support_tickets_overdue ?? 0) + (s.sla?.content_reports_overdue ?? 0) > 0 ? 'warn' : 'ok'} hint={t('system.slaHint', { tickets: s.sla?.support_tickets_overdue ?? 0, reports: s.sla?.content_reports_overdue ?? 0 })} />
        <StatTile label={t('system.outbox')} value={s.outbox?.unpublished ?? 0} hint={s.outbox?.oldest_unpublished_sec ? t('system.outboxHint', { sec: Math.round(s.outbox.oldest_unpublished_sec) }) : undefined} tone={(s.outbox?.unpublished ?? 0) > 100 ? 'warn' : 'default'} />
      </div>
      {missing.length ? (
        <Alert variant="destructive">
          <AlertDescription>{t('system.partitionsMissing', { list: missing.map((p) => `${p.table}: ${(p.missing ?? []).join(', ')}`).join('; ') })}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('system.queues')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={s.queues ?? []}
            rowKey={(q) => q.queue ?? ''}
            rowTestId="queue-row"
            empty={t('empty')}
            columns={[
              { key: 'q', header: t('system.queue'), cell: (q) => <code className="font-mono text-xs">{q.queue}</code> },
              { key: 'w', header: t('system.waiting'), cell: (q) => <span className="tabular">{q.waiting}</span> },
              { key: 'a', header: t('system.active'), cell: (q) => <span className="tabular">{q.active}</span> },
              { key: 'd', header: t('system.delayed'), cell: (q) => <span className="tabular">{q.delayed}</span> },
              { key: 'f', header: t('system.failed'), cell: (q) => <span className={(q.failed ?? 0) > 0 ? 'font-semibold text-destructive tabular' : 'tabular'}>{q.failed}</span> },
              { key: 'o', header: t('system.oldest'), cell: (q) => <span className="tabular">{t('content.seconds', { s: Math.round(q.oldest_waiting_sec ?? 0) })}</span> },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('system.partitions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {(s.partitions ?? []).map((p) => (
              <li key={p.table} className="flex justify-between gap-2 rounded-md bg-muted px-3 py-1.5">
                <code className="font-mono text-xs">{p.table}</code>
                <span className="text-xs">{t('system.monthsAhead', { n: p.months_ahead ?? 0 })}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function DeadLettersAllTab() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ queue: '', job: '', replayed: 'false' });
  const { q, rows } = useCursorList(s12Keys.admin('dead-letters', filter), (cursor) => listDeadLettersAll({ queue: filter.queue, job: filter.job, replayed: filter.replayed === '' ? undefined : filter.replayed === 'true', cursor }));
  const [target, setTarget] = React.useState<DeadLetterItem | null>(null);
  const replay = useMutation({
    mutationFn: (id: string) => replayDeadLetterAll(id),
    onSuccess: (r) => {
      setTarget(null);
      if (r.error) toast.error(t('system.replayFailed', { error: r.error.slice(0, 120) }));
      else toast.success(t('system.replayed', { mode: r.mode ?? '' }));
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'dead-letters'] });
      void qc.invalidateQueries({ queryKey: s12Keys.admin('system-status') });
    },
  });
  const errMsg = replay.isError ? (getErrorCode(replay.error) === 'conflict' ? t('system.noHandler') : te(`codes.${getErrorCode(replay.error)}`)) : null;
  return (
    <div className="space-y-4">
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'queue', label: t('system.queue'), type: 'select', options: ['grading', 'content', 'media', 'notify', 'analytics', 'maintenance', 'billing'].map((x) => ({ value: x, label: x })) },
          { name: 'job', label: t('system.job'), placeholder: 'beta.invites_send' },
          { name: 'replayed', label: t('system.replayedFilter'), type: 'select', options: [{ value: 'false', label: t('system.notReplayed') }, { value: 'true', label: t('system.replayedOnly') }] },
        ]}
      />
      <DataTable<DeadLetterItem>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.id}
        rowTestId="dlq-row"
        rowAttrs={(r) => ({ 'data-id': r.id })}
        empty={t('system.dlqEmpty')}
        columns={[
          { key: 'at', header: t('system.failedAt'), cell: (r) => <When iso={r.failed_at} /> },
          { key: 'q', header: t('system.queue'), cell: (r) => <code className="font-mono text-xs">{r.queue}</code> },
          { key: 'job', header: t('system.job'), cell: (r) => <code className="font-mono text-xs">{r.job ?? '—'}</code> },
          { key: 'err', header: t('system.error'), className: 'max-w-xs', cell: (r) => <span className="line-clamp-2 text-xs break-words">{r.error ?? '—'}</span> },
          { key: 'n', header: t('system.attempts'), cell: (r) => <span className="tabular">{r.attempts ?? '—'}</span> },
          { key: 'rc', header: t('system.replays'), cell: (r) => <span className="tabular">{r.replay_count}{r.replayed_at ? ' ✓' : ''}</span> },
          {
            key: 'act',
            header: t('actions'),
            cell: (r) => (
              <Button variant="outline" size="sm" onClick={() => setTarget(r)} data-testid="dlq-replay">
                <RotateCcw aria-hidden />
                {t('system.replay')}
              </Button>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title={t('system.confirmReplayTitle')}
        description={t('system.confirmReplayDesc', { job: target?.job ?? target?.queue ?? '', id: target?.job_id ?? '' })}
        confirmLabel={t('system.replay')}
        pending={replay.isPending}
        error={errMsg}
        onConfirm={() => target && replay.mutate(target.id)}
        testId="dlq-replay-confirm"
      />
    </div>
  );
}

function FlagsTab() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const flags = useQuery({ queryKey: s12Keys.admin('flags'), queryFn: listAdminFlags });
  const [target, setTarget] = React.useState<FeatureFlag | null>(null);
  const save = useMutation({
    mutationFn: (f: FeatureFlag) => setFlag(f.key, { enabled: !f.enabled }),
    onSuccess: () => {
      setTarget(null);
      toast.success(t('saved'));
      void qc.invalidateQueries({ queryKey: s12Keys.admin('flags') });
      void qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
    },
  });
  if (flags.isPending) return <CardSkeleton lines={6} />;
  if (flags.isError) return <ErrorState error={flags.error} onRetry={() => void flags.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('system.flagsDesc')}</p>
      <ul className="divide-y divide-border rounded-xl border border-border" data-testid="flags-list">
        {flags.data.map((f) => (
          <li key={f.key} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="flag-row" data-key={f.key} data-enabled={f.enabled}>
            <span className="min-w-0 flex-1">
              <code className="font-mono text-sm font-semibold">{f.key}</code>
              <span className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                {f.public ? <Badge variant="outline">{t('system.public')}</Badge> : <Badge variant="muted">{t('system.internal')}</Badge>}
                {f.rules && Object.keys(f.rules).length ? <span>{t('system.hasRules')}</span> : null}
                <span>
                  {t('system.updated')} <When iso={f.updated_at} />
                </span>
              </span>
            </span>
            <Switch checked={f.enabled} onCheckedChange={() => setTarget(f)} aria-label={t('system.toggleFlag', { key: f.key })} data-testid={`flag-switch-${f.key}`} />
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        destructive={!!target?.enabled}
        title={target ? t(target.enabled ? 'system.confirmOffTitle' : 'system.confirmOnTitle', { key: target.key }) : ''}
        description={t('system.confirmFlagDesc')}
        confirmLabel={target?.enabled ? t('system.turnOff') : t('system.turnOn')}
        pending={save.isPending}
        error={save.isError ? te(`codes.${getErrorCode(save.error)}`) : null}
        onConfirm={() => target && save.mutate(target)}
        testId="flag-confirm"
      />
    </div>
  );
}
