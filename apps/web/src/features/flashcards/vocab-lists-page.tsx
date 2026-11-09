'use client';

import * as React from 'react';
import { BookOpenCheck, CheckCircle2, Layers, Lock, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { VocabList } from '@allingo/schemas/api/learning-s10';
import { Badge, Button, buttonVariants, Card, CardContent, cn, Spinner } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { useLocalized } from '@/lib/localized';
import { getErrorStatus } from '@/lib/errors';

import { UPGRADE_HREF } from '@/features/quota/quota-ui';
import { useEnrollList, useSrsCounts, useVocabLists } from './queries';
import { useProgram, useProgramHref } from '@/features/program/program-context';

/**
 * Từ vựng `/toeic/vocab` (S10): tổng quan hôm nay (đến hạn, thẻ mới còn trong hạn mức) + danh sách bộ từ hệ thống (TOEIC 600:
 * trọn gói + 10 chủ đề) với tiến độ mới/đang học/đã thuộc, hành động kế tiếp do server gợi ý (`next_action_code`): thêm cả bộ /
 * ôn / học từ mới / đã xong. Thêm cả bộ là idempotent; hạn mức thẻ mới áp khi HỌC (Free 10 / Pro 30 mỗi ngày – ADR-0033).
 */
export function VocabListsPage() {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('vocab');
  const lists = useVocabLists(program);
  const counts = useSrsCounts(program);
  const c = counts.data?.counts;
  const freshToday = c ? Math.min(c.new_remaining ?? c.new_total, c.new_total) : 0;

  return (
    <div className="space-y-8" data-testid="vocab-page">
      <PageHeader
        title={t('title')}
        description={t('desc')}
        actions={
          <Link href={href('vocab/review')} className={buttonVariants({ variant: 'gold' })} data-testid="vocab-review-all">
            <Layers aria-hidden />
            {t('reviewAll')}
          </Link>
        }
      />
      <section aria-labelledby="vocab-today" className="space-y-3">
        <h2 id="vocab-today" className="text-lg font-semibold">
          {t('todayTitle')}
        </h2>
        {counts.isPending ? (
          <CardSkeleton lines={2} />
        ) : counts.isError ? (
          <ErrorState error={counts.error} onRetry={() => void counts.refetch()} />
        ) : (
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label={t('dueNow')} value={c?.due_now ?? 0} testId="vocab-due-now" />
              <Metric label={t('newToday')} value={freshToday} testId="vocab-new-today" />
              <Metric label={t('newUsed')} value={c?.new_used_today ?? 0} hint={c?.new_limit != null ? t('newLimit', { limit: c.new_limit }) : undefined} />
              <Metric label={t('newTotal')} value={c?.new_total ?? 0} />
            </CardContent>
          </Card>
        )}
      </section>

      <section aria-labelledby="vocab-lists" className="space-y-3">
        <h2 id="vocab-lists" className="text-lg font-semibold">
          {t('listsTitle')}
        </h2>
        {lists.isPending ? (
          <div className="grid gap-4 md:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : lists.isError ? (
          <ErrorState error={lists.error} onRetry={() => void lists.refetch()} />
        ) : lists.data.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {[...lists.data]
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((l) => (
                <li key={l.id}>
                  <VocabListCard list={l} />
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value, hint, testId }: { label: string; value: number; hint?: string; testId?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tabular text-2xl font-extrabold tracking-tight" data-testid={testId}>
        {value}
      </p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Thanh tiến độ xếp chồng: đã thuộc (vàng) · đang học (navy) · mới (xám) trên tổng số từ của bộ */
export function ListProgress({ counts, label }: { counts: VocabList['counts']; label: string }) {
  const t = useTranslations('vocab');
  const total = Math.max(1, counts.total);
  const seg = (n: number) => `${Math.min(100, (n / total) * 100)}%`;
  const learning = Math.max(0, counts.enrolled - counts.new - counts.mastered);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={label}>
        <span className="h-full bg-accent" style={{ width: seg(counts.mastered) }} />
        <span className="h-full bg-navy dark:bg-primary" style={{ width: seg(learning) }} />
        <span className="h-full bg-muted-foreground/30" style={{ width: seg(counts.new) }} />
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <span>{t('progressMastered', { count: counts.mastered })}</span>
        <span>{t('progressLearning', { count: learning })}</span>
        <span>{t('progressNew', { count: counts.new })}</span>
        {counts.due ? <span className="font-semibold text-foreground">{t('progressDue', { count: counts.due })}</span> : null}
      </p>
    </div>
  );
}

export function VocabListCard({ list, compact = false }: { list: VocabList; compact?: boolean }) {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('vocab');
  const L = useLocalized();
  const router = useRouter();
  const enroll = useEnrollList(program);
  const [locked, setLocked] = React.useState(false);
  const title = L(list.title);
  const action = list.next_action_code;
  const reviewHref = href('vocab/review', `?list=${encodeURIComponent(list.id)}`);

  const onEnroll = () =>
    enroll.mutate(list.id, {
      onSuccess: (r) => {
        toast.success(t('enrolled', { added: r.added, existing: r.existing }), { description: r.new_per_day != null ? t('enrolledPerDay', { count: r.new_per_day }) : undefined });
      },
      onError: (e) => {
        if (getErrorStatus(e) === 403) setLocked(true);
        else toast.error(t('enrollFailed'));
      },
    });

  return (
    <Card className="h-full" data-testid={`vocab-list-${list.id}`} data-action={action}>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={href(`vocab/${list.id}`)} className="font-semibold hover:underline" data-testid="vocab-list-title">
              {title}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('words', { count: list.counts.total })}
              {list.kind === 'core' ? ` · ${t('kindCore')}` : ''}
            </p>
          </div>
          {list.is_free ? <Badge variant="outline">{t('free')}</Badge> : <Badge variant="gold">{t('pro')}</Badge>}
        </div>
        {list.enrolled ? <ListProgress counts={list.counts} label={t('progressLabel', { title })} /> : <p className="text-sm text-muted-foreground">{t('notEnrolled')}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {locked ? (
            <Link href={UPGRADE_HREF} className={buttonVariants({ variant: 'gold', size: 'sm' })}>
              <Lock aria-hidden />
              {t('lockedCta')}
            </Link>
          ) : action === 'enroll' ? (
            <Button variant="navy" size="sm" onClick={onEnroll} disabled={enroll.isPending} data-testid="vocab-enroll">
              {enroll.isPending ? <Spinner className="size-4" /> : <Plus aria-hidden />}
              {t('next_action.enroll')}
            </Button>
          ) : action === 'done' ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" aria-hidden />
              {t('next_action.done')}
            </span>
          ) : (
            <Button variant="gold" size="sm" onClick={() => router.push(reviewHref)} data-testid="vocab-start">
              <BookOpenCheck aria-hidden />
              {action === 'review' ? t('next_action.review', { count: list.counts.due }) : t('next_action.learn_new', { count: list.counts.new })}
            </Button>
          )}
          {!compact ? (
            <Link href={href(`vocab/${list.id}`)} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
              {t('viewWords')}
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
