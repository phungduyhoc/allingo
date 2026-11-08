'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from '@allingo/schemas';
import { NativeSelect } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { copyText } from '@/lib/clipboard';
import { getErrorCode } from '@/lib/errors';
import { listAdminFeedback, patchAdminFeedback, s12Keys, type AdminFeedbackItem } from '@/lib/s12-api';
import { DataTable, FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';

type Status = (typeof FEEDBACK_STATUSES)[number];

/**
 * Góp ý in-app (`ops.feedback`): lọc trạng thái/loại; trace id (sao chép → tra Tempo/Loki), ảnh màn hình (URL ký 10 phút – mở tab
 * mới), trang, phiên bản; đổi trạng thái (new → triaged → done/wontfix, có thể đổi lại – audit `feedback.update` ở server).
 */
export function FeedbackAdmin() {
  const t = useTranslations('adminOps');
  const tf = useTranslations('feedback');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState({ status: 'new', category: '' });
  const key = s12Keys.admin('feedback', filter);
  const { q, rows } = useCursorList(key, (cursor) => listAdminFeedback({ ...filter, cursor }));
  const patch = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Status }) => patchAdminFeedback(id, status),
    onSuccess: () => {
      toast.success(t('saved'));
      void qc.invalidateQueries({ queryKey: ['admin', 's12', 'feedback'] });
    },
    onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
  });
  return (
    <div className="space-y-4">
      <FilterBar
        value={filter}
        onApply={setFilter}
        fields={[
          { name: 'status', label: t('status'), type: 'select', options: FEEDBACK_STATUSES.map((s) => ({ value: s, label: t(`feedback.status.${s}`) })) },
          { name: 'category', label: t('feedback.category'), type: 'select', options: FEEDBACK_CATEGORIES.map((c) => ({ value: c, label: tf(`categories.${c}`) })) },
        ]}
      />
      <DataTable<AdminFeedbackItem>
        list={{ q }}
        rows={rows}
        rowKey={(r) => r.id}
        rowTestId="feedback-row"
        rowAttrs={(r) => ({ 'data-id': r.id })}
        empty={t('empty')}
        columns={[
          { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
          { key: 'cat', header: t('feedback.category'), cell: (r) => ((FEEDBACK_CATEGORIES as readonly string[]).includes(r.category) ? tf(`categories.${r.category as 'bug'}`) : r.category) },
          {
            key: 'msg',
            header: t('feedback.message'),
            className: 'max-w-sm',
            cell: (r) => (
              <details>
                <summary className="cursor-pointer line-clamp-2 break-words">{r.message}</summary>
                <p className="mt-1 text-xs break-words whitespace-pre-wrap">{r.message}</p>
                <p className="mt-1 text-xs text-muted-foreground">{[r.context?.app_version, r.context?.locale, r.context?.user_agent].filter(Boolean).join(' · ')}</p>
              </details>
            ),
          },
          { key: 'page', header: t('feedback.page'), cell: (r) => <code className="font-mono text-xs break-all">{r.page_url ?? '—'}</code> },
          {
            key: 'trace',
            header: t('feedback.trace'),
            cell: (r) =>
              r.trace_id ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                  onClick={async () => toast[(await copyText(r.trace_id ?? '')) ? 'success' : 'error'](t('copied'))}
                  title={r.trace_id}
                  data-testid="feedback-trace"
                  data-trace={r.trace_id}
                >
                  <Copy className="size-3" aria-hidden />
                  {r.trace_id.slice(0, 10)}
                </button>
              ) : (
                '—'
              ),
          },
          {
            key: 'shot',
            header: t('feedback.screenshot'),
            cell: (r) =>
              r.screenshot?.url ? (
                <a href={r.screenshot.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" data-testid="feedback-screenshot">
                  <ImageIcon className="size-4" aria-hidden />
                  {t('feedback.open')}
                </a>
              ) : r.screenshot ? (
                <span className="text-xs text-muted-foreground">{t('feedback.processing')}</span>
              ) : (
                '—'
              ),
          },
          {
            key: 'user',
            header: t('user'),
            cell: (r) =>
              r.user_id ? (
                <Link href={`/admin/users?user=${r.user_id}`} className="font-mono text-xs text-primary hover:underline" title={r.user_id}>
                  {r.user_id.slice(0, 8)}
                </Link>
              ) : (
                <ShortId id={null} />
              ),
          },
          {
            key: 'status',
            header: t('status'),
            cell: (r) => (
              <NativeSelect
                value={r.status}
                onChange={(e) => patch.mutate({ id: r.id, status: e.target.value as Status })}
                className="h-8 w-32 text-xs"
                aria-label={t('feedback.setStatus')}
                disabled={patch.isPending}
                data-testid="feedback-status"
              >
                {FEEDBACK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`feedback.status.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            ),
          },
        ]}
      />
    </div>
  );
}
