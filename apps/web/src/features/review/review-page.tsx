'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { buttonVariants, NativeSelect, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useAttemptReview } from '@/lib/queries';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { ReviewItemCard } from './review-item';

type Filter = 'all' | 'wrong' | 'flagged';

export function ReviewPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('review');
  const ts = useTranslations('sections');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [section, setSection] = React.useState<string>('all');
  // Bộ lọc "câu sai" dùng tham số only_wrong của API; đánh dấu/Part lọc ở client
  const review = useAttemptReview(attemptId, filter === 'wrong');

  const sections = React.useMemo(() => Array.from(new Set((review.data?.items ?? []).map((i) => i.question.section_code))), [review.data]);
  const items = React.useMemo(() => {
    const all = review.data?.items ?? [];
    return all.filter((i) => (filter === 'flagged' ? i.flagged : true)).filter((i) => (section === 'all' ? true : i.question.section_code === section));
  }, [review.data, filter, section]);

  const known = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;
  const sectionLabel = (code: string) => ((known as readonly string[]).includes(code) ? ts(code as (typeof known)[number]) : code);

  return (
    <div className="space-y-6" data-testid="review-page">
      <PageHeader
        title={t('title')}
        actions={
          <Link href={`/attempts/${attemptId}/result`} className={buttonVariants({ variant: 'outline' })}>
            {t('backToResult')}
          </Link>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList aria-label={t('title')}>
            <TabsTrigger value="all">{t('filterAll')}</TabsTrigger>
            <TabsTrigger value="wrong">{t('filterWrong')}</TabsTrigger>
            <TabsTrigger value="flagged">{t('filterFlagged')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <NativeSelect aria-label={t('filterSection')} value={section} onChange={(e) => setSection(e.target.value)} className="sm:w-56">
          <option value="all">{t('allSections')}</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {sectionLabel(s)}
            </option>
          ))}
        </NativeSelect>
      </div>

      {review.isPending ? (
        <div className="space-y-4">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={5} />
        </div>
      ) : review.isError ? (
        <ErrorState error={review.error} title={t('loadError')} onRetry={() => void review.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <ReviewItemCard key={item.question.question_id} item={item} number={item.question.order_no} attemptId={attemptId} />
          ))}
        </div>
      )}
    </div>
  );
}
