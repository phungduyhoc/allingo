'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, ListChecks, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { IMPORT_MAX_BYTES } from '@allingo/schemas/content/import-sheet';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Label, Spinner } from '@allingo/ui';
import { getErrorStatus } from '@/lib/errors';
import { contentToolsKeys, downloadImportTemplate, fileToBase64, getImportJob, startImport, type ContentImportIssue, type ContentImportReport } from '@/lib/content-tools-api';
import { StatTile } from '@/features/admin-ops/admin-ops-shell';

const POLL_MS = 1000;

/** Theo dõi job (polling tới khi completed/failed) – dùng chung nhập Excel / AI soạn đề */
export function useJobPoll<T extends { status: string }>(key: readonly unknown[], jobId: string | null, fetcher: (id: string) => Promise<T>) {
  return useQuery({
    queryKey: [...key, jobId],
    queryFn: () => fetcher(jobId!),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'completed' || q.state.data.status === 'failed') ? false : POLL_MS),
  });
}

function useIssueText() {
  const t = useTranslations('contentTools.importIssues');
  return (i: ContentImportIssue) => (t.has(i.code) ? t(i.code, Object.fromEntries(Object.entries(i.params ?? {}).map(([k, v]) => [k, typeof v === 'number' && k === 'similarity' ? `${Math.round(v * 100)}%` : String(v)]))) : i.code);
}

/**
 * B2 – nhập câu hỏi từ Excel: tải mẫu → chọn tệp → "Kiểm tra" (dry-run: lỗi theo dòng/cột, trùng trong tệp, nghi trùng ngân hàng) →
 * "Xác nhận nhập" gửi lại CÙNG tệp + fingerprint của lần kiểm tra (đổi tệp → kiểm tra lại). Job chạy nền, theo dõi bằng polling.
 */
export function ExcelImport({ onOpenQueue }: { onOpenQueue?: () => void }) {
  const t = useTranslations('contentTools.import');
  const ts = useTranslations('contentTools.import.summary');
  const tp = useTranslations('contentTools.preview');
  const issueText = useIssueText();
  const [file, setFile] = React.useState<File | null>(null);
  const [skipDup, setSkipDup] = React.useState(false);
  const [dryJob, setDryJob] = React.useState<string | null>(null);
  const [commitJob, setCommitJob] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const inputId = React.useId();
  const dry = useJobPoll(contentToolsKeys.importJob('dry'), dryJob, getImportJob);
  const commit = useJobPoll(contentToolsKeys.importJob('commit'), commitJob, getImportJob);
  const dryReport = dry.data?.status === 'completed' ? dry.data.report : null;
  const commitReport = commit.data?.status === 'completed' ? commit.data.report : null;
  const announced = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (dryReport && announced.current !== `dry-${dryJob}`) {
      announced.current = `dry-${dryJob}`;
      toast.info(t('dryRunDone', { valid: dryReport.valid, errors: dryReport.error_rows }));
    }
    if (commitReport && announced.current !== `commit-${commitJob}`) {
      announced.current = `commit-${commitJob}`;
      toast.success(t('committed', { created: commitReport.created }));
    }
  }, [dryReport, commitReport, dryJob, commitJob, t]);

  const send = useMutation({
    mutationFn: async (dryRun: boolean) => {
      if (!file) throw new Error(t('chooseFile'));
      if (file.size > IMPORT_MAX_BYTES) throw new Error(t('tooLarge'));
      const base64 = await fileToBase64(file);
      return startImport({ file_name: file.name, file_base64: base64, dry_run: dryRun, skip_bank_duplicates: skipDup, ...(dryRun ? {} : { confirm_fingerprint: dryReport?.fingerprint ?? '' }) });
    },
    onMutate: () => setError(null),
    onSuccess: (r, dryRun) => {
      if (dryRun) {
        setCommitJob(null);
        setDryJob(r.job_id);
      } else setCommitJob(r.job_id);
    },
    onError: (err) => {
      if (getErrorStatus(err) === 409) setError(t('fingerprintMismatch'));
      else setError(t('fileError', { message: err instanceof Error ? err.message : String(err) }));
    },
  });

  const download = async () => {
    try {
      const blob = await downloadImportTemplate();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'allingo-mau-nhap-cau-hoi.xlsx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(t('templateDone'));
    } catch (err) {
      toast.error(t('fileError', { message: (err as Error).message }));
    }
  };

  const reset = (f: File | null) => {
    setFile(f);
    setDryJob(null);
    setCommitJob(null);
    setError(null);
  };
  const running = send.isPending || (!!dryJob && !dryReport && dry.data?.status !== 'failed') || (!!commitJob && !commitReport && commit.data?.status !== 'failed');
  const report: ContentImportReport | null = commitReport ?? dryReport;
  const fileBlocked = !!dryReport?.issues.some((i) => i.code === 'missing_column');

  return (
    <div className="space-y-4" data-testid="excel-import">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={() => void download()} data-testid="import-template">
            <Download aria-hidden />
            {t('template')}
          </Button>
          <div className="space-y-1.5">
            <Label htmlFor={inputId}>{t('file')}</Label>
            <Input id={inputId} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => reset(e.target.files?.[0] ?? null)} data-testid="import-file" className="h-auto py-1.5" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} data-testid="import-skip-dup" />
            <span>{t('skipDup')}</span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={!file || running} onClick={() => send.mutate(true)} data-testid="import-check">
              {running && !commitJob ? <Spinner aria-hidden /> : <ListChecks aria-hidden />}
              {running && !commitJob ? t('checking') : t('check')}
            </Button>
            {dryReport && !commitReport ? (
              <Button disabled={running || dryReport.valid === 0 || fileBlocked} onClick={() => send.mutate(false)} data-testid="import-confirm">
                {running && commitJob ? <Spinner aria-hidden /> : <Upload aria-hidden />}
                {running && commitJob ? t('writing') : t('confirm', { count: dryReport.valid })}
              </Button>
            ) : null}
            {commitReport ? (
              <Button variant="outline" onClick={() => reset(null)} data-testid="import-reset">
                {t('reset')}
              </Button>
            ) : null}
          </div>
          {error ? (
            <Alert variant="destructive" data-testid="import-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {dry.data?.status === 'failed' || commit.data?.status === 'failed' ? (
            <Alert variant="destructive" data-testid="import-job-failed">
              <AlertDescription>{t('fileError', { message: (commit.data?.error ?? dry.data?.error) || '' })}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {report ? (
        <section className="space-y-3" data-testid="import-report" data-dry-run={report.dry_run} data-valid={report.valid} data-created={report.created}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label={ts('total')} value={report.total_rows} testId="import-total" />
            <StatTile label={ts('valid')} value={report.valid} tone="ok" testId="import-valid" />
            <StatTile label={ts('errors')} value={report.error_rows} tone={report.error_rows ? 'bad' : 'default'} testId="import-errors" />
            <StatTile label={ts('warnings')} value={report.warning_rows} tone={report.warning_rows ? 'warn' : 'default'} testId="import-warnings" />
            <StatTile label={ts('examples')} value={report.examples_skipped} />
            <StatTile label={report.dry_run ? ts('skipped') : ts('created')} value={report.dry_run ? report.skipped : report.created} tone={report.dry_run ? 'default' : 'ok'} testId="import-created" />
          </div>
          {commitReport ? (
            <Alert data-testid="import-committed">
              <CheckCircle2 aria-hidden />
              <AlertDescription className="flex flex-wrap items-center gap-3">
                {t('committed', { created: commitReport.created })}
                {onOpenQueue ? (
                  <Button size="sm" variant="outline" onClick={onOpenQueue} data-testid="import-open-queue">
                    {t('openQueue')}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <h3 className="text-sm font-semibold">{t('issuesTitle')}</h3>
          {report.issues.length ? (
            <div className="overflow-x-auto rounded-xl border border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" tabIndex={0} role="region" aria-label={t('issuesTitle')}>
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t('row')}</th>
                    <th scope="col" className="px-3 py-2">{t('column')}</th>
                    <th scope="col" className="px-3 py-2">{t('level')}</th>
                    <th scope="col" className="px-3 py-2">{t('message')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.issues.map((i, k) => (
                    <tr key={`${i.row}-${i.column}-${i.code}-${k}`} className="border-t border-border" data-testid="import-issue" data-row={i.row} data-column={i.column ?? ''} data-code={i.code} data-level={i.level}>
                      <td className="tabular px-3 py-2">{i.row}</td>
                      <td className="px-3 py-2 font-mono text-xs">{i.column ?? '—'}</td>
                      <td className="px-3 py-2">
                        <Badge variant={i.level === 'error' ? 'destructive' : 'gold'}>{tp(`level.${i.level}`)}</Badge>
                      </td>
                      <td className={cn('px-3 py-2', i.level === 'error' && 'text-destructive')}>{issueText(i)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noIssues')}</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
