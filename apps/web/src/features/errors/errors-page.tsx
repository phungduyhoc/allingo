'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Repeat2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ERROR_DRILL_MAX, ERROR_KINDS, type ErrorKind } from '@allingo/schemas/api/learning-s10';
import { Alert, AlertDescription, Button, Card, CardContent, cn, NativeSelect, Spinner, ToggleChip } from '@allingo/ui';
import { usePathname, useRouter } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { getErrorStatus } from '@/lib/errors';
import { useExamLock } from '@/lib/exam-lock';
import { ExamLockBanner } from '@/features/exam-lock/exam-lock-banner';
import { rememberPlanLaunch } from '@/features/plan/launch-memory';

import { ErrorEntryCard } from './error-entry';
import { errorDrillBody, errorFiltersToSearch, ERROR_STATUSES, ERROR_WINDOWS, parseErrorFilters, sortedCounts, sortedSections, type ErrorFilters } from './filters';
import { useErrorDrill, useErrorLog, usePatchError } from './queries';
import { useProgramHref, useProgram } from '@/features/program/program-context';
import { autoSectionCodes } from '@allingo/schemas/program/registry';

/**
 * Sổ lỗi `/toeic/errors` (S10): tổng chưa hiểu/đã hiểu, phân bố theo loại lỗi và theo Part (bấm để lọc), bộ lọc trạng thái/loại/
 * Part/thời gian/sắp xếp trên URL, danh sách cursor; mỗi mục: đã hiểu, ghi chú, đổi lý do, tạo thẻ SRS; "Làm lại 10 câu sai"
 * (`POST /me/errors/drill` → timed_drill từ đúng các câu đã chọn hoặc 10 lỗi cũ nhất theo bộ lọc). `?task=` (task review_errors)
 * gắn `plan_task_id`. Exam Mode → 403 `exam_mode_locked` → banner.
 */
export function ErrorsPage() {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('errorLog');
  const ts = useTranslations('sections');
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filters = React.useMemo(() => parseErrorFilters(search), [search]);
  const taskId = search.get('task');
  const log = useErrorLog(filters, program);
  const patch = usePatchError(filters, program);
  const drill = useErrorDrill();
  const lock = useExamLock();
  const [selected, setSelected] = React.useState<string[]>([]);
  const first = log.data?.pages[0];
  const entries = log.data?.pages.flatMap((p) => p.data) ?? [];
  const locked = lock.locked || getErrorStatus(log.error) === 403;

  const setFilters = (next: Partial<ErrorFilters>) => {
    setSelected([]);
    const qs = errorFiltersToSearch({ ...filters, ...next }, { task: taskId });
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= ERROR_DRILL_MAX) {
        toast.info(t('selectMax', { max: ERROR_DRILL_MAX }));
        return s;
      }
      return [...s, id];
    });

  const startDrill = () =>
    drill.mutate(errorDrillBody(filters, selected, taskId, program), {
      onSuccess: (attempt) => {
        if (taskId) rememberPlanLaunch(attempt.id, { task_id: taskId, return_to: href('today') });
        router.push(`/attempts/${attempt.id}`);
      },
      onError: (e) => {
        if (getErrorStatus(e) === 404) toast.info(t('drillNone'));
        else if (getErrorStatus(e) !== 403 && getErrorStatus(e) !== 429) toast.error(t('drillFailed'));
      },
    });

  const openCount = first?.totals.open ?? 0;

  return (
    <div className="space-y-6" data-testid="errors-page">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <Button variant="gold" onClick={startDrill} disabled={drill.isPending || locked || openCount === 0} data-testid="errors-drill">
            {drill.isPending ? <Spinner className="size-4" /> : <Repeat2 aria-hidden />}
            {selected.length ? t('drillSelected', { count: selected.length }) : t('drill', { count: Math.min(ERROR_DRILL_MAX, openCount) })}
          </Button>
        }
      />
      {locked ? <ExamLockBanner attemptId={lock.attemptId} message={t('examLocked')} /> : null}
      {taskId ? (
        <Alert variant="gold">
          <AlertDescription>{t('taskHint')}</AlertDescription>
        </Alert>
      ) : null}

      {/* Tổng quan */}
      <h2 className="sr-only">{t('summaryTitle')}</h2>
      {log.isPending && !locked ? (
        <div className="grid gap-4 md:grid-cols-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
          <CardSkeleton lines={3} />
        </div>
      ) : first ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{t('totalOpen')}</p>
                <p className="tabular text-3xl font-extrabold" data-testid="errors-open">
                  {first.totals.open}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('totalResolved')}</p>
                <p className="tabular text-3xl font-extrabold text-success" data-testid="errors-resolved">
                  {first.totals.resolved}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <h3 className="text-sm font-semibold">{t('byKind')}</h3>
              <Bars rows={sortedCounts(first.distribution).map(([k, n]) => ({ key: k, label: t(`kind.${k}` as never), n, active: filters.kind === k }))} onPick={(k) => setFilters({ kind: filters.kind === k ? null : (k as ErrorKind) })} empty={t('none')} testId="errors-by-kind" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-2">
              <h3 className="text-sm font-semibold">{t('byPart')}</h3>
              <Bars rows={sortedSections(first.by_section).map(([k, n]) => ({ key: k, label: ts.has(k as never) ? ts(k as never) : k, n, active: filters.part === k }))} onPick={(k) => setFilters({ part: filters.part === k ? null : k })} empty={t('none')} testId="errors-by-part" />
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Bộ lọc */}
      <section aria-labelledby="errors-filters" className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 id="errors-filters" className="sr-only">
          {t('filtersTitle')}
        </h2>
        <div role="group" aria-label={t('statusLabel')} className="flex flex-wrap gap-2">
          {ERROR_STATUSES.map((s) => (
            <ToggleChip key={s} pressed={filters.status === s} onPressedChange={() => setFilters({ status: s })} data-testid={`errors-status-${s}`}>
              {t(`status.${s}`)}
            </ToggleChip>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <FilterSelect label={t('kindLabel')} value={filters.kind ?? ''} onChange={(v) => setFilters({ kind: (v || null) as ErrorKind | null })} testId="errors-filter-kind">
            <option value="">{t('allKinds')}</option>
            {ERROR_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label={t('partLabel')} value={filters.part ?? ''} onChange={(v) => setFilters({ part: v || null })} testId="errors-filter-part">
            <option value="">{t('allParts')}</option>
            {autoSectionCodes(program).map((p) => (
              <option key={p} value={p}>
                {ts.has(p as never) ? ts(p as never) : p}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label={t('windowLabel')} value={String(filters.days)} onChange={(v) => setFilters({ days: Number(v) as ErrorFilters['days'] })} testId="errors-filter-days">
            {ERROR_WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t('windowAll') : t('windowDays', { count: d })}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label={t('sortLabel')} value={filters.sort} onChange={(v) => setFilters({ sort: v === 'oldest' ? 'oldest' : 'newest' })} testId="errors-filter-sort">
            <option value="newest">{t('sortNewest')}</option>
            <option value="oldest">{t('sortOldest')}</option>
          </FilterSelect>
        </div>
      </section>

      {/* Danh sách */}
      <section aria-labelledby="errors-list" className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="errors-list" className="text-lg font-semibold">
            {t('listTitle')}
          </h2>
          {selected.length ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              {t('clearSelection')}
            </Button>
          ) : null}
        </div>
        {log.isPending && !locked ? (
          <CardSkeleton lines={4} />
        ) : log.isError && !locked ? (
          <ErrorState error={log.error} onRetry={() => void log.refetch()} />
        ) : entries.length === 0 && !locked ? (
          <EmptyState title={filters.status === 'resolved' ? t('emptyResolved') : t('empty')} description={t('emptyDesc')} />
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.id}>
                <ErrorEntryCard
                  entry={e}
                  selected={selected.includes(e.id)}
                  selectable={!e.resolved}
                  onToggleSelect={toggle}
                  busy={patch.isPending && patch.variables?.id === e.id}
                  onPatch={(p) =>
                    patch.mutate(
                      { id: e.id, patch: p },
                      {
                        onSuccess: () => {
                          if (p.resolved === true) toast.success(t('resolvedToast'));
                          if (p.create_card) toast.success(t('cardCreatedToast'));
                          if (p.resolved === true) setSelected((s) => s.filter((x) => x !== e.id));
                        },
                        onError: (err) => {
                          if (getErrorStatus(err) !== 403) toast.error(t('patchFailed'));
                        },
                      },
                    )
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {log.hasNextPage ? (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => void log.fetchNextPage()} disabled={log.isFetchingNextPage} data-testid="errors-more">
              {log.isFetchingNextPage ? <Spinner className="size-4" /> : null}
              {t('loadMore')}
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FilterSelect({ label, value, onChange, children, testId }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; testId: string }) {
  const id = React.useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        {children}
      </NativeSelect>
    </div>
  );
}

/** Thanh ngang theo số lượng – bấm để lọc (aria-pressed) */
function Bars({ rows, onPick, empty, testId }: { rows: Array<{ key: string; label: string; n: number; active: boolean }>; onPick: (key: string) => void; empty: string; testId: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="space-y-1.5" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            aria-pressed={r.active}
            onClick={() => onPick(r.key)}
            className={cn('group w-full rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40', r.active && 'bg-secondary')}
            data-key={r.key}
            data-count={r.n}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate">{r.label}</span>
              <span className="tabular font-semibold">{r.n}</span>
            </span>
            <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.n / max) * 100}%` }} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
