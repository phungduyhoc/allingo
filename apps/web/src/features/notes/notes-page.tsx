'use client';

import * as React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Button, buttonVariants, Input, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { useExamLock } from '@/lib/exam-lock';
import { listNotes } from '@/lib/learning-api';
import { ExamLockBanner } from '@/features/exam-lock/exam-lock-banner';
import { NoteEditor, NOTES_KEY } from './note-editor';

/** Trì hoãn giá trị (tìm kiếm khi gõ) */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [ms, value]);
  return v;
}

/**
 * "Ghi chú của tôi": GET /notes?q=&cursor= (tìm theo nội dung, phân trang cursor), sửa/xoá tại chỗ, mở câu trong bài xem lại
 * (`/attempts/{id}/review?focus=<question_version_id>`). Exam Mode → chỉ đọc (ghi chú bị khoá ghi).
 */
export function NotesPage() {
  const t = useTranslations('notes');
  const fmt = useFormatter();
  const [q, setQ] = React.useState('');
  const query = useDebounced(q.trim().slice(0, 100), 300);
  const lock = useExamLock();
  const notes = useInfiniteQuery({
    queryKey: [...NOTES_KEY, 'list', query],
    queryFn: ({ pageParam }) => listNotes({ q: query || undefined, cursor: pageParam, limit: 20 }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const items = notes.data?.pages.flatMap((p) => p.data) ?? [];
  const searchId = React.useId();

  return (
    <div className="space-y-6" data-testid="notes-page">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {lock.locked ? <ExamLockBanner attemptId={lock.attemptId} /> : null}
      <div className="relative max-w-md">
        <label htmlFor={searchId} className="sr-only">
          {t('searchLabel')}
        </label>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={searchId}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('searchPlaceholder')}
          className="pl-9"
          maxLength={100}
          data-testid="notes-search"
        />
      </div>

      {notes.isPending ? (
        <div className="space-y-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
      ) : notes.isError ? (
        <ErrorState error={notes.error} title={t('loadError')} onRetry={() => void notes.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={query ? t('emptySearch', { q: query }) : t('empty')}
          action={
            query ? null : (
              <Link href="/toeic/dashboard" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('goToReview')}
              </Link>
            )
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="notes-count" aria-live="polite">
            {t('resultsCount', { count: items.length })}
            {notes.isFetching && !notes.isFetchingNextPage ? (
              <Spinner className="ml-2 inline size-3" aria-hidden />
            ) : null}
          </p>
          <ul className="space-y-3">
            {items.map((n) => (
              <li
                key={n.id}
                className="rounded-xl border border-border bg-card p-4"
                data-testid="notes-item"
                data-note-id={n.id}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary">{n.question_version_id ? t('questionNote') : t('general')}</Badge>
                  <span>
                    {t('updatedAt', {
                      date: fmt.dateTime(new Date(n.updated_at), { dateStyle: 'medium', timeStyle: 'short' }),
                    })}
                  </span>
                  {n.attempt_id ? (
                    <Link
                      href={`/attempts/${n.attempt_id}/review${n.question_version_id ? `?focus=${n.question_version_id}` : ''}`}
                      className="ml-auto inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                      data-testid="notes-open-review"
                    >
                      {t('openReview')}
                      <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  ) : null}
                </div>
                <NoteEditor
                  note={n}
                  target={{
                    question_version_id: n.question_version_id ?? undefined,
                    attempt_id: n.attempt_id ?? undefined,
                  }}
                  locked={lock.locked}
                  compact
                  testId="notes-editor"
                />
              </li>
            ))}
          </ul>
          {notes.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => void notes.fetchNextPage()}
              disabled={notes.isFetchingNextPage}
              data-testid="notes-more"
            >
              {notes.isFetchingNextPage ? <Spinner aria-hidden /> : null}
              {t('loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
