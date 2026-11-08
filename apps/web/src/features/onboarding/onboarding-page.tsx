'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, ClipboardCheck, Clock, Globe, GraduationCap, Target } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { WEEKDAY_CODES } from '@allingo/schemas/api/learning-plan';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Label, NativeSelect, Spinner, Switch, ToggleChip } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { getErrorCode } from '@/lib/errors';
import { useEnrollments, useUpsertEnrollment } from '@/lib/queries';
import { PROGRAM, useCreatePlan, usePlan, useToday } from '@/features/plan/queries';
import { todayIn } from '@/features/plan/progress';
import {
  TARGET_PRESETS,
  WEEKLY_MAX,
  WEEKLY_MIN,
  WEEKLY_PRESETS,
  clearDraft,
  dailyMinutes,
  defaultDraft,
  loadDraft,
  saveDraft,
  timeZoneOptions,
  toPlanInput,
  validateStep,
  type OnboardingDraft,
  type OnboardingStep,
  type StepErrors,
} from './onboarding-store';

const STEPS: { n: OnboardingStep; key: 'program' | 'goal' | 'schedule' | 'diagnostic'; icon: typeof Target }[] = [
  { n: 1, key: 'program', icon: GraduationCap },
  { n: 2, key: 'goal', icon: Target },
  { n: 3, key: 'schedule', icon: Clock },
  { n: 4, key: 'diagnostic', icon: ClipboardCheck },
];
const PROGRAMS = [
  { code: 'toeic', enabled: true },
  { code: 'ielts', enabled: false },
  { code: 'jlpt', enabled: false },
  { code: 'hsk', enabled: false },
] as const;

/** Onboarding 4 bước `/onboarding` (S9) – người mới sau đăng ký / khách lần đầu (dashboard mời vào khi chưa có lộ trình) */
export function OnboardingPage() {
  const t = useTranslations('onboarding');
  const te = useTranslations('errors');
  const router = useRouter();
  const search = useSearchParams();
  // Trang nằm sau AuthGate (chỉ dựng ở client khi đã có /me) → đọc nháp localStorage ngay lúc khởi tạo, không lệch hydrate.
  // ?step= cho phép quay lại đúng bước từ màn chẩn đoán.
  const [draft, setDraft] = React.useState<OnboardingDraft | null>(() => {
    if (typeof window === 'undefined') return null;
    const d = loadDraft() ?? defaultDraft();
    const s = Number(search.get('step'));
    return s >= 1 && s <= 4 ? { ...d, step: s as OnboardingStep } : d;
  });
  const plan = usePlan(PROGRAM);
  const todayQ = useToday(PROGRAM);
  const enrollments = useEnrollments();
  const upsert = useUpsertEnrollment();
  const create = useCreatePlan();
  const [errors, setErrors] = React.useState<StepErrors>({});

  const update = React.useCallback((patch: Partial<OnboardingDraft>) => {
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, ...patch };
      saveDraft(next);
      return next;
    });
    setErrors({});
  }, []);

  if (!draft) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    );
  }
  const today = todayQ.data?.date ?? todayIn(draft.timezone);
  const goto = (step: OnboardingStep) => {
    const errs = step > draft.step ? validateStep(draft, draft.step, today) : {};
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    update({ step });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveEnrollment = async () => {
    const exists = !!enrollments.data?.some((e) => e.program === draft.program);
    await upsert.mutateAsync({
      exists,
      input: { program: draft.program as never, ...(draft.target_score !== null ? { target_score: draft.target_score } : {}), ...(draft.exam_date ? { exam_date: draft.exam_date } : {}), daily_minutes: dailyMinutes(draft) },
    });
  };
  const startDiagnostic = async () => {
    try {
      await saveEnrollment();
      router.push('/toeic/diagnostic?from=onboarding');
    } catch {
      /* lỗi hiện qua upsert.error */
    }
  };
  const skipDiagnostic = () =>
    create.mutate(toPlanInput(draft), {
      onSuccess: () => {
        clearDraft();
        router.push('/toeic/plan?created=1');
      },
    });

  const busy = upsert.isPending || create.isPending;
  const err = upsert.error ?? create.error;

  return (
    <div className="mx-auto max-w-3xl space-y-8" data-testid="onboarding-page" data-step={draft.step}>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ol className="grid grid-cols-4 gap-2" aria-label={t('stepsLabel')}>
        {STEPS.map(({ n, key, icon: Icon }) => {
          const state = n < draft.step ? 'done' : n === draft.step ? 'current' : 'todo';
          return (
            <li key={n} aria-current={state === 'current' ? 'step' : undefined} className="space-y-1.5">
              <div className={cn('h-1.5 rounded-full', state === 'todo' ? 'bg-muted' : 'bg-accent')} />
              <p className={cn('flex items-center gap-1.5 text-xs font-medium', state === 'todo' && 'text-muted-foreground')}>
                {state === 'done' ? <Check className="size-3.5" aria-hidden /> : <Icon className="size-3.5" aria-hidden />}
                <span className="hidden sm:inline">{t(`steps.${key}`)}</span>
                <span className="sm:hidden">{n}</span>
              </p>
            </li>
          );
        })}
      </ol>

      {plan.data ? (
        <Alert variant="info">
          <AlertDescription>{t('hasPlan')}</AlertDescription>
        </Alert>
      ) : null}

      {draft.step === 1 ? (
        <StepCard title={t('program.title')} description={t('program.desc')}>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('program.title')}>
            {PROGRAMS.map((p) => {
              const selected = draft.program === p.code;
              return (
                <button
                  key={p.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!p.enabled}
                  onClick={() => update({ program: p.code })}
                  className={cn(
                    'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60',
                    selected ? 'border-navy bg-navy/5 ring-1 ring-navy dark:border-accent dark:ring-accent' : 'border-border bg-card hover:bg-muted',
                  )}
                  data-testid={`program-${p.code}`}
                >
                  <GraduationCap className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <span className="space-y-1">
                    <span className="flex items-center gap-2 font-semibold">
                      {t(`program.names.${p.code}`)}
                      {!p.enabled ? <Badge variant="muted">{t('program.soon')}</Badge> : null}
                    </span>
                    <span className="block text-sm text-muted-foreground">{t(`program.descs.${p.code}`)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <StepNav onNext={() => goto(2)} />
        </StepCard>
      ) : null}

      {draft.step === 2 ? (
        <StepCard title={t('goal.title')} description={t('goal.desc')}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t('goal.target')}</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('goal.target')}>
              {TARGET_PRESETS.map((s) => (
                <ToggleChip key={s} pressed={draft.target_score === s} onPressedChange={(p) => update({ target_score: p ? s : null })} data-testid={`target-${s}`}>
                  {s}
                </ToggleChip>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="target-custom" className="shrink-0 text-xs text-muted-foreground">
                {t('goal.custom')}
              </Label>
              <Input
                id="target-custom"
                type="number"
                min={10}
                max={990}
                step={5}
                className="max-w-32"
                value={draft.target_score ?? ''}
                aria-invalid={!!errors.target_score}
                onChange={(e) => update({ target_score: e.target.value === '' ? null : Number(e.target.value) })}
                data-testid="target-input"
              />
            </div>
            {errors.target_score ? <FieldError>{t('errors.target')}</FieldError> : null}
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="exam-date">{t('goal.examDate')}</Label>
            <div className="flex flex-wrap items-center gap-3">
              <Input id="exam-date" type="date" min={today} className="max-w-48" value={draft.exam_date ?? ''} aria-invalid={!!errors.exam_date} onChange={(e) => update({ exam_date: e.target.value || null })} data-testid="exam-date" />
              <Button variant="ghost" size="sm" onClick={() => update({ exam_date: null })} disabled={!draft.exam_date} data-testid="exam-date-none">
                {t('goal.noExamDate')}
              </Button>
            </div>
            {errors.exam_date ? <FieldError>{t(`errors.exam_${errors.exam_date}`)}</FieldError> : <p className="text-xs text-muted-foreground">{draft.exam_date ? t('goal.examHint') : t('goal.noExamHint')}</p>}
          </div>
          <p className="rounded-lg bg-secondary/60 p-3 text-sm text-muted-foreground">{t('goal.feasibleNote')}</p>
          <StepNav onBack={() => goto(1)} onNext={() => goto(3)} />
        </StepCard>
      ) : null}

      {draft.step === 3 ? (
        <StepCard title={t('schedule.title')} description={t('schedule.desc')}>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">{t('schedule.weekly')}</legend>
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('schedule.weekly')}>
              {WEEKLY_PRESETS.map((m) => (
                <ToggleChip key={m} pressed={draft.weekly_minutes === m} onPressedChange={() => update({ weekly_minutes: m })} data-testid={`weekly-${m}`}>
                  {t('schedule.hours', { count: m / 60 })}
                </ToggleChip>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="weekly-custom" className="shrink-0 text-xs text-muted-foreground">
                {t('schedule.customMinutes')}
              </Label>
              <Input id="weekly-custom" type="number" min={WEEKLY_MIN} max={WEEKLY_MAX} step={15} className="max-w-32" value={draft.weekly_minutes} aria-invalid={!!errors.weekly_minutes} onChange={(e) => update({ weekly_minutes: Math.round(Number(e.target.value) || 0) })} data-testid="weekly-input" />
            </div>
            {errors.weekly_minutes ? <FieldError>{t('errors.weekly', { min: WEEKLY_MIN, max: WEEKLY_MAX })}</FieldError> : <p className="text-xs text-muted-foreground">{t('schedule.perDay', { count: dailyMinutes(draft) })}</p>}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('schedule.days')}</legend>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('schedule.days')}>
              {WEEKDAY_CODES.map((d) => (
                <ToggleChip
                  key={d}
                  className="px-2.5"
                  pressed={draft.study_days.includes(d)}
                  onPressedChange={(p) => update({ study_days: p ? [...draft.study_days, d] : draft.study_days.filter((x) => x !== d) })}
                  aria-label={t(`weekdays.long.${d}`)}
                  data-testid={`day-${d}`}
                >
                  {t(`weekdays.short.${d}`)}
                </ToggleChip>
              ))}
            </div>
            {errors.study_days ? <FieldError>{t('errors.days')}</FieldError> : null}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="reminder-time">{t('schedule.reminder')}</Label>
                <Switch checked={draft.reminder_time !== null} onCheckedChange={(c) => update({ reminder_time: c ? '19:00' : null })} aria-label={t('schedule.reminderToggle')} data-testid="reminder-toggle" />
              </div>
              <Input id="reminder-time" type="time" value={draft.reminder_time ?? ''} disabled={draft.reminder_time === null} onChange={(e) => update({ reminder_time: e.target.value || null })} aria-invalid={!!errors.reminder_time} data-testid="reminder-time" />
              {errors.reminder_time ? <FieldError>{t('errors.reminder')}</FieldError> : <p className="text-xs text-muted-foreground">{t('schedule.reminderHint')}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="timezone" className="flex items-center gap-1.5">
                <Globe className="size-3.5" aria-hidden />
                {t('schedule.timezone')}
              </Label>
              <NativeSelect id="timezone" value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })} data-testid="timezone">
                {timeZoneOptions(draft.timezone).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </NativeSelect>
              {errors.timezone ? <FieldError>{t('errors.timezone')}</FieldError> : <p className="text-xs text-muted-foreground">{t('schedule.timezoneHint')}</p>}
            </div>
          </div>
          <StepNav onBack={() => goto(2)} onNext={() => goto(4)} />
        </StepCard>
      ) : null}

      {draft.step === 4 ? (
        <StepCard title={t('diagnostic.title')} description={t('diagnostic.desc')}>
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            {(['length', 'adaptive', 'noFeedback'] as const).map((k) => (
              <li key={k} className="rounded-lg border border-border bg-background p-3">
                <p className="font-medium">{t(`diagnostic.points.${k}.title`)}</p>
                <p className="mt-1 text-muted-foreground">{t(`diagnostic.points.${k}.desc`)}</p>
              </li>
            ))}
          </ul>
          <dl className="grid gap-2 rounded-lg bg-secondary/50 p-3 text-sm sm:grid-cols-3" data-testid="onboarding-summary">
            <div>
              <dt className="text-xs text-muted-foreground">{t('summary.target')}</dt>
              <dd className="font-medium">{draft.target_score ?? t('summary.none')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('summary.exam')}</dt>
              <dd className="font-medium">{draft.exam_date ?? t('summary.none')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('summary.weekly')}</dt>
              <dd className="font-medium">{t('schedule.hours', { count: Math.round((draft.weekly_minutes / 60) * 10) / 10 })}</dd>
            </div>
          </dl>
          {err ? (
            <Alert variant="destructive">
              <AlertDescription>{te(`codes.${getErrorCode(err)}`)}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={() => goto(3)} disabled={busy}>
              <ArrowLeft aria-hidden />
              {t('back')}
            </Button>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" onClick={skipDiagnostic} disabled={busy} data-testid="onboarding-skip">
                {create.isPending ? <Spinner className="size-4" /> : null}
                {t('diagnostic.skip')}
              </Button>
              <Button variant="gold" onClick={() => void startDiagnostic()} disabled={busy || enrollments.isPending} data-testid="onboarding-start-diagnostic">
                {upsert.isPending ? <Spinner className="size-4" /> : null}
                {t('diagnostic.start')}
                <ArrowRight aria-hidden />
              </Button>
            </div>
          </div>
        </StepCard>
      ) : null}
    </div>
  );
}

function StepCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

function StepNav({ onBack, onNext }: { onBack?: () => void; onNext: () => void }) {
  const t = useTranslations('onboarding');
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
      {onBack ? (
        <Button variant="ghost" onClick={onBack} data-testid="onboarding-back">
          <ArrowLeft aria-hidden />
          {t('back')}
        </Button>
      ) : (
        <span />
      )}
      <Button variant="navy" onClick={onNext} data-testid="onboarding-next">
        {t('next')}
        <ArrowRight aria-hidden />
      </Button>
    </div>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  );
}
