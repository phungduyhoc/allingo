'use client';

import * as React from 'react';
import { ArrowRight, Info, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DiagnosticResult } from '@allingo/schemas/api/learning-plan';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Progress, Spinner } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { getErrorCode } from '@/lib/errors';
import { PageHeader } from '@/components/page-header';
import { useCreatePlan } from '@/features/plan/queries';
import { clearDraft, loadDraft, toPlanInput, type OnboardingDraft } from '@/features/onboarding/onboarding-store';
import { pct } from '@/features/plan/progress';

/**
 * Kết quả chẩn đoán (ước tính, luôn kèm khoảng): Tổng ± khoảng, Listening/Reading, mastery theo kỹ năng con, mục tiêu khả thi +
 * lý do. Có nháp onboarding → chọn mục tiêu (giữ mong muốn / dùng gợi ý khả thi) → POST /me/plan → /toeic/plan.
 */
export function DiagnosticResultView({ result, fromOnboarding }: { result: DiagnosticResult; fromOnboarding: boolean }) {
  const t = useTranslations('diagnostic');
  const tr = useTranslations('result');
  const te = useTranslations('errors');
  const router = useRouter();
  const create = useCreatePlan();
  // Chỉ dựng ở client (sau khi bài chẩn đoán trả kết quả) → đọc nháp onboarding ngay khi khởi tạo
  const [draft] = React.useState<OnboardingDraft | null>(() => (typeof window === 'undefined' ? null : loadDraft()));
  const e = result.estimate;
  const target = result.target;
  const desired = target.desired ?? draft?.target_score ?? null;
  const [choice, setChoice] = React.useState<'desired' | 'suggested'>(target.feasible === false || desired === null ? 'suggested' : 'desired');
  const chosenScore = choice === 'desired' && desired !== null ? desired : target.suggested;

  const bySkill = (['listening', 'reading'] as const).map((skill) => ({ skill, items: result.mastery.filter((m) => m.skill === skill).sort((a, b) => a.mastery - b.mastery) }));
  const other = result.mastery.filter((m) => m.skill !== 'listening' && m.skill !== 'reading');
  const subLabel = (code: string) => (tr.has(`subskills.${code}`) ? tr(`subskills.${code}`) : code.replace(/_/g, ' '));

  const reasonValues = { suggested: target.suggested, desired: desired ?? target.suggested, weeks: target.weeks_left, hours: Math.round((target.weekly_minutes / 60) * 10) / 10, required: target.required_weekly_minutes !== null ? Math.round((target.required_weekly_minutes / 60) * 10) / 10 : 0 };

  const createPlan = () => {
    if (!draft) return;
    create.mutate(toPlanInput(draft, chosenScore), {
      onSuccess: () => {
        clearDraft();
        router.push('/toeic/plan?created=1');
      },
    });
  };

  return (
    <div className="space-y-8" data-testid="diagnostic-result">
      <PageHeader title={t('resultTitle')} description={t('resultDesc', { count: e.answered })} />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="bg-navy text-navy-foreground">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-white/70">{tr('skillTotal')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="tabular text-5xl font-extrabold tracking-tight text-accent" data-testid="diagnostic-score">
                {e.score ?? '–'}
              </span>
              <Badge variant="gold">{t('estimated')}</Badge>
            </div>
            {e.low !== null && e.high !== null ? (
              <p className="tabular mt-2 text-sm text-white/90" data-testid="diagnostic-range">
                {t('range', { low: e.low, high: e.high })}
              </p>
            ) : null}
          </CardContent>
        </Card>
        {(['listening', 'reading'] as const).map((skill) => {
          const s = e[skill];
          return (
            <Card key={skill} data-testid={`diagnostic-${skill}`}>
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">{skill === 'listening' ? tr('skillListening') : tr('skillReading')}</CardTitle>
              </CardHeader>
              <CardContent>
                {s ? (
                  <>
                    <p className="tabular text-4xl font-extrabold tracking-tight">{s.score}</p>
                    <p className="tabular mt-1 text-sm text-muted-foreground">{t('range', { low: s.low, high: s.high })}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('skillMissing')}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        {t('estimateNote')}
      </p>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <section aria-labelledby="mastery-title" className="space-y-3">
          <h2 id="mastery-title" className="text-lg font-semibold">
            {t('masteryTitle')}
          </h2>
          <Card>
            <CardContent className="space-y-5">
              {[...bySkill, ...(other.length ? [{ skill: 'other' as const, items: other }] : [])]
                .filter((g) => g.items.length)
                .map((g) => (
                  <div key={g.skill} className="space-y-3">
                    <p className="text-sm font-semibold">{g.skill === 'listening' ? tr('skillListening') : g.skill === 'reading' ? tr('skillReading') : t('otherSkills')}</p>
                    <ul className="space-y-2.5" data-testid={`mastery-${g.skill}`}>
                      {g.items.map((m) => {
                        const v = pct(m.mastery * 100);
                        return (
                          <li key={m.subskill} className="space-y-1" data-subskill={m.subskill} data-mastery={v}>
                            <div className="flex items-center justify-between gap-2 text-sm">
                              <span>{subLabel(m.subskill)}</span>
                              <span className="tabular text-xs text-muted-foreground">
                                {v}%{m.confidence < 0.5 ? ` · ${t('lowConfidence')}` : ''}
                              </span>
                            </div>
                            <Progress value={v} tone={v < 40 ? 'gold' : v >= 70 ? 'success' : 'primary'} label={subLabel(m.subskill)} />
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              {!result.mastery.length ? <p className="text-sm text-muted-foreground">{t('masteryNone')}</p> : null}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="target-title" className="space-y-3">
          <h2 id="target-title" className="text-lg font-semibold">
            {t('targetTitle')}
          </h2>
          <Card data-testid="diagnostic-target" data-reason={target.reason} data-suggested={target.suggested}>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Target className="size-5 text-accent" aria-hidden />
                <div>
                  <p className="text-sm text-muted-foreground">{t('suggestedLabel')}</p>
                  <p className="tabular text-2xl font-bold" data-testid="diagnostic-suggested">
                    {target.suggested}
                  </p>
                </div>
                <Badge variant={target.reason === 'feasible' ? 'success' : target.reason === 'stretch' ? 'gold' : target.reason === 'unreachable' ? 'destructive' : 'secondary'} className="ml-auto">
                  {t(`reasonBadge.${target.reason}`)}
                </Badge>
              </div>
              <p className="text-sm" data-testid="diagnostic-reason">
                {t(`reason.${target.reason}`, reasonValues)}
              </p>

              {draft ? (
                <div className="space-y-3 border-t border-border pt-4">
                  <p className="text-sm font-medium">{t('chooseTarget')}</p>
                  <div className="space-y-2" role="radiogroup" aria-label={t('chooseTarget')}>
                    {desired !== null && desired !== target.suggested ? (
                      <TargetOption checked={choice === 'desired'} onSelect={() => setChoice('desired')} label={t('keepDesired', { score: desired })} testId="target-choice-desired" />
                    ) : null}
                    <TargetOption checked={choice === 'suggested' || desired === null || desired === target.suggested} onSelect={() => setChoice('suggested')} label={t('useSuggested', { score: target.suggested })} testId="target-choice-suggested" />
                  </div>
                  {create.isError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{te(`codes.${getErrorCode(create.error)}`)}</AlertDescription>
                    </Alert>
                  ) : null}
                  <Button variant="gold" className="w-full" onClick={createPlan} disabled={create.isPending} data-testid="diagnostic-create-plan">
                    {create.isPending ? <Spinner className="size-4" /> : null}
                    {t('createPlan')}
                    <ArrowRight aria-hidden />
                  </Button>
                </div>
              ) : (
                <Link href={fromOnboarding ? '/onboarding?step=3' : '/onboarding?step=2'} className={cn(buttonVariants({ variant: 'gold' }), 'w-full')} data-testid="diagnostic-to-onboarding">
                  {t('setupPlan')}
                  <ArrowRight aria-hidden />
                </Link>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function TargetOption({ checked, onSelect, label, testId }: { checked: boolean; onSelect: () => void; label: string; testId: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', checked ? 'border-navy bg-navy/5 dark:border-accent' : 'border-border hover:bg-muted')}
      data-testid={testId}
    >
      <span className={cn('flex size-4 items-center justify-center rounded-full border', checked ? 'border-navy dark:border-accent' : 'border-input')} aria-hidden>
        {checked ? <span className="size-2 rounded-full bg-navy dark:bg-accent" /> : null}
      </span>
      {label}
    </button>
  );
}
