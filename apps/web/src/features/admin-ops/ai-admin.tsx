'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@allingo/ui';
import { getAiQuality, getAiRefusals, s12Keys, type AiQualityRow, type RefusalItem } from '@/lib/s12-api';
import { CardSkeleton, ErrorState } from '@/components/states';
import { DataTable, FilterBar, useCursorList, When } from '@/features/admin/ui';
import { JsonBlock, pct } from './admin-ops-shell';

/**
 * AI: chất lượng theo phiên bản prompt (số tác vụ, thành công/từ chối/lỗi, 👍/👎 = helpful vs not_helpful|wrong, tỉ lệ, chi phí) và
 * mẫu bị guardrail từ chối (lý do, task, input_ref – KHÔNG có nội dung người học).
 */
export function AiAdmin() {
  const t = useTranslations('adminOps');
  const [filter, setFilter] = React.useState({ from: '', to: '', task_code: '' });
  const quality = useQuery({ queryKey: s12Keys.admin('ai-quality', filter), queryFn: () => getAiQuality(filter) });
  const refusals = useCursorList(s12Keys.admin('ai-refusals', { from: filter.from, to: filter.to }), (cursor) => getAiRefusals({ from: filter.from, to: filter.to, cursor }));
  const byReason = (refusals.q.data?.pages[0] as { by_reason?: Record<string, number> } | undefined)?.by_reason ?? {};
  return (
    <div className="space-y-6">
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
          { name: 'task_code', label: t('ai.task'), placeholder: 'explain_mcq' },
        ]}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ai.qualityTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {quality.isPending ? (
            <CardSkeleton lines={4} className="border-0 p-0" />
          ) : quality.isError ? (
            <ErrorState error={quality.error} onRetry={() => void quality.refetch()} />
          ) : (
            <DataTable<AiQualityRow>
              rows={quality.data.data}
              rowKey={(r) => `${r.task_code}-${r.prompt_version_id ?? 'none'}`}
              rowTestId="ai-quality-row"
              empty={t('empty')}
              columns={[
                { key: 'task', header: t('ai.task'), cell: (r) => <code className="font-mono text-xs">{r.task_code}</code> },
                { key: 'ver', header: t('ai.version'), cell: (r) => (r.prompt_version_no ? `v${r.prompt_version_no}` : '—') },
                { key: 'st', header: t('status'), cell: (r) => (r.prompt_status ? <Badge variant={r.prompt_status === 'active' ? 'success' : 'outline'}>{r.prompt_status}</Badge> : '—') },
                { key: 'n', header: t('ai.tasks'), cell: (r) => <span className="tabular">{r.tasks}</span> },
                { key: 'res', header: t('ai.outcome'), cell: (r) => <span className="tabular text-xs">{t('ai.outcomeLine', { ok: r.succeeded, refused: r.refused, failed: r.failed })}</span> },
                { key: 'fb', header: t('ai.feedback'), cell: (r) => <span className="tabular">👍 {r.thumbs_up} · 👎 {r.thumbs_down}</span> },
                {
                  key: 'ratio',
                  header: t('ai.ratio'),
                  cell: (r) => (
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className={cn('block h-full', (r.thumbs_up_ratio ?? 0) >= 0.8 ? 'bg-success' : 'bg-accent')} style={{ width: `${Math.round((r.thumbs_up_ratio ?? 0) * 100)}%` }} />
                      </span>
                      <span className={cn('tabular', r.thumbs_up_ratio !== null && r.thumbs_up_ratio < 0.8 && 'font-semibold')}>{pct(r.thumbs_up_ratio)}</span>
                    </span>
                  ),
                },
                { key: 'cost', header: t('ai.cost'), cell: (r) => <span className="tabular">${r.cost_usd.toFixed(4)}</span> },
              ]}
            />
          )}
          <p className="mt-2 text-xs text-muted-foreground">{t('ai.targetNote')}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('ai.refusalsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(byReason).map(([k, v]) => (
              <Badge key={k} variant="outline">
                {k}: {v}
              </Badge>
            ))}
          </div>
          <DataTable<RefusalItem>
            list={refusals}
            rows={refusals.rows}
            rowKey={(r) => r.id}
            rowTestId="ai-refusal-row"
            empty={t('empty')}
            columns={[
              { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
              { key: 'task', header: t('ai.task'), cell: (r) => <code className="font-mono text-xs">{r.task_code ?? '—'}</code> },
              { key: 'reason', header: t('ai.reason'), cell: (r) => r.reason ?? r.error_code ?? '—' },
              { key: 'ref', header: t('ai.inputRef'), cell: (r) => <JsonBlock value={r.input_ref} className="max-h-20" /> },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
