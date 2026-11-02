'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { DEAD_LETTER_JOBS, PAYMENT_PROVIDER_CODES, type PaymentProviderCode, type ReconciliationRun } from '@allingo/schemas';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Spinner, Switch, Textarea } from '@allingo/ui';
import { adminKeys, createReconciliation, downloadReconciliationCsv, listDeadLetters, listReconciliations, retryDeadLetter } from '@/lib/admin-api';
import { formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { ErrorState } from '@/components/states';
import { DataTable, ShortId, useCursorList, When } from './ui';

// ----------------------------------------------------------------------------- Dead-letter hoá đơn

export function DeadLettersTab() {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [job, setJob] = React.useState('');
  const [resolved, setResolved] = React.useState(false);
  const query = { job: job || undefined, include_resolved: resolved };
  const { q, rows } = useCursorList(adminKeys.list('dead-letters', query), (cursor) => listDeadLetters({ ...query, cursor }));
  const retry = useMutation({
    mutationFn: (id: string) => retryDeadLetter(id),
    onSuccess: () => {
      toast.success(t('retryQueued'));
      void qc.invalidateQueries({ queryKey: adminKeys.list('dead-letters', query) });
      void qc.invalidateQueries({ queryKey: adminKeys.list('invoices', {}) });
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="dl-job" className="text-xs">
            {t('job')}
          </Label>
          <NativeSelect id="dl-job" value={job} onChange={(e) => setJob(e.target.value)} className="h-9 w-44">
            <option value="">{t('any')}</option>
            {DEAD_LETTER_JOBS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-sm" htmlFor="dl-resolved">
          <Switch id="dl-resolved" checked={resolved} onCheckedChange={setResolved} aria-label={t('includeResolved')} />
          {t('includeResolved')}
        </label>
      </div>
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(d) => d.id}
        rowTestId="dead-letter-row"
        empty={t('deadLettersEmpty')}
        columns={[
          { key: 'failed', header: t('failedAt'), cell: (d) => <When iso={d.failed_at} /> },
          { key: 'job', header: t('job'), cell: (d) => <code className="font-mono text-xs">{d.job}</code> },
          { key: 'business', header: t('order'), cell: (d) => <ShortId id={d.business_id} /> },
          { key: 'attempts', header: t('attempts'), cell: (d) => d.attempts ?? '—' },
          { key: 'error', header: t('lastError'), cell: (d) => <span className="text-xs break-all text-destructive">{d.error ?? ''}</span> },
          { key: 'state', header: t('status'), cell: (d) => (d.resolved_at ? <Badge variant="success">{t('resolved')}</Badge> : d.retried_at ? <Badge variant="gold">{t('retried')}</Badge> : <Badge variant="destructive">{t('open')}</Badge>) },
          {
            key: 'actions',
            header: '',
            cell: (d) =>
              d.resolved_at ? null : (
                <Button variant="outline" size="sm" disabled={retry.isPending} onClick={() => retry.mutate(d.id)} data-testid="dead-letter-retry">
                  <RotateCcw aria-hidden />
                  {t('retry')}
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------- Đối soát

const yesterdayVn = () => new Date(Date.now() + 7 * 3_600_000 - 86_400_000).toISOString().slice(0, 10);

export function ReconciliationsTab() {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: adminKeys.list('reconciliations', {}), queryFn: () => listReconciliations() });
  const [provider, setProvider] = React.useState<string>('mock');
  const [forDate, setForDate] = React.useState(yesterdayVn);
  const [source, setSource] = React.useState<'csv' | 'query'>('csv');
  const [csv, setCsv] = React.useState('');
  const [selected, setSelected] = React.useState<ReconciliationRun | null>(null);
  const create = useMutation({
    mutationFn: () => createReconciliation({ provider: provider as PaymentProviderCode, for_date: forDate, source, ...(source === 'csv' ? { csv } : {}) }),
    onSuccess: (run) => {
      setSelected(run);
      toast.success(t('reconDone', { status: run.status, count: run.mismatch_count }));
      void qc.invalidateQueries({ queryKey: adminKeys.list('reconciliations', {}) });
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  const download = async (run: ReconciliationRun) => {
    try {
      const blob = await downloadReconciliationCsv(run.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reconciliation-${run.provider}-${run.for_date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      toast.error(t('downloadFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('reconCreate')}</CardTitle>
          <CardDescription>{t('reconCreateDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (source === 'csv' && !csv.trim()) {
                toast.error(t('csvRequired'));
                return;
              }
              create.mutate();
            }}
            data-testid="recon-form"
          >
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label htmlFor="recon-provider" className="text-xs">
                  {t('provider')}
                </Label>
                <NativeSelect id="recon-provider" value={provider} onChange={(e) => setProvider(e.target.value)} className="h-9 w-36">
                  {PAYMENT_PROVIDER_CODES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="recon-date" className="text-xs">
                  {t('forDate')}
                </Label>
                <Input id="recon-date" type="date" value={forDate} onChange={(e) => setForDate(e.target.value)} className="h-9 w-40" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="recon-source" className="text-xs">
                  {t('source')}
                </Label>
                <NativeSelect id="recon-source" value={source} onChange={(e) => setSource(e.target.value as 'csv' | 'query')} className="h-9 w-48">
                  <option value="csv">{t('sourceCsv')}</option>
                  <option value="query">{t('sourceQuery')}</option>
                </NativeSelect>
              </div>
            </div>
            {source === 'csv' ? (
              <div className="space-y-1.5">
                <Label htmlFor="recon-csv">{t('csv')}</Label>
                <Textarea id="recon-csv" value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} className="font-mono text-xs" placeholder="provider_txn_id,merchant_ref,amount,currency,status,paid_at" data-testid="recon-csv" />
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-primary">
                  <Upload className="size-4" aria-hidden />
                  {t('csvUpload')}
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      if (file.size > 5_000_000) {
                        toast.error(t('csvTooLarge'));
                        return;
                      }
                      void file.text().then(setCsv);
                    }}
                    data-testid="recon-file"
                  />
                </label>
                <p className="text-xs text-muted-foreground">{t('csvHint')}</p>
              </div>
            ) : null}
            <Button type="submit" variant="navy" disabled={create.isPending} data-testid="recon-submit">
              {create.isPending ? <Spinner aria-hidden /> : null}
              {t('reconRun')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {selected ? <RunDetail run={selected} onDownload={() => void download(selected)} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('reconRuns')}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.isPending ? (
            <Spinner />
          ) : runs.isError ? (
            <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
          ) : (
            <DataTable
              rows={runs.data}
              rowKey={(r) => r.id}
              rowTestId="recon-row"
              empty={t('empty')}
              columns={[
                { key: 'date', header: t('forDate'), cell: (r) => r.for_date },
                { key: 'provider', header: t('provider'), cell: (r) => r.provider },
                { key: 'source', header: t('source'), cell: (r) => r.source ?? 'query' },
                { key: 'status', header: t('status'), cell: (r) => <Badge variant={r.status === 'matched' ? 'success' : r.status === 'error' ? 'destructive' : 'gold'}>{r.status}</Badge> },
                { key: 'mismatch', header: t('mismatches'), cell: (r) => r.mismatch_count },
                { key: 'totals', header: t('totals'), cell: (r) => `${r.expected_total !== null ? formatVnd(r.expected_total, locale) : '—'} / ${r.actual_total !== null ? formatVnd(r.actual_total, locale) : '—'}` },
                { key: 'run', header: t('runAt'), cell: (r) => <When iso={r.run_at} /> },
                {
                  key: 'actions',
                  header: '',
                  cell: (r) => (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setSelected(r)}>
                        {t('view')}
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={t('downloadCsv')} onClick={() => void download(r)}>
                        <Download aria-hidden />
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunDetail({ run, onDownload }: { run: ReconciliationRun; onDownload: () => void }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  return (
    <Card data-testid="recon-detail" data-status={run.status} data-mismatches={run.mismatch_count}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            {t('runTitle', { provider: run.provider, date: run.for_date })} <Badge variant={run.status === 'matched' ? 'success' : 'gold'}>{run.status}</Badge>
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onDownload} data-testid="recon-download">
            <Download aria-hidden />
            {t('downloadCsv')}
          </Button>
        </div>
        <CardDescription>{t('runCounts', { system: run.system_count ?? 0, statement: run.statement_count ?? 0, matched: run.matched_count ?? 0 })}</CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          rows={run.mismatches}
          rowKey={(m) => `${m.type}-${m.provider_txn_id ?? ''}-${m.merchant_ref ?? ''}`}
          rowTestId="recon-mismatch"
          empty={t('noMismatch')}
          columns={[
            { key: 'type', header: t('mismatchType'), cell: (m) => <Badge variant="outline">{t(`mismatch.${m.type}`)}</Badge> },
            { key: 'txn', header: t('txn'), cell: (m) => <code className="font-mono text-xs">{m.provider_txn_id ?? '—'}</code> },
            { key: 'ref', header: t('merchantRef'), cell: (m) => <code className="font-mono text-xs break-all">{m.merchant_ref ?? '—'}</code> },
            { key: 'order', header: t('order'), cell: (m) => <ShortId id={m.order_id} /> },
            { key: 'sys', header: t('systemAmount'), cell: (m) => (m.system_amount !== null ? formatVnd(m.system_amount, locale) : '—') },
            { key: 'stm', header: t('statementAmount'), cell: (m) => (m.statement_amount !== null ? formatVnd(m.statement_amount, locale) : '—') },
            { key: 'st', header: t('status'), cell: (m) => `${m.system_status ?? '—'} / ${m.statement_status ?? '—'}` },
          ]}
        />
      </CardContent>
    </Card>
  );
}
