'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft, Layers, Plus, Volume2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Spinner } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { useLocalized } from '@/lib/localized';
import { getVocabItems } from '@/lib/s10-api';
import { PROGRAM } from '@/features/plan/queries';
import { cardStatus, formatIpa, itemMeaning } from './card-view';
import { useEnrollList, useVocabLists, vocabKeys } from './queries';
import { ListProgress } from './vocab-lists-page';
import { speak } from './speak';

const STATUS_VARIANT = { none: 'muted', new: 'outline', learning: 'secondary', review: 'default', mastered: 'gold' } as const;

/**
 * Trang bộ từ `/toeic/vocab/{listId}` (S10 – thay trang tạm `/vocab/{id}` của S9): tiến độ bộ, từng từ + trạng thái thẻ của
 * người học, phát âm, "Thêm cả bộ", "Ôn bộ này" (giữ `?task=` của lộ trình → phiên ôn tự đánh dấu xong task).
 */
export function VocabListDetailPage({ listId }: { listId: string }) {
  const t = useTranslations('vocab');
  const locale = useLocale();
  const L = useLocalized();
  const search = useSearchParams();
  const taskId = search.get('task');
  const lists = useVocabLists(PROGRAM);
  const list = lists.data?.find((l) => l.id === listId) ?? null;
  const enroll = useEnrollList(PROGRAM);
  const items = useInfiniteQuery({
    queryKey: vocabKeys.items(listId),
    queryFn: ({ pageParam }) => getVocabItems(listId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const reviewHref = `/toeic/vocab/review?list=${encodeURIComponent(listId)}${taskId ? `&task=${encodeURIComponent(taskId)}` : ''}`;
  const words = items.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-6" data-testid="vocab-list-page">
      <PageHeader
        title={list ? L(list.title) : t('listFallbackTitle')}
        description={list ? t('words', { count: list.counts.total }) : undefined}
        actions={
          <Link href="/toeic/vocab" className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden />
            {t('allLists')}
          </Link>
        }
      />
      {taskId ? (
        <Alert variant="gold">
          <AlertDescription>{t('taskHint')}</AlertDescription>
        </Alert>
      ) : null}
      {list?.enrolled ? <ListProgress counts={list.counts} label={t('progressLabel', { title: L(list.title) })} /> : null}
      <div className="flex flex-wrap gap-2">
        {list && list.next_action_code === 'enroll' ? (
          <Button
            variant="navy"
            onClick={() => enroll.mutate(listId, { onSuccess: (r) => toast.success(t('enrolled', { added: r.added, existing: r.existing })), onError: () => toast.error(t('enrollFailed')) })}
            disabled={enroll.isPending}
            data-testid="vocab-enroll"
          >
            {enroll.isPending ? <Spinner className="size-4" /> : <Plus aria-hidden />}
            {t('next_action.enroll')}
          </Button>
        ) : null}
        {list?.enrolled || !list ? (
          <Link href={reviewHref} className={buttonVariants({ variant: 'gold' })} data-testid="vocab-list-review">
            <Layers aria-hidden />
            {t('reviewList')}
          </Link>
        ) : null}
      </div>

      {items.isPending ? (
        <CardSkeleton lines={6} />
      ) : items.isError ? (
        <ErrorState error={items.error} onRetry={() => void items.refetch()} />
      ) : words.length === 0 ? (
        <EmptyState title={t('noWords')} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label={t('wordsLabel')}>
          {words.map((w) => {
            const st = cardStatus(w.srs);
            const ipa = formatIpa(w.ipa_us ?? w.ipa_uk);
            return (
              <li key={w.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3" data-testid="vocab-item" data-status={st}>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-semibold" lang="en">
                    {w.headword}
                    {w.pos ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{w.pos}</span> : null}
                  </p>
                  {ipa ? <p className="text-xs text-muted-foreground">{ipa}</p> : null}
                  <p className="text-sm text-muted-foreground">{itemMeaning(w, locale) ?? '—'}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <Badge variant={STATUS_VARIANT[st]}>{t(`status.${st}`)}</Badge>
                  <Button variant="ghost" size="icon-sm" aria-label={t('speakWord', { word: w.headword })} onClick={() => void speak(w.headword)}>
                    <Volume2 aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {items.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void items.fetchNextPage()} disabled={items.isFetchingNextPage}>
            {items.isFetchingNextPage ? <Spinner className="size-4" /> : null}
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
