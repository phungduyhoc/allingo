'use client';

import { ArrowRight, BarChart3 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Badge, buttonVariants, Card, CardContent, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useEntitlements, useMe, useMyAttempts, useStats, useTestSets } from '@/lib/queries';
import { useLocalized } from '@/lib/localized';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { Deferred } from '@/components/deferred';
import { PageHeader } from '@/components/page-header';
import { TestSetCard } from '@/features/test-sets/test-set-card';
import { StartAttemptDialog } from '@/features/test-sets/start-attempt-dialog';
import { useStartTestSet } from '@/features/test-sets/use-start-test-set';
import { QuotaLeft, ResetHint } from '@/features/quota/quota-ui';
import { quotaOf } from '@/lib/quota';
import { DashboardTutorCard } from '@/features/tutor/tutor-entry';
import { TodayCard } from '@/features/plan/today-card';
import { SurveyPrompts } from '@/features/surveys/survey-prompts';
import { AccuracyCard, CommunityCard, ErrorsToReviewCard, ForecastCard, KpiGrid, ScoreCard, VocabDueCard, WeekSummaryCard } from '@/features/stats/stats-cards';
import { useProgram, useProgramHref } from '@/features/program/program-context';

const SHOWN_QUOTAS = ['mini_test', 'part_drill', 'ai_explain', 'full_test'] as const;

/**
 * Dashboard (S10) – S11 (hiệu năng mobile): mỗi khối tự đăng ký query của mình (kết quả về chỉ dựng lại khối đó, không cả
 * trang), phần dưới màn hình đầu dựng khi trình duyệt rảnh (`Deferred` – transition, có khung chờ cùng kích thước).
 */
export function DashboardPage() {
  const href = useProgramHref();
  const t = useTranslations('dashboard');
  const tp = useTranslations('programs');
  const program = useProgram();
  return (
    <div className="space-y-8">
      <PageHeader
        title={t('title', { program: tp(program) })}
        description={<Greeting />}
        actions={
          <>
            <Link href={href('stats')} className={buttonVariants({ variant: 'ghost' })} data-testid="dashboard-stats-link">
              <BarChart3 aria-hidden />
              {t('statsLink')}
            </Link>
            <Link href={href('test-sets')} className={buttonVariants({ variant: 'outline' })}>
              {t('allTestSets')}
              <ArrowRight aria-hidden />
            </Link>
          </>
        }
      />

      {/* S12: NPS ngày 7/14 + nhắc khảo sát beta (trong luồng trang, dựng khi rảnh; không hiện khi Exam Mode) */}
      <Deferred fallback={null}>
        <SurveyPrompts />
      </Deferred>

      {/* Chỉ số chính (tiêu đề ẩn giữ thứ tự h1 → h2 → h3 của thẻ – Lighthouse a11y "heading-order") */}
      <h2 className="sr-only">{t('statsTitle')}</h2>
      <KpiSection />

      {/* min-w-0: cột lưới không bị nội dung một dòng dài (đề bài trong sổ lỗi, biểu đồ) kéo rộng hơn màn hình mobile */}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-6">
          <MiniTestsSection />
          {/* S10: điểm theo thời gian + độ chính xác theo Part (biểu đồ tải lười) */}
          <Deferred fallback={<CardSkeleton lines={5} />}>
            <ChartsSection />
          </Deferred>
        </div>

        <div className="min-w-0 space-y-6">
          <Deferred fallback={<CardSkeleton lines={3} />}>
            {/* Sprint 9: việc hôm nay của lộ trình (chưa có lộ trình → mời onboarding) */}
            <TodayCard />
          </Deferred>
          <Deferred fallback={<CardSkeleton lines={6} />} timeout={2000}>
            {/* S10: từ đến hạn, lỗi cần ôn, dự báo sơ bộ, so với cộng đồng, tóm tắt tuần */}
            <VocabDueCard />
            <ErrorsToReviewCard />
            <h2 className="sr-only">{t('insightsTitle')}</h2>
            <ForecastCard />
            <InsightsSection />
            {/* Sprint 6: gia sư AI (hội thoại tự do / tiếp tục thread cũ) */}
            <DashboardTutorCard />
            <QuotaSection />
            <HistorySection />
          </Deferred>
        </div>
      </div>
    </div>
  );
}

function Greeting() {
  const t = useTranslations('dashboard');
  const me = useMe();
  return me.data ? <>{t('greeting', { name: me.data.display_name })}</> : null;
}

function KpiSection() {
  const program = useProgram();
  const stats = useStats(program);
  if (stats.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} lines={2} />
        ))}
      </div>
    );
  }
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;
  return <KpiGrid stats={stats.data} />;
}

/** Làm đề mini (2 đề đầu) + hộp thoại bắt đầu */
function MiniTestsSection() {
  const program = useProgram();
  const href = useProgramHref();
  const t = useTranslations('dashboard');
  const miniSets = useTestSets(program, 'mini');
  const ctl = useStartTestSet();
  return (
    <section aria-labelledby="mini-title" className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="mini-title" className="text-lg font-semibold">
            {t('miniTestTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('miniTestDesc')}</p>
        </div>
        <Link href={href('test-sets', '?kind=mini')} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
          {t('miniTestCta')}
        </Link>
      </div>
      {miniSets.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : miniSets.isError ? (
        <ErrorState error={miniSets.error} onRetry={() => void miniSets.refetch()} />
      ) : miniSets.data.data.length === 0 ? (
        <EmptyState title={t('historyEmpty')} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {miniSets.data.data.slice(0, 2).map((s) => (
            <TestSetCard key={s.id} summary={s} compact onOpen={(x) => void ctl.open(x)} busy={ctl.checking === s.id} />
          ))}
        </div>
      )}
      {ctl.checkError ? <ErrorState error={ctl.checkError} /> : null}
      <StartAttemptDialog ctl={ctl} />
    </section>
  );
}

function ChartsSection() {
  const program = useProgram();
  const stats = useStats(program);
  if (!stats.data) return null;
  return (
    <>
      <ScoreCard stats={stats.data} />
      <AccuracyCard stats={stats.data} />
    </>
  );
}

function InsightsSection() {
  const program = useProgram();
  const stats = useStats(program);
  if (!stats.data) return null;
  return (
    <>
      <CommunityCard stats={stats.data} />
      <WeekSummaryCard stats={stats.data} />
    </>
  );
}

function QuotaSection() {
  const program = useProgram();
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const ent = useEntitlements(program);
  return (
    <section aria-labelledby="quota-title" className="space-y-3">
      <h2 id="quota-title" className="text-lg font-semibold">
        {t('quotaTitle')}
      </h2>
      {ent.isPending ? (
        <CardSkeleton lines={4} />
      ) : ent.isError ? (
        <ErrorState error={ent.error} onRetry={() => void ent.refetch()} />
      ) : (
        <Card>
          <CardContent className="space-y-4">
            {/* Sprint 5: số lượt còn lại + giờ reset (giờ VN) do API trả – chỉ hiển thị, server mới kiểm tra hạn mức */}
            <QuotaLeft feature="ai_explain" bar />
            {SHOWN_QUOTAS.filter((f) => f !== 'ai_explain')
              .map((f) => quotaOf(ent.data, f))
              .filter((q): q is NonNullable<typeof q> => q !== null)
              .map((q) => {
                const pct = q.limit && q.remaining !== null ? (q.remaining / q.limit) * 100 : 100;
                return (
                  <div key={`${q.feature}-${q.period}`} className="space-y-1.5" data-testid={`quota-${q.feature}`} data-remaining={q.remaining ?? ''}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{t(`quotaFeature.${q.feature}`)}</span>
                      <span className="tabular text-muted-foreground">
                        {q.remaining === null ? t('quotaUnlimited') : t('quotaRemaining', { remaining: q.remaining, limit: q.limit ?? 0 })}
                      </span>
                    </div>
                    <Progress value={pct} tone={pct < 34 ? 'gold' : 'primary'} label={t(`quotaFeature.${q.feature}`)} />
                    {q.remaining !== null ? <ResetHint iso={q.resetAt} className="block text-xs text-muted-foreground" /> : null}
                  </div>
                );
              })}
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">{t('quotaCredits', { count: ent.data.credits })}</span>
              {ent.data.is_pro ? <Badge variant="gold">{tc('pro')}</Badge> : <Badge variant="outline">{tc('free')}</Badge>}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function HistorySection() {
  const program = useProgram();
  const t = useTranslations('dashboard');
  const attempts = useMyAttempts(program);
  const L = useLocalized();
  const fmt = useFormatter();
  return (
    <section aria-labelledby="history-title" className="space-y-3">
      <h2 id="history-title" className="text-lg font-semibold">
        {t('historyTitle')}
      </h2>
      {attempts.isPending ? (
        <CardSkeleton lines={4} />
      ) : attempts.isError ? (
        <ErrorState error={attempts.error} onRetry={() => void attempts.refetch()} />
      ) : attempts.data.data.length === 0 ? (
        <EmptyState title={t('historyEmpty')} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" data-testid="attempt-history">
          {attempts.data.data.slice(0, 6).map((a) => {
            const inProgress = a.status === 'in_progress';
            return (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.test_set_title ? L(a.test_set_title) : a.id.slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`mode.${a.mode}`)} · {fmt.dateTime(new Date(a.submitted_at ?? a.started_at), { dateStyle: 'medium' })}
                    {inProgress ? ` · ${t('historyInProgress')}` : a.scaled_score !== null ? ` · ${t('historyScore', { score: a.scaled_score })}` : ''}
                  </p>
                </div>
                <Link href={inProgress ? `/attempts/${a.id}` : `/attempts/${a.id}/result`} className={buttonVariants({ variant: inProgress ? 'gold' : 'ghost', size: 'sm' })}>
                  {inProgress ? t('historyContinue') : t('historyViewResult')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
