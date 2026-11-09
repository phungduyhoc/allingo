'use client';

import { ArrowLeft } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { buttonVariants, Card, CardContent } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, ErrorState } from '@/components/states';
import { useStats } from '@/lib/queries';

import { AccuracyCard, CommunityCard, ForecastCard, KpiGrid, MinutesCard, ScoreCard, WeekSummaryCard } from './stats-cards';
import { useProgram, useProgramHref } from '@/features/program/program-context';

/**
 * Thống kê chi tiết `/toeic/stats` (S10): KPI, điểm theo thời gian, độ chính xác theo Part + kỹ năng con (30 ngày vs trước),
 * phút học/tuần (8 tuần), từ vựng, lỗi theo loại, so với cộng đồng, dự báo sơ bộ. `GET /me/stats` cache ≤ 1 giờ ở server
 * (xoá khi có bài chấm/ôn thẻ/sửa sổ lỗi) – hiện thời điểm tính.
 */
export function StatsPage() {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('stats');
  const te = useTranslations('errorLog');
  const fmt = useFormatter();
  const stats = useStats(program);

  return (
    <div className="space-y-8" data-testid="stats-page">
      <PageHeader
        title={t('title')}
        description={stats.data?.generated_at ? t('generatedAt', { at: fmt.dateTime(new Date(stats.data.generated_at), { dateStyle: 'medium', timeStyle: 'short' }) }) : t('desc')}
        actions={
          <Link href={href('dashboard')} className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeft aria-hidden />
            {t('backDashboard')}
          </Link>
        }
      />
      {stats.isPending ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <>
          <h2 className="sr-only">{t('kpiTitle')}</h2>
          <KpiGrid stats={stats.data} />
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-6">
              <ScoreCard stats={stats.data} />
              <AccuracyCard stats={stats.data} subskills />
              <MinutesCard stats={stats.data} />
            </div>
            <div className="space-y-6">
              <h2 className="sr-only">{t('insightsTitle')}</h2>
              <ForecastCard />
              <CommunityCard stats={stats.data} />
              <WeekSummaryCard stats={stats.data} />
              <Card>
                <CardContent className="space-y-3">
                  <h3 className="text-sm font-semibold">{t('vocabBreakdown')}</h3>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {(['total', 'new', 'learning', 'mastered', 'due_today', 'reviews_7d'] as const).map((k) => (
                      <div key={k}>
                        <dt className="text-xs text-muted-foreground">{t(`vocab.${k}`)}</dt>
                        <dd className="tabular text-lg font-bold">{stats.data.vocab?.[k] ?? 0}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="space-y-3">
                  <h3 className="text-sm font-semibold">{t('errorsByKind')}</h3>
                  {Object.keys(stats.data.errors?.by_kind ?? {}).length ? (
                    <ul className="space-y-1 text-sm" data-testid="stats-errors-by-kind">
                      {Object.entries(stats.data.errors?.by_kind ?? {})
                        .sort((a, b) => b[1] - a[1])
                        .map(([k, n]) => (
                          <li key={k} className="flex justify-between gap-2">
                            <span>{te.has(`kind.${k}` as never) ? te(`kind.${k}` as never) : k}</span>
                            <span className="tabular font-semibold">{n}</span>
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">{te('none')}</p>
                  )}
                  <Link href={href('errors')} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    {t('errorsCta')}
                  </Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
