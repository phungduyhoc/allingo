'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Send, Undo2, UserCheck, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { ReviewBulkAction } from '@allingo/schemas/api/content-tools';
import { Alert, AlertDescription, AlertTitle, Badge, Button, cn, Label, NativeSelect, Spinner } from '@allingo/ui';
import { useMe } from '@/lib/queries';
import { isReviewer } from '@/features/admin/is-admin';
import { FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';
import { ConfirmDialog } from '@/features/admin-ops/confirm-dialog';
import { ErrorState } from '@/components/states';
import { assignReviewer, bulkReview, contentToolsKeys, duplicateCheck, getReviewQueue, listReviewers, type ReviewBulkResult, type ReviewQueueItem } from '@/lib/content-tools-api';
import { pctOf, QuestionPreview } from './question-preview';

const PARTS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;
const QUEUE_STATUSES = ['draft', 'ai_checked', 'review1', 'review2'] as const;
type Filter = { program: string; section: string; status: string; source: string; duplicate: string; created_by: string; assignee: string; from: string; to: string; q: string; sort: string; order: string };
const EMPTY: Filter = { program: 'toeic', section: '', status: '', source: '', duplicate: '', created_by: '', assignee: '', from: '', to: '', q: '', sort: 'created_at', order: 'desc' };

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

/**
 * B2 – hàng chờ duyệt: bộ lọc (chương trình, Part, trạng thái, nguồn, cờ trùng, người tạo, reviewer, ngày, từ khoá) + sắp xếp;
 * danh sách chọn nhiều → duyệt/từ chối/yêu cầu sửa/gửi duyệt hàng loạt (lý do bắt buộc khi từ chối/yêu cầu sửa), phân công reviewer;
 * khung xem trước câu đang chọn (nội dung, passage + tab văn bản, AI check, kiểm tra tự động, cờ trùng + câu tương tự).
 * Phím tắt J/K (câu sau/trước), A (duyệt), R (từ chối), X (chọn) – không chạy khi đang gõ hoặc khi hộp thoại mở.
 */
export function ReviewQueue({ initialTestSetId }: { initialTestSetId?: string | null }) {
  const t = useTranslations('contentTools');
  const tq = useTranslations('contentTools.queue');
  const tc = useTranslations('common');
  const qc = useQueryClient();
  const me = useMe();
  const canAssign = isReviewer(me.data);
  const [filter, setFilter] = React.useState<Filter>(EMPTY);
  const testSetId = initialTestSetId ?? null;
  const query = React.useMemo(() => ({ ...filter, test_set_id: testSetId ?? '' }), [filter, testSetId]);
  const { q, rows } = useCursorList(contentToolsKeys.queue(query), (cursor) => getReviewQueue({ ...query, cursor }));
  const counts = (q.data?.pages[0] as { counts?: Record<string, number> } | undefined)?.counts ?? {};
  const reviewers = useQuery({ queryKey: contentToolsKeys.reviewers, queryFn: listReviewers });
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<{ action: ReviewBulkAction; ids: string[] } | null>(null);
  const [lastResult, setLastResult] = React.useState<ReviewBulkResult | null>(null);
  const [assignee, setAssignee] = React.useState('');
  const listRef = React.useRef<HTMLUListElement>(null);
  const active = rows.find((r) => r.id === activeId) ?? rows[0] ?? null;
  const activeIndex = active ? rows.findIndex((r) => r.id === active.id) : -1;

  const refresh = () => void qc.invalidateQueries({ queryKey: contentToolsKeys.queue() });
  const errorText = (code: string, reason: string | undefined, message: string) => {
    const k = reason ?? code;
    return t.has(`errors.${k}`) ? t(`errors.${k}`) : t('errors.generic', { message });
  };

  const bulk = useMutation({
    mutationFn: (v: { action: ReviewBulkAction; ids: string[]; notes?: string }) => bulkReview({ question_ids: v.ids, action: v.action, ...(v.notes ? { notes: v.notes } : {}) }),
    onSuccess: (r) => {
      setDialog(null);
      setLastResult(r.failed ? r : null);
      if (r.ok) toast.success(tq('bulkDone', { ok: r.ok, requested: r.requested }));
      else toast.error(tq('bulkFailedTitle', { failed: r.failed }));
      setSelected(new Set());
      refresh();
    },
  });
  const assign = useMutation({
    mutationFn: (v: { ids: string[]; assignee: string | null }) => assignReviewer({ question_ids: v.ids, assignee_id: v.assignee }),
    onSuccess: (r) => {
      toast.success(r.assignee_id ? tq('assigned', { n: r.updated }) : tq('unassigned', { n: r.updated }));
      refresh();
    },
  });
  const recheck = useMutation({
    mutationFn: (id: string) => duplicateCheck(id),
    onSuccess: () => {
      toast.success(t('preview.rechecked'));
      refresh();
    },
  });

  const mutateBulk = bulk.mutate;
  const run = React.useCallback(
    (action: ReviewBulkAction, ids: string[]) => {
      if (!ids.length) return;
      // Từ chối / yêu cầu sửa: hộp thoại lý do; duyệt / gửi duyệt nhiều câu: xác nhận; một câu: chạy ngay
      if (action === 'reject' || action === 'needs_change' || ids.length > 1) setDialog({ action, ids });
      else mutateBulk({ action, ids });
    },
    [mutateBulk],
  );

  const toggle = React.useCallback((id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  }), []);

  const focusRow = React.useCallback((id: string) => {
    setActiveId(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-row-id="${id}"] [data-row-main]`)?.focus());
  }, []);

  // Phím tắt hàng chờ (không khi đang gõ / hộp thoại mở / có phím bổ trợ)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || dialog || document.querySelector('dialog[open], [role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        if (!rows.length) return;
        e.preventDefault();
        const next = Math.max(0, Math.min(rows.length - 1, (activeIndex < 0 ? 0 : activeIndex) + (k === 'j' ? 1 : -1)));
        focusRow(rows[next]!.id);
      } else if (k === 'a' && active) {
        e.preventDefault();
        run('approve', [active.id]);
      } else if (k === 'r' && active) {
        e.preventDefault();
        run('reject', [active.id]);
      } else if (k === 'x' && active) {
        e.preventDefault();
        toggle(active.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, activeIndex, active, dialog, run, toggle, focusRow]);

  const selectedIds = [...selected].filter((id) => rows.some((r) => r.id === id));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const reviewerOptions = (reviewers.data?.data ?? []).map((r) => ({ value: r.id, label: `${r.display_name}${r.email ? ` (${r.email})` : ''}` }));
  const dialogTitle = dialog ? tq(dialog.action === 'reject' ? 'rejectTitle' : dialog.action === 'needs_change' ? 'needsChangeTitle' : dialog.action === 'submit' ? 'submitTitle' : 'approveTitle', { count: dialog.ids.length }) : '';
  const bulkError = bulk.isError ? t('errors.generic', { message: bulk.error.message }) : null;

  return (
    <div className="space-y-4" data-testid="review-queue">
      <FilterBar<Filter>
        value={filter}
        onApply={(f) => {
          setFilter(f);
          setSelected(new Set());
          setActiveId(null);
        }}
        testId="queue-filters"
        fields={[
          { name: 'program', label: tq('filters.program'), type: 'select', options: ['toeic', 'ielts', 'jlpt', 'hsk'].map((p) => ({ value: p, label: p.toUpperCase() })) },
          { name: 'section', label: tq('filters.section'), type: 'select', options: PARTS.map((p) => ({ value: p, label: p.toUpperCase() })) },
          { name: 'status', label: tq('filters.status'), type: 'select', options: QUEUE_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })) },
          { name: 'source', label: tq('filters.source'), type: 'select', options: ['human', 'ai', 'licensed'].map((s) => ({ value: s, label: t(`source.${s}`) })) },
          { name: 'duplicate', label: tq('filters.duplicate'), type: 'select', options: [{ value: 'true', label: tq('dupOnly') }, { value: 'false', label: tq('notDup') }] },
          { name: 'created_by', label: tq('filters.createdBy'), type: 'select', options: [{ value: 'me', label: tq('me') }, ...reviewerOptions] },
          { name: 'assignee', label: tq('filters.assignee'), type: 'select', options: [{ value: 'me', label: tq('me') }, { value: 'none', label: tq('none') }, ...reviewerOptions] },
          { name: 'from', label: tq('filters.from'), type: 'date' },
          { name: 'to', label: tq('filters.to'), type: 'date' },
          { name: 'q', label: tq('filters.q') },
          { name: 'sort', label: tq('filters.sort'), type: 'select', options: ['created_at', 'updated_at', 'similarity'].map((s) => ({ value: s, label: tq(`sortBy.${s}`) })) },
          { name: 'order', label: tq('filters.order'), type: 'select', options: ['desc', 'asc'].map((s) => ({ value: s, label: tq(`orderBy.${s}`) })) },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="queue-counts">
        {testSetId ? (
          <Badge variant="gold" data-testid="queue-test-set">
            {tq('draftTest')} <ShortId id={testSetId} />
          </Badge>
        ) : null}
        {QUEUE_STATUSES.map((s) => (
          <Badge key={s} variant="outline" data-status={s}>
            {tq('count', { status: t(`status.${s}`), n: counts[s] ?? 0 })}
          </Badge>
        ))}
        <span className="text-muted-foreground" data-testid="queue-shortcuts">
          {tq('shortcuts')}
        </span>
      </div>

      {/* Thanh hành động hàng loạt */}
      <div className={cn('flex flex-wrap items-center gap-2 rounded-xl border p-2', selectedIds.length ? 'border-primary bg-primary/5' : 'border-dashed border-border')} data-testid="queue-bulkbar">
        <label className="flex items-center gap-2 px-1 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={allOnPage} onChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))} aria-label={tq('selectAll')} data-testid="queue-select-all" />
          <span data-testid="queue-selected-count">{tq('selected', { count: selectedIds.length })}</span>
        </label>
        <Button size="sm" variant="default" disabled={!selectedIds.length || bulk.isPending} onClick={() => run('approve', selectedIds)} data-testid="bulk-approve">
          <Check aria-hidden />
          {tq('approve')}
        </Button>
        <Button size="sm" variant="outline" disabled={!selectedIds.length || bulk.isPending} onClick={() => run('needs_change', selectedIds)} data-testid="bulk-needs-change">
          <Undo2 aria-hidden />
          {tq('needsChange')}
        </Button>
        <Button size="sm" variant="destructive" disabled={!selectedIds.length || bulk.isPending} onClick={() => run('reject', selectedIds)} data-testid="bulk-reject">
          <X aria-hidden />
          {tq('reject')}
        </Button>
        <Button size="sm" variant="outline" disabled={!selectedIds.length || bulk.isPending} onClick={() => run('submit', selectedIds)} data-testid="bulk-submit">
          <Send aria-hidden />
          {tq('submit')}
        </Button>
        {canAssign ? (
          <span className="flex items-center gap-1.5">
            <Label htmlFor="queue-assignee" className="sr-only">
              {tq('assignTo')}
            </Label>
            <NativeSelect id="queue-assignee" className="h-8 w-48 text-xs" value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="bulk-assignee">
              <option value="">{tq('assignTo')}</option>
              <option value="__none">{tq('unassign')}</option>
              {(reviewers.data?.data ?? [])
                .filter((r) => r.can_review)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name}
                  </option>
                ))}
            </NativeSelect>
            <Button size="sm" variant="secondary" disabled={!selectedIds.length || !assignee || assign.isPending} onClick={() => assign.mutate({ ids: selectedIds, assignee: assignee === '__none' ? null : assignee })} data-testid="bulk-assign">
              <UserCheck aria-hidden />
              {tq('assignApply')}
            </Button>
          </span>
        ) : null}
        {selectedIds.length ? (
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} data-testid="bulk-clear">
            {tq('clear')}
          </Button>
        ) : null}
      </div>

      {lastResult ? (
        <Alert variant="destructive" data-testid="bulk-failures">
          <AlertTitle>{tq('bulkFailedTitle', { failed: lastResult.failed })}</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-0.5 text-xs">
              {lastResult.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.question_id} data-testid="bulk-failure" data-reason={r.error?.reason ?? r.error?.code}>
                    <ShortId id={r.question_id} /> – {r.error ? errorText(r.error.code, r.error.reason, r.error.message) : ''}
                  </li>
                ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {q.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="min-w-0 space-y-2">
            {rows.length === 0 ? <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{tq('empty')}</p> : null}
            <ul ref={listRef} className="space-y-2" aria-label={tq('listLabel')} data-testid="queue-list">
              {rows.map((r) => (
                <QueueRow key={r.id} item={r} active={active?.id === r.id} checked={selected.has(r.id)} onToggle={() => toggle(r.id)} onActivate={() => setActiveId(r.id)} />
              ))}
            </ul>
            {q.hasNextPage ? (
              <div className="flex justify-center">
                <Button variant="outline" size="sm" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()} data-testid="queue-more">
                  {q.isFetchingNextPage ? <Spinner aria-hidden /> : null}
                  {tc('next')}
                </Button>
              </div>
            ) : null}
          </div>
          <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
            {active ? (
              <QuestionPreview
                item={active}
                onRecheck={() => recheck.mutate(active.id)}
                rechecking={recheck.isPending}
                actions={
                  <>
                    <Button size="sm" onClick={() => run('approve', [active.id])} disabled={bulk.isPending} data-testid="preview-approve" aria-keyshortcuts="A">
                      <Check aria-hidden />
                      {tq('approve')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => run('needs_change', [active.id])} disabled={bulk.isPending} data-testid="preview-needs-change">
                      <Undo2 aria-hidden />
                      {tq('needsChange')}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => run('reject', [active.id])} disabled={bulk.isPending} data-testid="preview-reject" aria-keyshortcuts="R">
                      <X aria-hidden />
                      {tq('reject')}
                    </Button>
                    {active.workflow_status === 'draft' || active.workflow_status === 'ai_checked' ? (
                      <Button size="sm" variant="outline" onClick={() => run('submit', [active.id])} disabled={bulk.isPending} data-testid="preview-submit">
                        <Send aria-hidden />
                        {tq('submit')}
                      </Button>
                    ) : null}
                  </>
                }
              />
            ) : (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{tq('noSelection')}</p>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        key={dialog ? `${dialog.action}-${dialog.ids.join(',')}` : 'none'}
        open={!!dialog}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialogTitle}
        description={tq('decisionDesc')}
        confirmLabel={dialog ? tq(dialog.action === 'reject' ? 'reject' : dialog.action === 'needs_change' ? 'needsChange' : dialog.action === 'submit' ? 'submit' : 'approve') : ''}
        destructive={dialog?.action === 'reject'}
        reason={dialog && (dialog.action === 'reject' || dialog.action === 'needs_change') ? { label: tq('reasonLabel'), min: 3, placeholder: tq('reasonPlaceholder') } : undefined}
        pending={bulk.isPending}
        error={bulkError}
        onConfirm={(notes) => dialog && bulk.mutate({ action: dialog.action, ids: dialog.ids, notes: notes || undefined })}
        testId="queue-decision"
      />
    </div>
  );
}

function QueueRow({ item, active, checked, onToggle, onActivate }: { item: ReviewQueueItem; active: boolean; checked: boolean; onToggle: () => void; onActivate: () => void }) {
  const t = useTranslations('contentTools');
  const tq = useTranslations('contentTools.queue');
  const stem = ((item.content as { stem?: string }).stem ?? '').trim();
  const errors = item.auto_checks.filter((c) => c.level === 'error').length;
  const warnings = item.auto_checks.length - errors;
  return (
    <li
      className={cn('flex gap-2 rounded-xl border bg-card p-2.5 transition-colors', active ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40')}
      data-testid="queue-row"
      data-row-id={item.id}
      data-status={item.workflow_status}
      data-section={item.section_code}
      data-source={item.source}
      data-duplicate={item.duplicate?.flagged ? 'true' : 'false'}
      data-active={active}
    >
      <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--color-primary)]" checked={checked} onChange={onToggle} aria-label={tq('selectOne', { stem: stem.slice(0, 60) || item.id.slice(0, 8) })} data-testid="queue-row-select" />
      <button type="button" className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={onActivate} aria-current={active ? 'true' : undefined} data-row-main="" data-testid="queue-row-open">
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary">{item.section_code.toUpperCase()}</Badge>
          <Badge variant="outline">{t(`status.${item.workflow_status}`)}</Badge>
          {item.source === 'ai' ? <Badge variant="gold">{t('source.ai')}</Badge> : null}
          {item.duplicate?.flagged ? (
            <Badge variant="destructive" data-testid="queue-dup-badge">
              <Copy aria-hidden />
              {tq('dupBadge', { pct: pctOf(item.duplicate.similarity) })}
            </Badge>
          ) : null}
          {errors ? <Badge variant="destructive">{tq('errorsBadge', { n: errors })}</Badge> : null}
          {warnings ? <Badge variant="muted">{tq('warningsBadge', { n: warnings })}</Badge> : null}
          {item.ai_check?.verdict ? <Badge variant={item.ai_check.verdict === 'pass' ? 'success' : item.ai_check.verdict === 'fail' ? 'destructive' : 'gold'}>{t(`verdict.${item.ai_check.verdict}`)}</Badge> : null}
          {item.has_pending_version ? <Badge variant="muted">{tq('pending')}</Badge> : null}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm break-words" data-testid="queue-row-stem">
          {stem || item.passage?.title || '—'}
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          {item.created_by ? <span>{tq('by', { name: item.created_by.display_name })}</span> : null}
          {item.assignee ? <span data-testid="queue-row-assignee">{tq('assignedTo', { name: item.assignee.display_name })}</span> : null}
          <When iso={item.created_at} />
        </span>
      </button>
    </li>
  );
}
