'use client';

import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookA, Flame, Gauge, NotebookPen, Sparkles, Target, Timer, TrendingUp, Users } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { Forecast, Stats } from '@allingo/schemas';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { CardSkeleton, ErrorState } from '@/components/states';
import { getErrors, getForecast } from '@/lib/s10-api';
import { PROGRAM } from '@/features/plan/queries';
import { useSrsCounts } from '@/features/flashcards/queries';
import { accuracyRows, forecastView, latestSkillScore, percentileValue, scoreSeries, weekSeries, weekSummary } from './stats-model';

// Biểu đồ tải lười: recharts không vào JS trang đầu (chunk riêng, chỉ phía client)
const chartLoading = () => <Skeleton className="h-56 w-full" />;
const ScoreChart = dynamic(() => import('./charts').then((m) => m.ScoreChart), { ssr: false, loading: chartLoading });
const AccuracyChart = dynamic(() => import('./charts').then((m) => m.AccuracyChart), { ssr: false, loading: chartLoading });
const MinutesChart = dynamic(() => import('./charts').then((m) => m.MinutesChart), { ssr: false, loading: () => <Skeleton className="h-44 w-full" /> });

export const forecastKey = (program: string) => ['me', 'forecast', program] as const;

export function useForecast(program = PROGRAM) {
  return useQuery<Forecast, Error>({ queryKey: forecastKey(program), queryFn: () => getForecast(program), staleTime: 5 * 60_000 });
}

function Kpi({ title, icon: Icon, children, hint, testId, accent }: { title: string; icon: typeof Target; children: React.ReactNode; hint?: React.ReactNode; testId?: string; accent?: boolean }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('size-4', accent ? 'text-accent' : 'text-muted-foreground')} aria-hidden />
      </CardHeader>
      <CardContent>
        <div className="tabular text-3xl font-extrabold tracking-tight">{children}</div>
        {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Thẻ KPI: điểm ước tính, chuỗi ngày, XP, phút tuần này, từ đã thuộc, lỗi chưa hiểu */
export function KpiGrid({ stats }: { stats: Stats }) {
  const t = useTranslations('dashboard');
  const ts = useTranslations('stats');
  const tc = useTranslations('common');
  const fmt = useFormatter();
  const latestSkill = stats.current_estimate === null ? latestSkillScore(stats) : null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi title={t('estimateTitle')} icon={Target} hint={stats.target !== null ? t('estimateTarget', { target: stats.target }) : t('estimateNoTarget')}>
        {stats.current_estimate !== null ? (
          <span className="flex items-baseline gap-2">
            <span className="text-navy dark:text-foreground" data-testid="estimate">
              {stats.current_estimate}
            </span>
            <Badge variant="gold">{tc('estimated')}</Badge>
          </span>
        ) : latestSkill ? (
          // S12 (SPEC-ISSUES S142): sau đề mini một kỹ năng – hiện điểm kỹ năng đó + nói rõ cần đề L&R để có điểm tổng
          <span className="block space-y-1" data-testid="estimate-skill">
            <span className="block text-base leading-snug font-bold text-navy dark:text-foreground">{t('estimateSkillOnly', { part: latestSkill.part, score: latestSkill.score })}</span>
            <span className="block text-xs leading-snug font-normal text-muted-foreground">{t('estimateNeedsBoth')}</span>
          </span>
        ) : (
          <span className="block text-sm leading-snug font-medium text-muted-foreground" data-testid="estimate-none">
            {t('estimateNone')}
          </span>
        )}
      </Kpi>
      <Kpi title={t('streakTitle')} icon={Flame} accent={stats.streak.current > 0} hint={t('streakLongest', { count: stats.streak.longest })} testId="kpi-streak">
        {t('streakDays', { count: stats.streak.current })}
      </Kpi>
      <Kpi title={t('xpTitle')} icon={Sparkles} hint={t('xpThisWeek', { count: stats.xp.this_week })} testId="kpi-xp">
        {fmt.number(stats.xp.total)}
      </Kpi>
      <Kpi title={ts('kpiMinutes')} icon={Timer} hint={ts('kpiMinutesHint')} testId="kpi-minutes">
        {/* Cùng nguồn với biểu đồ phút/tuần (bài làm + ôn thẻ); API cũ thiếu minutes_by_week → minutes_this_week */}
        {weekSummary(stats).minutes}
      </Kpi>
      <Kpi title={ts('kpiVocab')} icon={BookA} hint={ts('kpiVocabHint', { learning: stats.vocab?.learning ?? 0, due: stats.vocab?.due_today ?? 0 })} testId="kpi-vocab">
        {stats.vocab?.mastered ?? 0}
      </Kpi>
      <Kpi title={ts('kpiErrors')} icon={NotebookPen} hint={ts('kpiErrorsHint', { count: stats.errors?.resolved ?? 0 })} testId="kpi-errors">
        {stats.errors?.open ?? 0}
      </Kpi>
    </div>
  );
}

/** Điểm theo thời gian (biểu đồ + bảng ẩn cho trình đọc màn hình) */
export function ScoreCard({ stats, className }: { stats: Stats; className?: string }) {
  const t = useTranslations('stats');
  const fmt = useFormatter();
  const series = scoreSeries(stats);
  // Thang TOEIC L&R 10–990 (đề mini một kỹ năng 5–495 vẫn nằm trong trục)
  const max = 990;
  return (
    <section aria-labelledby="score-title" className={cn('space-y-3', className)}>
      <h2 id="score-title" className="text-lg font-semibold">
        {t('scoreTitle')}
      </h2>
      <Card>
        <CardContent>
          {series.length >= 2 ? (
            <>
              <ScoreChart data={series} target={stats.target} max={max} />
              <table className="sr-only">
                <caption>{t('scoreTitle')}</caption>
                <tbody>
                  {series.map((p) => (
                    <tr key={p.at}>
                      <td>{fmt.dateTime(new Date(p.at), { dateStyle: 'medium' })}</td>
                      <td>{p.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground" data-testid="score-empty">
              {series.length === 1 ? t('scoreOne', { score: series[0]!.score }) : t('scoreEmpty')}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** Độ chính xác theo Part: 30 ngày gần nhất vs 30 ngày trước */
export function AccuracyCard({ stats, className, subskills = false }: { stats: Stats; className?: string; subskills?: boolean }) {
  const t = useTranslations('stats');
  const tsec = useTranslations('sections');
  const tsub = useTranslations('result.subskills');
  const rows = accuracyRows(stats.accuracy?.by_section);
  const subRows = subskills ? accuracyRows(stats.accuracy?.by_subskill, 'total') : [];
  const partLabel = (k: string) => (tsec.has(k as never) ? tsec(k as never).split(' · ')[0]! : k);
  const window = stats.accuracy?.window_days ?? 30;
  return (
    <section aria-labelledby="accuracy-title" className={cn('space-y-3', className)}>
      <h2 id="accuracy-title" className="text-lg font-semibold">
        {t('accuracyTitle', { days: window })}
      </h2>
      <Card>
        <CardContent className="space-y-4">
          {rows.length ? (
            <>
              <AccuracyChart rows={rows} label={partLabel} />
              <AccuracyTable rows={rows} label={(k) => (tsec.has(k as never) ? tsec(k as never) : k)} testId="accuracy-table" />
            </>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('accuracyEmpty')}</p>
          )}
          {subRows.length ? (
            <div className="space-y-2 border-t border-border pt-4">
              <h3 className="text-sm font-semibold">{t('subskillTitle')}</h3>
              <AccuracyTable rows={subRows.slice(0, 12)} label={(k) => (tsub.has(k as never) ? tsub(k as never) : k)} testId="subskill-table" />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function AccuracyTable({ rows, label, testId }: { rows: ReturnType<typeof accuracyRows>; label: (k: string) => string; testId: string }) {
  const t = useTranslations('stats');
  const p = (v: number | null) => (v === null ? '—' : `${v}%`);
  return (
    <table className="w-full text-sm" data-testid={testId}>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 font-medium">{t('colPart')}</th>
          <th className="py-1 text-right font-medium">{t('periodCurrent')}</th>
          <th className="py-1 text-right font-medium">{t('periodPrevious')}</th>
          <th className="py-1 text-right font-medium">{t('colDelta')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r) => (
          <tr key={r.key} data-key={r.key}>
            <td className="py-1.5">{label(r.key)}</td>
            <td className="tabular py-1.5 text-right font-semibold">{p(r.current)}</td>
            <td className="tabular py-1.5 text-right text-muted-foreground">{p(r.previous)}</td>
            <td className={cn('tabular py-1.5 text-right', r.delta === null ? 'text-muted-foreground' : r.delta >= 0 ? 'text-success' : 'text-destructive')}>{r.delta === null ? '—' : `${r.delta > 0 ? '+' : ''}${r.delta}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MinutesCard({ stats, className }: { stats: Stats; className?: string }) {
  const t = useTranslations('stats');
  const data = weekSeries(stats);
  return (
    <section aria-labelledby="minutes-title" className={cn('space-y-3', className)}>
      <h2 id="minutes-title" className="text-lg font-semibold">
        {t('minutesTitle')}
      </h2>
      <Card>
        <CardContent>
          {data.some((w) => w.minutes > 0) ? <MinutesChart data={data} /> : <p className="py-6 text-center text-sm text-muted-foreground">{t('minutesEmpty')}</p>}
        </CardContent>
      </Card>
    </section>
  );
}

/** So với cộng đồng cùng mục tiêu (ẩn danh, ≥ 10 người) – lý do khi chưa đủ dữ liệu */
export function CommunityCard({ stats }: { stats: Stats }) {
  const t = useTranslations('stats');
  const c = stats.community;
  const v = percentileValue(c);
  return (
    <Card data-testid="community-card" data-reason={c?.reason ?? 'none'}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('communityTitle')}</CardTitle>
        <Users className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="space-y-1.5">
        {v !== null ? (
          <>
            <p className="tabular text-3xl font-extrabold tracking-tight" data-testid="percentile">
              {t('percentile', { value: v })}
            </p>
            <p className="text-xs text-muted-foreground">{t('communityOk', { size: c?.cohort_size ?? 0, bucket: c?.target_bucket ?? '—' })}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t(`communityReason.${c?.reason ?? 'no_estimate'}`, { size: c?.cohort_size ?? 0 })}</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Dự báo v0 (hồi quy tuyến tính) – luôn gắn nhãn "ước tính sơ bộ" */
export function ForecastCard() {
  const t = useTranslations('stats');
  const tf = useTranslations('forecast');
  const fmt = useFormatter();
  const f = useForecast();
  return (
    <Card data-testid="forecast-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('forecastTitle')}</CardTitle>
        <TrendingUp className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent className="space-y-2">
        {f.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : f.isError ? (
          <ErrorState error={f.error} onRetry={() => void f.refetch()} className="py-4" />
        ) : (
          (() => {
            const v = forecastView(f.data);
            const label = (
              <Badge variant="gold" data-testid="forecast-label">
                {tf(`label.${f.data.label}`)}
              </Badge>
            );
            if (v.kind === 'insufficient')
              return (
                <>
                  {label}
                  <p className="text-sm text-muted-foreground" data-testid="forecast-recommendation">
                    {tf.has(`recommendation.${v.code}` as never) ? tf(`recommendation.${v.code}` as never) : f.data.recommendation}
                  </p>
                </>
              );
            return (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="tabular text-3xl font-extrabold tracking-tight" data-testid="forecast-score">
                    {v.predicted}
                  </span>
                  {v.low !== null && v.high !== null ? <span className="tabular text-sm text-muted-foreground">{tf('range', { low: v.low, high: v.high })}</span> : null}
                  {label}
                </div>
                <p className="text-xs text-muted-foreground">{tf('horizon', { date: fmt.dateTime(new Date(v.horizon), { dateStyle: 'medium' }) })}</p>
                {v.onTrack !== null ? (
                  <p className={cn('text-sm font-medium', v.onTrack ? 'text-success' : 'text-destructive')}>{v.onTrack ? tf('onTrack') : tf('offTrack', { target: v.target ?? 0 })}</p>
                ) : null}
                <p className="text-sm text-muted-foreground" data-testid="forecast-recommendation">
                  {tf.has(`recommendation.${v.code}` as never) ? tf(`recommendation.${v.code}` as never) : f.data.recommendation}
                </p>
              </>
            );
          })()
        )}
      </CardContent>
    </Card>
  );
}

/** Lỗi cần ôn: 3 lỗi chưa hiểu cũ nhất + "Làm lại" → sổ lỗi */
export function ErrorsToReviewCard() {
  const t = useTranslations('stats');
  const te = useTranslations('errorLog');
  const tsec = useTranslations('sections');
  const q = useQuery({ queryKey: ['me', 'errors', PROGRAM, 'dashboard'], queryFn: () => getErrors({ program: PROGRAM, status: 'open', sort: 'oldest', days: 0, limit: 3 }) });
  return (
    <section aria-labelledby="errors-due-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 id="errors-due-title" className="text-lg font-semibold">
          {t('errorsTitle')}
        </h2>
        <Link href="/toeic/errors" className={buttonVariants({ variant: 'ghost', size: 'sm' })} data-testid="dashboard-errors-link">
          {t('errorsCta')}
          <ArrowRight aria-hidden />
        </Link>
      </div>
      {q.isPending ? (
        <CardSkeleton lines={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Card data-testid="dashboard-errors">
          <CardContent className="space-y-3">
            <p className="text-sm">
              <span className="tabular text-2xl font-extrabold">{q.data.totals.open}</span> <span className="text-muted-foreground">{t('errorsOpen')}</span>
            </p>
            {q.data.data.length ? (
              <ul className="divide-y divide-border text-sm">
                {q.data.data.map((e) => {
                  const stem = typeof (e.question?.content as { stem?: unknown } | undefined)?.stem === 'string' ? ((e.question!.content as { stem: string }).stem || null) : null;
                  return (
                    <li key={e.id} className="flex items-center gap-2 py-2">
                      <Badge variant="outline">{te(`kind.${e.kind}`)}</Badge>
                      <span className="min-w-0 truncate">{stem ?? (e.section_code && tsec.has(e.section_code as never) ? tsec(e.section_code as never) : e.section_code)}</span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t('errorsNone')}</p>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/** Từ đến hạn hôm nay + thẻ mới còn trong hạn mức → bắt đầu phiên ôn */
export function VocabDueCard() {
  const t = useTranslations('stats');
  const q = useSrsCounts(PROGRAM);
  const c = q.data?.counts;
  const fresh = c ? Math.min(c.new_remaining ?? c.new_total, c.new_total) : 0;
  return (
    <section aria-labelledby="vocab-due-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 id="vocab-due-title" className="text-lg font-semibold">
          {t('vocabTitle')}
        </h2>
        <Link href="/toeic/vocab" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          {t('vocabLists')}
          <ArrowRight aria-hidden />
        </Link>
      </div>
      {q.isPending ? (
        <CardSkeleton lines={2} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <Card data-testid="dashboard-vocab">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <span className="tabular text-2xl font-extrabold" data-testid="dashboard-vocab-due">
                {c?.due_now ?? 0}
              </span>{' '}
              <span className="text-muted-foreground">{t('vocabDue')}</span>
              <span className="mx-2 text-muted-foreground">·</span>
              <span className="tabular font-semibold">{fresh}</span> <span className="text-muted-foreground">{t('vocabNew')}</span>
            </p>
            <Link href={(c?.due_now ?? 0) + fresh > 0 ? '/toeic/vocab/review' : '/toeic/vocab'} className={buttonVariants({ variant: (c?.due_now ?? 0) + fresh > 0 ? 'gold' : 'outline', size: 'sm' })} data-testid="dashboard-vocab-start">
              {(c?.due_now ?? 0) + fresh > 0 ? t('vocabStart') : t('vocabAdd')}
            </Link>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/** Tóm tắt tuần (dựng từ thống kê – API chưa có endpoint đọc notes system_summary) */
export function WeekSummaryCard({ stats }: { stats: Stats }) {
  const t = useTranslations('stats');
  const s = weekSummary(stats);
  return (
    <Card data-testid="week-summary">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('weekTitle')}</CardTitle>
        <Gauge className="size-4 text-muted-foreground" aria-hidden />
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-relaxed">
          {t('weekBody', { minutes: s.minutes, attempts: s.attempts, reviews: s.reviews, xp: s.xp })}{' '}
          {s.minutesDelta !== null && s.minutesDelta !== 0 ? <span className={s.minutesDelta > 0 ? 'text-success' : 'text-destructive'}>{t('weekDelta', { delta: s.minutesDelta })}</span> : null}
        </p>
        {s.errorsOpen ? <p className="mt-1 text-xs text-muted-foreground">{t('weekErrors', { count: s.errorsOpen })}</p> : null}
      </CardContent>
    </Card>
  );
}
