'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ArrowDownRight, ArrowUpRight, Minus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useAttemptResult } from '@/lib/queries';
import { CardSkeleton, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { DiagnosisCard } from './diagnosis-card';
import { AiDiagnosisCard } from './ai-diagnosis-card';
import { parseDiagnosis, scaleView } from './diagnosis';
import { parseScaled, ScaledScores } from './scaled-scores';
import { recordViewed } from '@/features/offline/viewed-store';

const SectionChart = dynamic(() => import('./section-chart'), {
  ssr: false,
  loading: () => <Skeleton className="h-56 w-full" />,
});

const SECTION_KEYS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7', 'listening', 'reading'] as const;
const SKILL_OF_PART: Record<string, 'listening' | 'reading'> = {
  part1: 'listening',
  part2: 'listening',
  part3: 'listening',
  part4: 'listening',
  part5: 'reading',
  part6: 'reading',
  part7: 'reading',
};

export function ResultPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('result');
  const ts = useTranslations('sections');
  const tc = useTranslations('common');
  const tq = useTranslations('questionTypes');
  const result = useAttemptResult(attemptId);
  // "Đề đã xem" cho trang offline (giữ tên đề đã biết từ lúc làm bài)
  React.useEffect(() => {
    recordViewed({ id: attemptId, kind: 'result', title: null, href: `/attempts/${attemptId}/result` });
  }, [attemptId]);

  const sectionData = React.useMemo(() => {
    if (!result.data) return [];
    return Object.entries(result.data.by_section)
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([code, s]) => ({
        code,
        label: (SECTION_KEYS as readonly string[]).includes(code)
          ? ts(code as (typeof SECTION_KEYS)[number]).split(' · ')[0]!
          : code,
        correct: s.correct,
        wrong: s.total - s.correct,
      }));
  }, [result.data, ts]);

  if (result.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
          <CardSkeleton lines={2} />
        </div>
        <CardSkeleton lines={6} />
      </div>
    );
  }
  if (result.isError)
    return <ErrorState error={result.error} title={t('loadError')} onRetry={() => void result.refetch()} />;

  const r = result.data;
  const total = Object.values(r.by_section).reduce((s, x) => s + x.total, 0);
  const diagnosis = parseDiagnosis(r.diagnosis);
  const unanswered = diagnosis
    ? diagnosis.unanswered
    : typeof r.scale.unanswered === 'number'
      ? r.scale.unanswered
      : null;
  const scale = scaleView(r);
  const delta = r.compared_to_previous?.scaled_delta ?? null;
  const scaled = parseScaled(r.scaled);
  // Breakdown Part 1–7 nhóm theo kỹ năng (TOEIC) – kỹ năng có trong bài mới hiện tiêu đề nhóm
  const skillGroups = (['listening', 'reading'] as const)
    .map((skill) => ({
      skill,
      parts: sectionData.filter((s) => SKILL_OF_PART[s.code] === skill),
      stats: r.by_skill?.[skill],
    }))
    .filter((g) => g.parts.length > 0);
  const otherParts = sectionData.filter((s) => !SKILL_OF_PART[s.code]);

  return (
    <div className="space-y-8" data-testid="result-page">
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Link
              href={`/attempts/${attemptId}/review`}
              className={buttonVariants({ variant: 'navy' })}
              data-testid="review-link"
            >
              {t('review')}
            </Link>
            <Link href="/toeic/dashboard" className={buttonVariants({ variant: 'outline' })}>
              {t('backToDashboard')}
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-navy text-navy-foreground sm:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-white/70">{t('scaledScore')}</CardTitle>
          </CardHeader>
          <CardContent>
            {r.scaled_score !== null ? (
              <div className="flex items-baseline gap-2">
                <span className="tabular text-5xl font-extrabold tracking-tight text-accent" data-testid="scaled-score">
                  {r.scaled_score}
                </span>
                <Badge variant="gold">{tc('estimated')}</Badge>
              </div>
            ) : (
              <p className="text-sm text-white/80">{t('scaledUnavailable')}</p>
            )}
            {r.scaled_score !== null && scale ? (
              <p className="mt-2 text-sm font-medium text-white/90" data-testid="scale-range">
                {scale.kind === 'total'
                  ? t('scaleRangeTotal', { min: scale.min, max: scale.max })
                  : t('scaleRangeSkill', { skill: ts(scale.skill ?? 'reading'), min: scale.min, max: scale.max })}
              </p>
            ) : null}
            {scaled?.range ? (
              <p className="tabular mt-1 text-sm text-white/90" data-testid="score-range">
                {t('rangeEstimate', { low: scaled.range.low, high: scaled.range.high })}
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-white/70">{t('estimatedNote')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('rawScore')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="tabular text-4xl font-extrabold tracking-tight" data-testid="raw-score">
              {t('rawOf', { correct: r.raw_score, total })}
            </div>
            {unanswered !== null && unanswered > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">{t('unanswered', { count: unanswered })}</p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('comparedTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {r.compared_to_previous ? (
              <div
                className={cn(
                  'flex items-center gap-2 text-2xl font-bold',
                  delta !== null && delta > 0 && 'text-success',
                  delta !== null && delta < 0 && 'text-destructive',
                )}
              >
                {delta === null || delta === 0 ? (
                  <Minus aria-hidden />
                ) : delta > 0 ? (
                  <ArrowUpRight aria-hidden />
                ) : (
                  <ArrowDownRight aria-hidden />
                )}
                {delta === null || delta === 0
                  ? t('comparedSame')
                  : delta > 0
                    ? t('comparedUp', { delta })
                    : t('comparedDown', { delta: Math.abs(delta) })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t('comparedFirst')}</p>
            )}
            <p className="mt-3 inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-sm font-semibold text-accent-foreground dark:text-accent">
              <Sparkles className="size-3.5" aria-hidden />
              {t('xpEarned', { count: r.xp_earned })}
            </p>
          </CardContent>
        </Card>
      </div>

      <ScaledScores result={r} />

      {diagnosis ? <DiagnosisCard diagnosis={diagnosis} /> : null}

      {/* Sprint 5: phân tích AI (Pro) – bổ sung, không thay khối chẩn đoán theo quy tắc ở trên */}
      <AiDiagnosisCard attemptId={attemptId} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('bySection')}</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionChart data={sectionData} />
            <div className="mt-4 space-y-4 text-sm" data-testid="part-breakdown">
              {[
                ...skillGroups,
                ...(otherParts.length ? [{ skill: null, parts: otherParts, stats: undefined }] : []),
              ].map((g) => (
                <div key={g.skill ?? 'other'}>
                  {g.skill && skillGroups.length > 1 ? (
                    <p
                      className="flex items-center justify-between border-b border-border pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                      data-testid={`breakdown-${g.skill}`}
                    >
                      <span>{ts(g.skill)}</span>
                      {g.stats ? (
                        <span className="tabular">
                          {t('rawOf', { correct: g.stats.correct, total: g.stats.total })}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  <ul className="divide-y divide-border">
                    {g.parts.map((s) => (
                      <li
                        key={s.code}
                        className="flex items-center justify-between py-2"
                        data-testid={`breakdown-${s.code}`}
                      >
                        <span>
                          {(SECTION_KEYS as readonly string[]).includes(s.code)
                            ? ts(s.code as (typeof SECTION_KEYS)[number])
                            : s.code}
                        </span>
                        <span className="tabular font-semibold">
                          {t('rawOf', { correct: s.correct, total: s.correct + s.wrong })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('byQuestionType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {Object.entries(r.by_question_type).map(([type, s]) => (
                <li key={type} className="flex items-center justify-between py-2">
                  <span>{tq.has(type as never) ? tq(type as never) : type}</span>
                  <span className="tabular font-semibold">{t('rawOf', { correct: s.correct, total: s.total })}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
