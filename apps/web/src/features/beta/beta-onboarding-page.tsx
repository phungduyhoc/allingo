'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CalendarCheck, CheckCircle2, ExternalLink, Megaphone, MessageSquareHeart, NotebookPen, Sparkles, Timer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { BETA_DEVICES, BETA_GOALS, betaSurveyInputSchema, type BetaSurveyInput } from '@allingo/schemas';
import { Alert, AlertDescription, Badge, Button, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Input, Label, NativeSelect, Spinner, ToggleChip } from '@allingo/ui';
import { env } from '@/env';
import { useRouter } from '@/i18n/navigation';
import { betaNextPath } from '@/lib/beta';
import { getErrorCode } from '@/lib/errors';
import { s12Keys, submitBetaSurvey } from '@/lib/s12-api';
import { useClientValue } from '@/lib/use-mounted';
import { PageHeader } from '@/components/page-header';

/**
 * Onboarding beta `/onboarding/beta` (S12): (1) khảo sát 5 câu `POST /me/beta-survey` (mục tiêu, ngày thi, điểm hiện tại, thiết bị,
 * phút/ngày – validate bằng `betaSurveyInputSchema` của server; gửi lại = ghi đè), (2) hướng dẫn 60 giây (4 thẻ, bỏ qua được,
 * nhớ `localStorage` `allingo.beta-tour.v1`), (3) kênh phản hồi cộng đồng (Zalo/Discord từ `NEXT_PUBLIC_COMMUNITY_*` – trống thì
 * ẩn) + nút "Góp ý" trong app. Xong → `?next=` (mặc định dashboard).
 */

const TOUR_KEY = 'allingo.beta-tour.v1';
const MINUTES = [10, 15, 20, 30, 45, 60, 90, 120] as const;
type Step = 'survey' | 'tour' | 'community';

function readTour(): string | null {
  try {
    return window.localStorage.getItem(TOUR_KEY);
  } catch {
    return null;
  }
}
function writeTour(v: 'done' | 'skipped'): void {
  try {
    window.localStorage.setItem(TOUR_KEY, v);
  } catch {
    /* localStorage bị chặn – chỉ nhớ trong phiên */
  }
}

/** Ngày mai (giờ máy) dạng YYYY-MM-DD – ngày thi phải sau hôm nay */
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function BetaOnboardingPage() {
  const t = useTranslations('betaOnboarding');
  const router = useRouter();
  const search = useClientValue<string | null>(() => window.location.search, null);
  const next = betaNextPath(search === null ? null : new URLSearchParams(search).get('next'));
  const tourSeen = useClientValue<string | null>(readTour, null);
  const [step, setStep] = React.useState<Step>('survey');
  const steps: Step[] = ['survey', 'tour', 'community'];
  const index = steps.indexOf(step);

  return (
    <div className="mx-auto max-w-2xl space-y-6" data-testid="beta-onboarding" data-step={step}>
      <PageHeader title={t('title')} description={t('subtitle')} />
      <ol className="flex items-center gap-2 text-xs font-medium" aria-label={t('progressLabel')}>
        {steps.map((s, i) => (
          <li key={s} className={cn('flex items-center gap-2', i <= index ? 'text-foreground' : 'text-muted-foreground')} aria-current={s === step ? 'step' : undefined}>
            <span className={cn('inline-flex size-6 items-center justify-center rounded-full border text-[11px]', i < index ? 'border-success bg-success text-success-foreground' : i === index ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-border')}>
              {i < index ? <CheckCircle2 className="size-3.5" aria-hidden /> : i + 1}
            </span>
            {t(`steps.${s}`)}
            {i < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-border" aria-hidden /> : null}
          </li>
        ))}
      </ol>
      {step === 'survey' ? <SurveyStep onDone={() => setStep(tourSeen ? 'community' : 'tour')} /> : null}
      {step === 'tour' ? (
        <TourStep
          onDone={(how) => {
            writeTour(how);
            setStep('community');
          }}
        />
      ) : null}
      {step === 'community' ? <CommunityStep onFinish={() => router.push(next)} onReplayTour={() => setStep('tour')} /> : null}
    </div>
  );
}

function SurveyStep({ onDone }: { onDone: () => void }) {
  const t = useTranslations('betaOnboarding');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const id = React.useId();
  const [goal, setGoal] = React.useState<BetaSurveyInput['goal'] | null>(null);
  const [goalNote, setGoalNote] = React.useState('');
  const [examDate, setExamDate] = React.useState('');
  const [noExam, setNoExam] = React.useState(false);
  const [score, setScore] = React.useState('');
  const [noScore, setNoScore] = React.useState(false);
  const [devices, setDevices] = React.useState<BetaSurveyInput['devices']>([]);
  const [minutes, setMinutes] = React.useState('30');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const submit = useMutation({
    mutationFn: submitBetaSurvey,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: s12Keys.pendingSurveys });
      void qc.invalidateQueries({ queryKey: s12Keys.betaStatus });
      onDone();
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!goal) errs.goal = t('errors.goal');
    if (!noExam && !examDate) errs.exam_date = t('errors.examDate');
    if (!noExam && examDate && examDate < tomorrow()) errs.exam_date = t('errors.examDatePast');
    const scoreNum = Number(score);
    if (!noScore && (!score || !Number.isInteger(scoreNum) || scoreNum < 10 || scoreNum > 990)) errs.current_score = t('errors.score');
    if (!devices.length) errs.devices = t('errors.devices');
    const input = {
      goal: goal ?? 'other',
      ...(goal === 'other' && goalNote.trim() ? { goal_note: goalNote.trim().slice(0, 200) } : {}),
      exam_date: noExam ? null : examDate,
      current_score: noScore ? null : scoreNum,
      devices,
      study_minutes_per_day: Number(minutes),
    };
    const parsed = betaSurveyInputSchema.safeParse(input);
    if (!parsed.success && !Object.keys(errs).length) errs.form = t('errors.form');
    setErrors(errs);
    if (Object.keys(errs).length || !parsed.success) return;
    submit.mutate(parsed.data);
  };

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${id}-${k}-err`} className="text-sm text-destructive" role="alert">
        {errors[k]}
      </p>
    ) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('surveyTitle')}</CardTitle>
        <CardDescription>{t('surveyDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={onSubmit} noValidate data-testid="beta-survey-form">
          <fieldset className="space-y-2" aria-describedby={errors.goal ? `${id}-goal-err` : undefined}>
            <legend className="text-sm font-semibold">{t('q.goal')}</legend>
            {/* Chọn một: chip bật/tắt (aria-pressed) – bấm chip khác thì chip cũ tắt */}
            <div className="flex flex-wrap gap-2">
              {BETA_GOALS.map((g) => (
                <ToggleChip key={g} pressed={goal === g} onPressedChange={() => setGoal(g)} data-testid={`survey-goal-${g}`}>
                  {t(`goals.${g}`)}
                </ToggleChip>
              ))}
            </div>
            {goal === 'other' ? (
              <Input value={goalNote} onChange={(e) => setGoalNote(e.target.value)} maxLength={200} placeholder={t('goalNotePlaceholder')} aria-label={t('goalNoteLabel')} className="mt-2" />
            ) : null}
            {err('goal')}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={`${id}-exam`} className="font-semibold">
              {t('q.examDate')}
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input id={`${id}-exam`} type="date" min={tomorrow()} value={examDate} disabled={noExam} onChange={(e) => setExamDate(e.target.value)} className="h-10 w-48" aria-invalid={errors.exam_date ? true : undefined} aria-describedby={errors.exam_date ? `${id}-exam_date-err` : undefined} data-testid="survey-exam-date" />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-navy)]" checked={noExam} onChange={(e) => setNoExam(e.target.checked)} data-testid="survey-no-exam" />
                {t('noExamDate')}
              </label>
            </div>
            {err('exam_date')}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-score`} className="font-semibold">
              {t('q.score')}
            </Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input id={`${id}-score`} type="number" inputMode="numeric" min={10} max={990} step={5} value={score} disabled={noScore} onChange={(e) => setScore(e.target.value)} className="h-10 w-32" aria-invalid={errors.current_score ? true : undefined} aria-describedby={`${id}-score-hint${errors.current_score ? ` ${id}-current_score-err` : ''}`} data-testid="survey-score" />
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4 accent-[var(--color-navy)]" checked={noScore} onChange={(e) => setNoScore(e.target.checked)} data-testid="survey-no-score" />
                {t('noScore')}
              </label>
            </div>
            <p id={`${id}-score-hint`} className="text-xs text-muted-foreground">
              {t('scoreHint')}
            </p>
            {err('current_score')}
          </div>

          <fieldset className="space-y-2" aria-describedby={errors.devices ? `${id}-devices-err` : undefined}>
            <legend className="text-sm font-semibold">{t('q.devices')}</legend>
            <div className="flex flex-wrap gap-2">
              {BETA_DEVICES.map((d) => {
                const on = devices.includes(d);
                return (
                  <ToggleChip key={d} pressed={on} onPressedChange={() => setDevices((xs) => (on ? xs.filter((x) => x !== d) : [...xs, d]))} data-testid={`survey-device-${d}`}>
                    {t(`devices.${d}`)}
                  </ToggleChip>
                );
              })}
            </div>
            {err('devices')}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor={`${id}-minutes`} className="font-semibold">
              {t('q.minutes')}
            </Label>
            <NativeSelect id={`${id}-minutes`} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 w-48" data-testid="survey-minutes">
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {t('minutesOption', { minutes: m })}
                </option>
              ))}
            </NativeSelect>
          </div>

          {err('form')}
          {submit.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{te(`codes.${getErrorCode(submit.error)}`)}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" variant="navy" size="lg" disabled={submit.isPending} data-testid="beta-survey-submit">
            {submit.isPending ? <Spinner aria-hidden /> : null}
            {t('surveySubmit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const TOUR = [
  { key: 'plan', icon: CalendarCheck },
  { key: 'tests', icon: Timer },
  { key: 'ai', icon: Sparkles },
  { key: 'feedback', icon: Megaphone },
] as const;

function TourStep({ onDone }: { onDone: (how: 'done' | 'skipped') => void }) {
  const t = useTranslations('betaOnboarding');
  const [i, setI] = React.useState(0);
  const slide = TOUR[i]!;
  const Icon = slide.icon;
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => {
    headingRef.current?.focus();
  }, [i]);
  return (
    <Card data-testid="beta-tour" data-slide={i}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <Badge variant="muted">
            <Timer aria-hidden />
            {t('tourDuration')}
          </Badge>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('tourProgress', { current: i + 1, total: TOUR.length })}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onDone('skipped')} data-testid="beta-tour-skip">
          {t('tourSkip')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex gap-4">
          <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-foreground dark:text-accent">
            <Icon className="size-6" aria-hidden />
          </span>
          <div className="space-y-1.5">
            <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
              {t(`tour.${slide.key}.title`)}
            </h2>
            <p className="leading-relaxed text-muted-foreground">{t(`tour.${slide.key}.body`)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5" aria-hidden>
            {TOUR.map((s, k) => (
              <span key={s.key} className={cn('h-1.5 w-6 rounded-full', k <= i ? 'bg-navy dark:bg-accent' : 'bg-muted')} />
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))}>
              <ArrowLeft aria-hidden />
              {t('tourBack')}
            </Button>
            {i < TOUR.length - 1 ? (
              <Button variant="navy" size="sm" onClick={() => setI((x) => x + 1)} data-testid="beta-tour-next">
                {t('tourNext')}
                <ArrowRight aria-hidden />
              </Button>
            ) : (
              <Button variant="navy" size="sm" onClick={() => onDone('done')} data-testid="beta-tour-done">
                {t('tourDone')}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CommunityStep({ onFinish, onReplayTour }: { onFinish: () => void; onReplayTour: () => void }) {
  const t = useTranslations('betaOnboarding');
  const links = [
    env.communityZaloUrl ? { key: 'zalo', href: env.communityZaloUrl } : null,
    env.communityDiscordUrl ? { key: 'discord', href: env.communityDiscordUrl } : null,
  ].filter((x): x is { key: 'zalo' | 'discord'; href: string } => !!x);
  return (
    <Card data-testid="beta-community">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageSquareHeart className="size-5" aria-hidden />
          {t('communityTitle')}
        </CardTitle>
        <CardDescription>{t('communityDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {links.length ? (
          <ul className="flex flex-wrap gap-2" data-testid="community-links">
            {links.map((l) => (
              <li key={l.key}>
                <a href={l.href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline' })} data-testid={`community-${l.key}`}>
                  {t(`community.${l.key}`)}
                  <ExternalLink aria-hidden />
                  <span className="sr-only">{t('opensNewTab')}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="flex gap-2 rounded-lg bg-muted px-3 py-2.5 text-sm">
          <NotebookPen className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('feedbackHint')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="navy" size="lg" onClick={onFinish} data-testid="beta-onboarding-finish">
            {t('finish')}
          </Button>
          <Button variant="ghost" onClick={onReplayTour}>
            {t('replayTour')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
