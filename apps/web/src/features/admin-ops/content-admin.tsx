'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, PencilLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CONTENT_REPORT_REASONS, CONTENT_REPORT_STATUSES } from '@allingo/schemas/api/s12';
import { Badge, Button, cn, Label, NativeSelect, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { getErrorCode } from '@/lib/errors';
import { getQuestionStats, listContentReports, patchContentReport, recomputeQuestionStats, s12Keys, type ContentReportItem, type QuestionStats } from '@/lib/s12-api';
import { DataTable, FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';
import { isAdmin } from '@/features/admin/is-admin';
import { CardSkeleton } from '@/components/states';
import { useMe } from '@/lib/queries';
import { ConfirmDialog } from './confirm-dialog';
import { JsonBlock, pct, useSubTab } from './admin-ops-shell';

const TABS = ['queue', 'reports', 'stats', 'import', 'generate'] as const;
/** B2: editor/teacher (không phải admin) chỉ dùng công cụ sản xuất nội dung – báo lỗi/thống kê là endpoint admin */
const STAFF_TABS = ['queue', 'import', 'generate'] as const;
type Tab = (typeof TABS)[number];
const loadingTab = () => <CardSkeleton lines={6} />;
const ReviewQueue = dynamic(() => import('@/features/content-tools/review-queue').then((m) => m.ReviewQueue), { loading: loadingTab });
const ExcelImport = dynamic(() => import('@/features/content-tools/excel-import').then((m) => m.ExcelImport), { loading: loadingTab });
const DraftTest = dynamic(() => import('@/features/content-tools/draft-test').then((m) => m.DraftTest), { loading: loadingTab });
type ReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];
const REC_VARIANT: Record<string, 'destructive' | 'gold' | 'success' | 'muted'> = { retire: 'destructive', review: 'gold', ok: 'success', insufficient_data: 'muted' };

/**
 * Nội dung: hàng chờ duyệt (B2), báo lỗi câu (SLA 48 giờ – cùng dữ liệu CMS), thống kê câu (p-value, phân biệt, đề xuất retire/review),
 * nhập Excel và AI soạn nháp cả đề (B2). Editor/teacher chỉ thấy các tab công cụ sản xuất nội dung.
 */
export function ContentAdmin({ initialTab }: { initialTab: string | null }) {
  const t = useTranslations('adminOps');
  const me = useMe();
  const tabs: readonly Tab[] = isAdmin(me.data) ? TABS : STAFF_TABS;
  const [tab, go] = useSubTab(tabs, initialTab);
  const [testSetId, setTestSetId] = React.useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('test_set')));
  const openQueue = (id: string | null) => {
    setTestSetId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('test_set', id);
    else url.searchParams.delete('test_set');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    go('queue');
  };
  return (
    <div className="space-y-6">
      <Tabs value={tab} onValueChange={(v) => go(v as Tab)}>
        <TabsList aria-label={t('sections.content.title')} className="h-auto flex-wrap">
          {tabs.map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`content-tab-${k}`}>
              {t(`content.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={t(`content.tabs.${tab}`)}>
        {tab === 'queue' ? <ReviewQueue key={testSetId ?? 'all'} initialTestSetId={testSetId} /> : null}
        {tab === 'reports' ? <ReportsTab /> : null}
        {tab === 'stats' ? <StatsTab /> : null}
        {tab === 'import' ? <ExcelImport onOpenQueue={() => openQueue(null)} /> : null}
        {tab === 'generate' ? <DraftTest onOpenQueue={(id) => openQueue(id)} /> : null}
      </div>
    </div>
  );
}

function ReportsTab() {
  const t = useTranslations('adminOps');
  const tr = useTranslations('contentReport');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ status: 'open', overdue: '' });
  const { q, rows } = useCursorList(s12Keys.admin('content-reports', filter), (cursor) => listContentReports({ status: filter.status, overdue: filter.overdue === 'true' ? true : undefined, cursor }));
  const [edit, setEdit] = React.useState<ContentReportItem | null>(null);
  const [status, setStatus] = React.useState<ReportStatus>('fixed');
  const patch = useMutation({
    mutationFn: (note: string) => patchContentReport(edit!.id, { status, ...(note ? { resolution_note: note } : {}) }),
    onSuccess: () => {
      toast.success(t('content.resolved'));
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'content-reports'] });
    },
  });
  return (
    <div className="space-y-4">
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: CONTENT_REPORT_STATUSES.map((s) => ({ value: s, label: t(`content.status.${s}`) })) },
          { name: 'overdue', label: t('content.overdue'), type: 'select', options: [{ value: 'true', label: t('content.overdueOnly') }] },
        ]}
      />
      <DataTable<ContentReportItem>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.id}
        rowTestId="content-report-row"
        rowAttrs={(r) => ({ 'data-qv': r.question_version_id, 'data-status': r.status })}
        empty={t('empty')}
        columns={[
          { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
          {
            key: 'q',
            header: t('content.question'),
            className: 'max-w-xs',
            cell: (r) => (
              <span className="block">
                <span className="text-xs text-muted-foreground">
                  {r.section_code ?? '—'} · {r.external_ref ?? <ShortId id={r.question_id} />} · v{r.version_no ?? '?'}
                </span>
                <span className="line-clamp-2 block break-words">{r.stem_preview ?? '—'}</span>
              </span>
            ),
          },
          { key: 'reason', header: t('content.reason'), cell: (r) => ((CONTENT_REPORT_REASONS as readonly string[]).includes(r.reason) ? tr(`reasons.${r.reason as 'typo'}`) : r.reason) },
          { key: 'msg', header: t('content.message'), className: 'max-w-xs', cell: (r) => <span className="line-clamp-3 break-words">{r.message ?? '—'}</span> },
          { key: 'count', header: t('content.reportsForQuestion'), cell: (r) => <span className={cn('tabular', r.reports_for_question >= 3 && 'font-bold text-destructive')}>{r.reports_for_question}</span> },
          {
            key: 'sla',
            header: t('content.sla'),
            cell: (r) => (
              <span className={r.overdue ? 'font-medium text-destructive' : undefined}>
                <When iso={r.sla_due_at} />
                {r.overdue ? <Badge variant="destructive" className="ml-1">{t('content.overdueBadge')}</Badge> : null}
              </span>
            ),
          },
          { key: 'status', header: t('status'), cell: (r) => <Badge variant="outline">{t(`content.status.${r.status}`)}</Badge> },
          {
            key: 'act',
            header: t('actions'),
            cell: (r) => (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus(r.status === 'open' ? 'fixed' : r.status);
                  setEdit(r);
                }}
                data-testid="content-report-handle"
              >
                <PencilLine aria-hidden />
                {t('content.handle')}
              </Button>
            ),
          },
        ]}
      />
      <ConfirmDialog
        key={edit?.id ?? 'none'}
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={t('content.handleTitle')}
        description={t('content.handleDesc')}
        confirmLabel={t('save')}
        reason={{ label: t('content.note'), min: 3, optional: true, placeholder: t('content.notePlaceholder') }}
        pending={patch.isPending}
        error={patch.isError ? te(`codes.${getErrorCode(patch.error)}`) : null}
        onConfirm={(note) => patch.mutate(note)}
        testId="content-report-dialog"
      >
        <div className="space-y-1.5">
          <Label htmlFor="report-new-status">{t('status')}</Label>
          <NativeSelect id="report-new-status" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)} data-testid="content-report-status">
            {CONTENT_REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`content.status.${s}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
      </ConfirmDialog>
    </div>
  );
}

function StatsTab() {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ recommendation: '', section: '', sort: 'discrimination', min_n: '' });
  const { q, rows } = useCursorList(s12Keys.admin('question-stats', filter), (cursor) =>
    getQuestionStats({ program: 'toeic', recommendation: filter.recommendation, section: filter.section, sort: filter.sort, min_n: filter.min_n ? Number(filter.min_n) : undefined, cursor }),
  );
  const computedAt = (q.data?.pages[0] as { computed_at?: string | null } | undefined)?.computed_at ?? null;
  const [confirm, setConfirm] = React.useState(false);
  const [result, setResult] = React.useState<unknown>(null);
  const recompute = useMutation({
    mutationFn: recomputeQuestionStats,
    onSuccess: (r) => {
      setResult(r.result ?? r);
      setConfirm(false);
      toast.success(t('content.recomputed'));
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'question-stats'] });
    },
  });
  const reasonText = (code: string) => (t.has(`content.reasons.${code}`) ? t(`content.reasons.${code}`) : code);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" data-testid="stats-computed-at">
          {t('content.computedAt')} <When iso={computedAt} />
        </p>
        <Button variant="outline" size="sm" onClick={() => setConfirm(true)} data-testid="stats-recompute">
          <Calculator aria-hidden />
          {t('content.recompute')}
        </Button>
      </div>
      {result ? <JsonBlock value={result} /> : null}
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'recommendation', label: t('content.recommendation'), type: 'select', options: ['retire', 'review', 'ok', 'insufficient_data'].map((r) => ({ value: r, label: t(`content.rec.${r}`) })) },
          { name: 'section', label: t('content.section'), type: 'select', options: ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'].map((p) => ({ value: p, label: p.toUpperCase() })) },
          { name: 'sort', label: t('content.sort'), type: 'select', options: ['discrimination', 'p_value', 'reports', 'n', 'avg_time'].map((s) => ({ value: s, label: t(`content.sortBy.${s}`) })) },
          { name: 'min_n', label: t('content.minN'), placeholder: '20' },
        ]}
      />
      <DataTable<QuestionStats>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.question_id}
        rowTestId="question-stat-row"
        rowAttrs={(r) => ({ 'data-recommendation': r.recommendation })}
        empty={t('empty')}
        columns={[
          { key: 'q', header: t('content.question'), cell: (r) => (r.external_ref ? <code className="font-mono text-xs">{r.external_ref}</code> : <ShortId id={r.question_id} />) },
          { key: 'sec', header: t('content.section'), cell: (r) => r.section_code ?? '—' },
          { key: 'n', header: 'n', cell: (r) => <span className="tabular">{r.n}</span> },
          { key: 'p', header: t('content.pValue'), cell: (r) => <span className={cn('tabular', r.p_value !== null && (r.p_value < 0.2 || r.p_value > 0.95) && 'font-semibold text-accent-foreground dark:text-accent')}>{pct(r.p_value)}</span> },
          { key: 'd', header: t('content.discrimination'), cell: (r) => <span className={cn('tabular', r.discrimination !== null && r.discrimination < 0.2 && 'font-semibold text-destructive')}>{r.discrimination === null ? '—' : r.discrimination.toFixed(2)}</span> },
          { key: 't', header: t('content.avgTime'), cell: (r) => <span className="tabular">{r.avg_time_ms === null ? '—' : t('content.seconds', { s: Math.round(r.avg_time_ms / 1000) })}</span> },
          { key: 'r', header: t('content.reportsCol'), cell: (r) => <span className="tabular">{r.reports_open}/{r.reports_total}</span> },
          {
            key: 'rec',
            header: t('content.recommendation'),
            cell: (r) => (
              <span className="flex flex-col gap-1">
                <Badge variant={REC_VARIANT[r.recommendation] ?? 'outline'}>{t(`content.rec.${r.recommendation}`)}</Badge>
                {r.reasons.length ? <span className="text-xs text-muted-foreground">{r.reasons.map(reasonText).join(', ')}</span> : null}
              </span>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('content.recomputeTitle')}
        description={t('content.recomputeDesc')}
        confirmLabel={t('content.recompute')}
        pending={recompute.isPending}
        error={recompute.isError ? te(`codes.${getErrorCode(recompute.error)}`) : null}
        onConfirm={() => recompute.mutate()}
        testId="stats-recompute-confirm"
      />
    </div>
  );
}
