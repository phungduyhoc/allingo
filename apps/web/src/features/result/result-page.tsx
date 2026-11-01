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

const SectionChart = dynamic(() => import('./section-chart'), { ssr: false, loading: () => <Skeleton className="h-56 w-full" /> });

const SECTION_KEYS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7', 'listening', 'reading'] as const;

export function ResultPage({ attemptId }: { attemptId: string }) {
  const t = useTranslations('result');
  const ts = useTranslations('sections');
  const tc = useTranslations('common');
  const tq = useTranslations('questionTypes');
  const result = useAttemptResult(attemptId);

  const sectionData = React.useMemo(() => {
    if (!result.data) return [];
    return Object.entries(result.data.by_section).map(([code, s]) => ({
      code,
      label: (SECTION_KEYS as readonly string[]).includes(code) ? ts(code as (typeof SECTION_KEYS)[number]).split(' · ')[0]! : code,
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
  if (result.isError) return <ErrorState error={result.error} title={t('loadError')} onRetry={() => void result.refetch()} />;

  const r = result.data;
  const total = Object.values(r.by_section).reduce((s, x) => s + x.total, 0);
  const unanswered = typeof r.scale.unanswered === 'number' ? r.scale.unanswered : null;
  const delta = r.compared_to_previous?.scaled_delta ?? null;

  return (
    <div className="space-y-8" data-testid="result-page">
      <PageHeader
        title={t('title')}
        actions={
          <>
            <Link href={`/attempts/${attemptId}/review`} className={buttonVariants({ variant: 'navy' })} data-testid="review-link">
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
            {unanswered !== null && unanswered > 0 ? <p className="mt-2 text-xs text-muted-foreground">{t('unanswered', { count: unanswered })}</p> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('comparedTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {r.compared_to_previous ? (
              <div className={cn('flex items-center gap-2 text-2xl font-bold', delta !== null && delta > 0 && 'text-success', delta !== null && delta < 0 && 'text-destructive')}>
                {delta === null || delta === 0 ? <Minus aria-hidden /> : delta > 0 ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
                {delta === null || delta === 0 ? t('comparedSame') : delta > 0 ? t('comparedUp', { delta }) : t('comparedDown', { delta: Math.abs(delta) })}
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

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t('bySection')}</CardTitle>
          </CardHeader>
          <CardContent>
            <SectionChart data={sectionData} />
            <ul className="mt-4 divide-y divide-border text-sm">
              {sectionData.map((s) => (
                <li key={s.code} className="flex items-center justify-between py-2">
                  <span>{(SECTION_KEYS as readonly string[]).includes(s.code) ? ts(s.code as (typeof SECTION_KEYS)[number]) : s.code}</span>
                  <span className="tabular font-semibold">{t('rawOf', { correct: s.correct, total: s.correct + s.wrong })}</span>
                </li>
              ))}
            </ul>
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
