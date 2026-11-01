'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, NativeSelect, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useAttemptResult, useAttemptReview } from '@/lib/queries';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { useSectionLabel } from '@/features/attempt/section-label';
import { ReviewItemCard } from './review-item';
import { parseReviewFilters, reviewApiQuery, reviewFiltersReducer, reviewFiltersToSearch, stepWrong, wrongIndices, wrongPosition, type ReviewFilter, type ReviewFilterAction, type ReviewFilters } from './review-filters';

/**
 * Xem lại: lọc Tất cả / Câu sai / Đã đánh dấu + theo Part bằng tham số API (only_wrong/flagged/section), trạng thái
 * lọc nằm trên URL (?filter=&section=) để tải lại/chia sẻ giữ nguyên; nút "Câu sai trước/tiếp theo".
 */
export function ReviewPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('review');
  const sectionLabel = useSectionLabel();
  const searchParams = useSearchParams();
  const filters = React.useMemo(() => parseReviewFilters(searchParams), [searchParams]);
  const apply = React.useCallback(
    (action: ReviewFilterAction) => {
      const next: ReviewFilters = reviewFiltersReducer(filters, action);
      const qs = reviewFiltersToSearch(next);
      // History API gốc: Next đồng bộ useSearchParams, không tải lại trang/không thêm mục lịch sử.
      // state phải là null – state có cờ nội bộ của Next (__NA) thì Next bỏ qua, useSearchParams không đổi
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    },
    [filters],
  );

  const review = useAttemptReview(attemptId, reviewApiQuery(filters));
  // Danh sách Part lấy từ kết quả (không phụ thuộc bộ lọc đang áp)
  const result = useAttemptResult(attemptId, { retry: false });
  const sections = React.useMemo(() => {
    const fromResult = Object.keys(result.data?.by_section ?? {});
    const fromItems = (review.data?.items ?? []).map((i) => i.question.section_code);
    const all = Array.from(new Set([...fromResult, ...fromItems, ...(filters.section ? [filters.section] : [])]));
    return all.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  }, [filters.section, result.data, review.data]);

  const items = React.useMemo(() => review.data?.items ?? [], [review.data]);
  const wrong = React.useMemo(() => wrongIndices(items), [items]);
  const [cursor, setCursor] = React.useState<number | null>(null);
  // Đổi bộ lọc → danh sách khác → bắt đầu lại điều hướng
  const filterKey = reviewFiltersToSearch(filters);
  const [cursorKey, setCursorKey] = React.useState(filterKey);
  if (cursorKey !== filterKey) {
    setCursorKey(filterKey);
    setCursor(null);
  }
  const jump = (dir: 1 | -1) => {
    const idx = stepWrong(wrong, cursor, dir);
    if (idx === null) return;
    setCursor(idx);
    const item = items[idx];
    const el = item ? document.getElementById(`review-${item.question.question_id}`) : null;
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    el?.focus({ preventScroll: true });
  };
  const position = wrongPosition(wrong, cursor);

  return (
    <div className="space-y-6 pb-20" data-testid="review-page">
      <PageHeader
        title={t('title')}
        actions={
          <Link href={`/attempts/${attemptId}/result`} className={buttonVariants({ variant: 'outline' })}>
            {t('backToResult')}
          </Link>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" role="group" aria-label={t('filterLabel')}>
        <Tabs value={filters.filter} onValueChange={(v) => apply({ type: 'filter', filter: v as ReviewFilter })}>
          <TabsList aria-label={t('filterLabel')}>
            <TabsTrigger value="all" data-testid="review-filter-all">
              {t('filterAll')}
            </TabsTrigger>
            <TabsTrigger value="wrong" data-testid="review-filter-wrong">
              {t('filterWrong')}
            </TabsTrigger>
            <TabsTrigger value="flagged" data-testid="review-filter-flagged">
              {t('filterFlagged')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <NativeSelect aria-label={t('filterSection')} value={filters.section ?? 'all'} onChange={(e) => apply({ type: 'section', section: e.target.value === 'all' ? null : e.target.value })} className="sm:w-56" data-testid="review-section">
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
        <>
          <p className="text-sm text-muted-foreground" data-testid="review-count" data-count={items.length}>
            {t('itemsCount', { count: items.length })}
          </p>
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.question.question_id} id={`review-${item.question.question_id}`} tabIndex={-1} className="scroll-mt-20 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
                <ReviewItemCard item={item} number={item.question.order_no} attemptId={attemptId} />
              </div>
            ))}
          </div>
        </>
      )}

      {/* Điều hướng theo lỗi: dính đáy màn hình */}
      {!review.isPending && !review.isError && items.length > 0 ? (
        <div className="sticky bottom-3 z-20 mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur" data-testid="wrong-nav">
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => jump(-1)} disabled={stepWrong(wrong, cursor, -1) === null} data-testid="prev-wrong">
            <ChevronUp aria-hidden />
            {t('prevWrong')}
          </Button>
          <span className="tabular min-w-20 text-center text-xs font-semibold text-muted-foreground" aria-live="polite" data-testid="wrong-position">
            {position > 0 ? t('wrongNav', { current: position, total: wrong.length }) : t('wrongNavIdle', { total: wrong.length })}
          </span>
          <Button variant="navy" size="sm" className="rounded-full" onClick={() => jump(1)} disabled={stepWrong(wrong, cursor, 1) === null} data-testid="next-wrong">
            {t('nextWrong')}
            <ChevronDown aria-hidden />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
