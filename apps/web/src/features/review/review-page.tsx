'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, NativeSelect, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useAttemptResult, useAttemptReview } from '@/lib/queries';
import { markExamLocked, useExamLock } from '@/lib/exam-lock';
import { ExamLockBanner } from '@/features/exam-lock/exam-lock-banner';
import { LookupLayer } from '@/features/dictionary/lookup-layer';
import { recordViewed } from '@/features/offline/viewed-store';
import { QuotaLeft } from '@/features/quota/quota-ui';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { useSectionLabel } from '@/features/attempt/section-label';
import { ReviewAudioGroup, ReviewItemCard } from './review-item';
import { useMediaUrls } from '@/features/attempt/use-media-urls';
import type { ReviewItem } from '@/lib/types';
import {
  parseReviewFilters,
  reviewApiQuery,
  reviewFiltersReducer,
  reviewFiltersToSearch,
  stepWrong,
  wrongIndices,
  wrongPosition,
  type ReviewFilter,
  type ReviewFilterAction,
  type ReviewFilters,
} from './review-filters';

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
  // Nghe lại sau khi nộp: URL ký 10′ → gia hạn qua GET /attempts/{id}/media (mọi trạng thái)
  const mediaSource = React.useMemo(() => items.map((i) => i.question), [items]);
  const media = useMediaUrls(attemptId, mediaSource);
  // Part 3/4: câu liên tiếp cùng hội thoại/bài nói → một đầu nhóm (nghe lại cả nhóm + transcript) trước câu đầu tiên đang hiển thị
  const groupHeads = React.useMemo(() => {
    const keyOf = (i: ReviewItem) =>
      i.question.passage?.kind === 'audio_script' ? (i.question.group_key ?? i.question.passage.id) : null;
    const heads = new Map<number, ReviewItem[]>();
    for (let i = 0; i < items.length;) {
      const key = keyOf(items[i]!);
      let j = i;
      while (key && j + 1 < items.length && keyOf(items[j + 1]!) === key) j++;
      if (key) heads.set(i, items.slice(i, j + 1));
      i = j + 1;
    }
    return heads;
  }, [items]);
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

  // Exam Mode (CLAUDE.md §5.8, ADR-0028): đang có bài thi chưa nộp → API trả 403 cho giải thích/gia sư/tra từ/ghi chú (ghi)
  // → ẩn nút ngay từ đầu (/me/attempts?status=in_progress&mode=exam); biết muộn (403 từ một lần bấm) cũng khoá mọi câu
  const lock = useExamLock(attemptId);
  const onExamLocked = React.useCallback(() => markExamLocked(), []);
  const examLocked = lock.locked;

  // "Đề đã xem" cho trang offline
  React.useEffect(() => {
    recordViewed({ id: attemptId, kind: 'review', title: null, href: `/attempts/${attemptId}/review` });
  }, [attemptId]);

  // ?focus=<question_version_id> (từ trích dẫn gia sư / "Ghi chú của tôi") → cuộn tới câu một lần sau khi tải
  const focusQv = searchParams.get('focus');
  const focusedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!focusQv || focusedRef.current === focusQv || items.length === 0) return;
    const el = document.querySelector<HTMLElement>(`[data-qv="${CSS.escape(focusQv)}"]`);
    if (!el) return;
    focusedRef.current = focusQv;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  }, [focusQv, items]);

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
      {examLocked ? (
        <ExamLockBanner attemptId={lock.attemptId} testId="review-exam-lock" />
      ) : (
        <QuotaLeft feature="ai_explain" />
      )}
      <div
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        role="group"
        aria-label={t('filterLabel')}
      >
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
        <NativeSelect
          aria-label={t('filterSection')}
          value={filters.section ?? 'all'}
          onChange={(e) => apply({ type: 'section', section: e.target.value === 'all' ? null : e.target.value })}
          className="sm:w-56"
          data-testid="review-section"
        >
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
            {items.map((item, i) => (
              <React.Fragment key={item.question.question_id}>
                {groupHeads.has(i) ? <ReviewAudioGroup items={groupHeads.get(i)!} media={media} /> : null}
                <div
                  id={`review-${item.question.question_id}`}
                  data-qv={item.question.question_version_id}
                  tabIndex={-1}
                  className="scroll-mt-20 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[flash=true]:ring-[3px] data-[flash=true]:ring-accent/60"
                >
                  <ReviewItemCard
                    item={item}
                    number={item.question.order_no}
                    attemptId={attemptId}
                    media={media}
                    examLocked={examLocked}
                    onExamLocked={onExamLocked}
                  />
                </div>
              </React.Fragment>
            ))}
          </div>
        </>
      )}

      {/* Điều hướng theo lỗi: dính đáy màn hình */}
      {!review.isPending && !review.isError && items.length > 0 ? (
        <div
          className="sticky bottom-20 z-20 mx-auto flex w-fit max-w-full items-center gap-1 rounded-full border border-border bg-card/95 p-1.5 shadow-lg backdrop-blur sm:gap-2 md:bottom-3"
          data-testid="wrong-nav"
        >
          {/*
            Mobile: nằm TRÊN thanh điều hướng đáy (fixed, ~70 px) và không rộng hơn màn hình – nhãn "Câu sai trước/tiếp theo" chỉ hiện
            từ sm (dưới sm là nút biểu tượng có nhãn cho trình đọc màn hình). Trước đây `w-fit` + nhãn đầy đủ rộng ~410 px: với font hệ
            thống rộng (DejaVu Sans trên Linux/CI) tràn ngang 412 px → trình duyệt mobile thu nhỏ trang, thanh đáy/header che nút (E2E CI).
          */}
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => jump(-1)}
            disabled={stepWrong(wrong, cursor, -1) === null}
            aria-label={t('prevWrong')}
            data-testid="prev-wrong"
          >
            <ChevronUp aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('prevWrong')}</span>
          </Button>
          <span
            className="tabular min-w-20 text-center text-xs font-semibold text-muted-foreground"
            aria-live="polite"
            data-testid="wrong-position"
          >
            {position > 0
              ? t('wrongNav', { current: position, total: wrong.length })
              : t('wrongNavIdle', { total: wrong.length })}
          </span>
          <Button
            variant="navy"
            size="sm"
            className="rounded-full"
            onClick={() => jump(1)}
            disabled={stepWrong(wrong, cursor, 1) === null}
            aria-label={t('nextWrong')}
            data-testid="next-wrong"
          >
            <span className="sr-only sm:not-sr-only">{t('nextWrong')}</span>
            <ChevronDown aria-hidden />
          </Button>
        </div>
      ) : null}

      {/* S6: tra từ khi chọn chữ trong đề/đoạn văn/transcript (không mở khi đang có bài thi) */}
      <LookupLayer enabled={!examLocked} source={{ type: 'review', attemptId }} />
    </div>
  );
}
