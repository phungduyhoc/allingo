'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarCheck, CalendarDays, Lock, RefreshCw, Sparkles, Target, WandSparkles } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CHECKIN_TEXT_MAX, type PlanTask, type PlanWeek, type StudyPlan } from '@allingo/schemas/api/learning-plan';
import { ApiError } from '@allingo/api-client';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Progress,
  Spinner,
  Textarea,
} from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { getErrorCode } from '@/lib/errors';
import { useRealtimeEvent } from '@/features/realtime/realtime-provider';
import { CheckinDialog } from './checkin-dialog';
import { ProposalCard } from './proposal-card';
import { currentWeek, examCountdown, forecastTone, formatDay, formatRange, loadView, pct, todayIn, weekHasFullTest } from './progress';
import { ACTIVE_PROPOSAL_STATUSES, PROGRAM, moveErrorKey, useApplyProposal, useInstructAdjust, usePatchTask, usePlan, useProposals, useRegeneratePlan, useToday } from './queries';
import { canMoveTask, dayMinutes, moveTargets, sortDayTasks, type MoveContext } from './reschedule';
import { TaskRow } from './task-ui';
import { useLaunchTask } from './use-launch-task';

const TONE_BADGE = { success: 'success', gold: 'gold', destructive: 'destructive', muted: 'muted', primary: 'default' } as const;
const PHASE_BADGE = { foundation: 'secondary', practice: 'default', simulation: 'gold' } as const;

/** Trang lộ trình `/toeic/plan` (S9) – tuần, ngày + task, kéo thả đổi ngày, đề xuất điều chỉnh, tạo lại */
export function PlanPage() {
  const t = useTranslations('plan');
  const plan = usePlan(PROGRAM);
  const today = useToday(PROGRAM);
  const search = useSearchParams();
  const highlightProposal = search.get('proposal');
  const [checkinOpen, setCheckinOpen] = React.useState(false);
  // Realtime `plan.updated` (task xong, đề xuất sẵn sàng, sinh lại) được RealtimeProvider làm mới cho mọi trang lộ trình

  if (plan.isPending) {
    return (
      <div className="space-y-6">
        <CardSkeleton lines={3} />
        <CardSkeleton lines={6} />
      </div>
    );
  }
  if (plan.isError) return <ErrorState error={plan.error} onRetry={() => void plan.refetch()} />;
  if (!plan.data) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} />
        <EmptyState
          title={t('emptyTitle')}
          description={t('emptyDesc')}
          action={
            <Link href="/onboarding" className={buttonVariants({ variant: 'gold' })} data-testid="plan-onboarding-cta">
              {t('emptyCta')}
            </Link>
          }
        />
      </div>
    );
  }
  const todayDate = today.data?.date ?? todayIn(plan.data.settings.timezone);
  return <PlanView plan={plan.data} today={todayDate} highlightProposal={highlightProposal} checkinDue={!!today.data?.week?.checkin_due} onCheckin={() => setCheckinOpen(true)} checkinOpen={checkinOpen} setCheckinOpen={setCheckinOpen} />;
}

function PlanView({ plan, today, highlightProposal, checkinDue, onCheckin, checkinOpen, setCheckinOpen }: { plan: StudyPlan; today: string; highlightProposal: string | null; checkinDue: boolean; onCheckin: () => void; checkinOpen: boolean; setCheckinOpen: (o: boolean) => void }) {
  const t = useTranslations('plan');
  const fmt = useFormatter();
  const cur = currentWeek(plan, today);
  const [selectedNo, setSelectedNo] = React.useState<number>(cur?.week_no ?? 1);
  const selected = plan.weeks.find((w) => w.week_no === selectedNo) ?? cur ?? plan.weeks[0] ?? null;
  const [regenOpen, setRegenOpen] = React.useState(false);
  const regenerate = useRegeneratePlan(PROGRAM);
  const [regenPending, setRegenPending] = React.useState(false);

  useRealtimeEvent('plan.updated', (data) => {
    const d = data as { reason?: string; plan_id?: string } | null;
    if (d?.reason === 'generated' && regenPending) {
      setRegenPending(false);
      toast.success(t('regenerated'));
    }
  });

  const curWeek = plan.weeks.find((w) => w.week_no === plan.week_current) ?? null;
  const subtitle = [plan.target.score !== null ? t('targetScore', { score: plan.target.score }) : null, plan.target.exam_date ? t('examOn', { date: fmt.dateTime(new Date(`${plan.target.exam_date}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' }) }) : t('noExamDate')].filter(Boolean).join(' · ');

  return (
    <div className="space-y-8" data-testid="plan-page" data-weeks={plan.weeks.length} data-pro={plan.is_pro ? 'true' : 'false'}>
      <PageHeader
        title={t('title')}
        description={subtitle}
        actions={
          <>
            <Link href="/toeic/today" className={buttonVariants({ variant: 'navy' })}>
              <CalendarCheck aria-hidden />
              {t('goToday')}
            </Link>
            <Button variant="outline" onClick={() => setRegenOpen(true)} disabled={regenerate.isPending || regenPending} data-testid="plan-regenerate">
              {regenerate.isPending || regenPending ? <Spinner className="size-4" /> : <RefreshCw aria-hidden />}
              {regenPending ? t('regenerating') : t('regenerate')}
            </Button>
          </>
        }
      />

      <PlanSummary plan={plan} />

      {checkinDue && curWeek && !curWeek.checkin_done ? (
        <Alert variant="gold" data-testid="plan-checkin-due">
          <CalendarCheck aria-hidden />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3 text-foreground">
            {t('checkinDue')}
            <Button size="sm" variant="navy" onClick={onCheckin} data-testid="plan-checkin-open">
              {t('actions.checkin')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <AdjustPanel highlight={highlightProposal} />

      <section aria-labelledby="weeks-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="weeks-title" className="text-lg font-semibold">
            {t('weeksTitle', { count: plan.weeks.length })}
          </h2>
          <p className="text-xs text-muted-foreground">{t('fullTestEvery', { count: plan.full_test_every_weeks })}</p>
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label={t('weeksTitle', { count: plan.weeks.length })} data-testid="week-tabs">
          {plan.weeks.map((w) => {
            const active = selected?.week_no === w.week_no;
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={active}
                aria-controls="plan-week-panel"
                onClick={() => setSelectedNo(w.week_no)}
                className={cn(
                  'flex min-w-24 shrink-0 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  active ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-border bg-card hover:bg-muted',
                )}
                data-testid={`week-tab-${w.week_no}`}
                data-locked={w.locked ? 'true' : 'false'}
                data-full-test={weekHasFullTest(w) ? 'true' : 'false'}
              >
                <span className="flex items-center gap-1 text-sm font-semibold">
                  {t('weekShort', { week: w.week_no })}
                  {w.locked ? <Lock className="size-3" aria-label={t('locked')} /> : null}
                  {w.week_no === plan.week_current ? <span className="size-1.5 rounded-full bg-accent" aria-label={t('currentWeek')} /> : null}
                </span>
                <span className={cn(!active && 'text-muted-foreground')}>{t(`phase.${w.phase}`)}</span>
              </button>
            );
          })}
        </div>
        <div id="plan-week-panel">
          {selected ? <WeekPanel plan={plan} week={selected} today={today} onCheckin={onCheckin} /> : null}
        </div>
      </section>

      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('regenerateTitle')}</DialogTitle>
            <DialogDescription>{t('regenerateDesc')}</DialogDescription>
          </DialogHeader>
          {regenerate.isError ? <p className="text-sm text-destructive">{t('regenerateError')}</p> : null}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRegenOpen(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="navy"
              disabled={regenerate.isPending}
              data-testid="plan-regenerate-confirm"
              onClick={() =>
                regenerate.mutate(undefined, {
                  onSuccess: (r) => {
                    setRegenOpen(false);
                    if (r.status === 'completed') toast.success(t('regenerated'));
                    else if (r.status === 'failed') toast.error(t('regenerateError'));
                    else {
                      setRegenPending(true);
                      toast(t('regenerateQueued'));
                    }
                  },
                })
              }
            >
              {regenerate.isPending ? <Spinner className="size-4" /> : null}
              {t('regenerateConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CheckinDialog open={checkinOpen} onOpenChange={setCheckinOpen} />
    </div>
  );
}

function PlanSummary({ plan }: { plan: StudyPlan }) {
  const t = useTranslations('plan');
  const exam = examCountdown(plan.progress);
  const tone = forecastTone(plan.progress.forecast);
  return (
    <Card data-testid="plan-summary">
      <CardContent className="grid gap-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{plan.week_current ? t('weekOf', { week: plan.week_current, total: plan.weeks_total }) : t('weeksTitle', { count: plan.weeks_total })}</span>
            <Badge variant={TONE_BADGE[tone]} data-testid="plan-forecast" data-forecast={plan.progress.forecast}>
              {t(`forecast.${plan.progress.forecast}`)}
            </Badge>
            {!plan.is_pro ? <Badge variant="outline">{t('freePlan')}</Badge> : null}
          </div>
          <ProgressRow label={t('weekProgress')} value={plan.progress.week_pct} testId="plan-week-pct" />
          <ProgressRow label={t('planProgress')} value={plan.progress.plan_pct} testId="plan-total-pct" />
          {exam ? (
            <ProgressRow label={exam.when === 'today' ? t('examToday') : t('examCountdown', { count: exam.daysLeft })} value={exam.pct} tone="gold" testId="plan-exam-pct" />
          ) : (
            <p className="text-xs text-muted-foreground">{t('noExamHint')}</p>
          )}
        </div>
        <div className="space-y-3 rounded-lg bg-secondary/50 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <Target className="size-4" aria-hidden />
            {plan.target.score !== null ? t('targetScore', { score: plan.target.score }) : t('noTarget')}
          </p>
          {plan.target.suggested !== null ? (
            <p className="text-muted-foreground" data-testid="plan-suggested">
              {t('suggested', { score: plan.target.suggested })}
              {plan.target.feasible === false ? ` · ${t('stretch')}` : ''}
            </p>
          ) : null}
          {plan.baseline?.score !== null && plan.baseline?.score !== undefined ? (
            <p className="text-muted-foreground">
              {plan.baseline.low !== null && plan.baseline.high !== null ? t('baselineRange', { score: plan.baseline.score, low: plan.baseline.low, high: plan.baseline.high }) : t('baseline', { score: plan.baseline.score })}
            </p>
          ) : (
            <Link href="/toeic/diagnostic" className="text-primary underline-offset-4 hover:underline">
              {t('takeDiagnostic')}
            </Link>
          )}
          {plan.predicted_now !== null && plan.predicted_now !== plan.baseline?.score ? <p className="text-muted-foreground">{t('predictedNow', { score: plan.predicted_now })}</p> : null}
          <p className="text-xs text-muted-foreground">{t('weeklyMinutes', { count: plan.settings.weekly_minutes })}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressRow({ label, value, tone = 'primary', testId }: { label: string; value: number | null; tone?: 'primary' | 'gold' | 'success'; testId?: string }) {
  const v = pct(value);
  return (
    <div className="space-y-1.5" data-testid={testId} data-value={v}>
      <div className="flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="tabular font-medium">{v}%</span>
      </div>
      <Progress value={v} tone={tone} label={label} />
    </div>
  );
}

// ----------------------------------------------------------------------------- tuần

function WeekPanel({ plan, week, today, onCheckin }: { plan: StudyPlan; week: PlanWeek; today: string; onCheckin: () => void }) {
  const t = useTranslations('plan');
  const locale = useLocale();
  const load = loadView(week);
  const ctx: MoveContext = { today, examDate: plan.settings.exam_date };
  const patch = usePatchTask(PROGRAM);
  const { launch, busyId, error: launchError, errorTaskId } = useLaunchTask({ returnTo: '/toeic/plan', onCheckin });
  const [dragging, setDragging] = React.useState<PlanTask | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const targets = dragging ? new Set(moveTargets(dragging, week, ctx)) : null;
  const te = useTranslations('errors');
  const ts = useTranslations('sections');

  const move = (task: PlanTask, date: string) => {
    if (!canMoveTask(task, date, week, ctx)) return;
    patch.mutate(
      { taskId: task.id, patch: { due_date: date } },
      {
        onSuccess: () => toast.success(t('moved', { day: formatDay(date, locale, { weekday: 'long', day: '2-digit', month: '2-digit' }) })),
        onError: (err) => toast.error(t(`moveError.${moveErrorKey(err)}`)),
      },
    );
  };
  const setStatus = (task: PlanTask, status: 'done' | 'skipped' | 'pending') =>
    patch.mutate({ taskId: task.id, patch: { status } }, { onError: (err) => toast.error(err instanceof ApiError && err.status === 400 ? t('statusError') : te(`codes.${getErrorCode(err)}`)) });

  if (week.locked) {
    return (
      <Card data-testid="week-locked" className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
          <Lock className="size-6 text-muted-foreground" aria-hidden />
          <p className="font-semibold">{t('lockedTitle', { week: week.week_no })}</p>
          <p className="max-w-md text-sm text-muted-foreground">{t('lockedDesc', { phase: t(`phase.${week.phase}`), range: formatRange(week.start_date, week.end_date, locale) })}</p>
          <Link href="/pricing" className={buttonVariants({ variant: 'gold' })} data-testid="week-upgrade">
            <Sparkles aria-hidden />
            {t('upgrade')}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="week-panel" data-week={week.week_no}>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-semibold">{t('weekShort', { week: week.week_no })}</span>
          <span className="text-muted-foreground">{formatRange(week.start_date, week.end_date, locale)}</span>
          <Badge variant={PHASE_BADGE[week.phase]}>{t(`phase.${week.phase}`)}</Badge>
          {week.focus ? <Badge variant="outline">{t('focus', { section: ts.has(week.focus) ? ts(week.focus) : week.focus })}</Badge> : null}
          {week.checkin_done ? <Badge variant="success">{t('checkinDone')}</Badge> : null}
        </div>
        <div className="flex min-w-48 flex-1 items-center gap-3 sm:max-w-xs">
          <div className="flex-1">
            <Progress value={load.pct} tone={load.over ? 'gold' : 'primary'} label={t('load')} />
          </div>
          <span className="tabular shrink-0 text-xs text-muted-foreground" data-testid="week-load" data-load={load.load} data-budget={load.budget}>
            {t('loadOf', { load: load.load, budget: load.budget })}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('dragHint')}</p>
      {launchError && errorTaskId ? (
        <Alert variant="destructive">
          <AlertDescription>{te(`codes.${getErrorCode(launchError)}`)}</AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2" data-testid="week-days">
        {week.days.map((day) => {
          const allowed = targets?.has(day.date) ?? false;
          const isToday = day.date === today;
          const minutes = dayMinutes(day.tasks);
          return (
            <section
              key={day.date}
              aria-label={formatDay(day.date, locale, { weekday: 'long', day: '2-digit', month: '2-digit' })}
              className={cn(
                'space-y-2 rounded-xl border bg-background p-3 transition-colors',
                isToday ? 'border-accent' : 'border-border',
                dragging && allowed && 'border-dashed border-primary bg-primary/5',
                dragging && !allowed && 'opacity-60',
                over === day.date && allowed && 'ring-2 ring-primary',
              )}
              data-testid="plan-day"
              data-date={day.date}
              data-status={day.status}
              data-drop={dragging ? (allowed ? 'allowed' : 'blocked') : undefined}
              onDragOver={(e) => {
                if (!dragging || !allowed) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (over !== day.date) setOver(day.date);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === day.date ? null : o));
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                const task = week.days.flatMap((d) => d.tasks).find((x) => x.id === id) ?? dragging;
                setDragging(null);
                setOver(null);
                if (task && allowed) move(task, day.date);
              }}
            >
              <header className="flex items-center justify-between gap-2 px-1">
                <h3 className="flex items-center gap-2 text-sm font-semibold capitalize">
                  {formatDay(day.date, locale, { weekday: 'long', day: '2-digit', month: '2-digit' })}
                  {isToday ? <Badge variant="gold">{t('today')}</Badge> : null}
                </h3>
                <span className="tabular text-xs text-muted-foreground">{day.tasks.length ? t('dayMinutes', { count: minutes }) : t('rest')}</span>
              </header>
              {day.tasks.length ? (
                <ul className="space-y-2">
                  {sortDayTasks(day.tasks).map((task) => {
                    const canDrag = task.status === 'pending' && moveTargets(task, week, ctx).length > 0;
                    return (
                      <TaskRow
                        key={task.id}
                        task={task}
                        compact
                        busy={busyId === task.id}
                        onOpen={launch}
                        onStatus={setStatus}
                        moveTargets={moveTargets(task, week, ctx)}
                        onMove={move}
                        draggable={canDrag}
                        onDragStart={(tk, e) => {
                          e.dataTransfer.setData('text/plain', tk.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragging(tk);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setOver(null);
                        }}
                      />
                    );
                  })}
                </ul>
              ) : (
                <p className="px-1 py-2 text-xs text-muted-foreground">{t('restDay')}</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- điều chỉnh

function AdjustPanel({ highlight }: { highlight: string | null }) {
  const t = useTranslations('plan');
  const te = useTranslations('errors');
  const proposals = useProposals(PROGRAM);
  const apply = useApplyProposal(PROGRAM);
  const instruct = useInstructAdjust(PROGRAM);
  const [text, setText] = React.useState('');
  const [applyingId, setApplyingId] = React.useState<string | null>(null);
  const list = (proposals.data ?? []).filter((p) => ACTIVE_PROPOSAL_STATUSES.has(p.status) || p.proposal_id === highlight || p.proposal_id === instruct.data?.proposal.proposal_id).slice(0, 3);
  const pendingAny = list.some((p) => p.status === 'pending');

  // Dự phòng khi realtime chưa tới: đề xuất đang tạo → hỏi lại mỗi 3 s
  React.useEffect(() => {
    if (!pendingAny) return;
    const id = window.setInterval(() => void proposals.refetch(), 3000);
    return () => window.clearInterval(id);
  }, [pendingAny, proposals]);

  const instructError = instruct.error;
  const refusal = instructError instanceof ApiError && instructError.status === 400 ? (instructError.details?.refusal_code as string | undefined) : undefined;
  const errorText = !instructError
    ? null
    : instructError instanceof ApiError && instructError.status === 402
      ? t('adjust.noCredits')
      : refusal
        ? t.has(`adjust.refusal.${refusal}`) ? t(`adjust.refusal.${refusal}`) : t('adjust.refusal.generic')
        : instructError instanceof ApiError && instructError.status === 400
          ? t('adjust.refusal.generic')
          : te(`codes.${getErrorCode(instructError)}`);

  return (
    <section aria-labelledby="adjust-title" className="space-y-3" data-testid="adjust-panel">
      <h2 id="adjust-title" className="text-lg font-semibold">
        {t('adjust.title')}
      </h2>
      {list.map((p) => (
        <ProposalCard
          key={p.proposal_id}
          proposal={p}
          highlight={p.proposal_id === highlight}
          applying={apply.isPending && applyingId === p.proposal_id}
          applyError={applyingId === p.proposal_id ? apply.error : null}
          onApply={(x) => {
            setApplyingId(x.proposal_id);
            apply.mutate(x.proposal_id, { onSuccess: () => toast.success(t('adjust.applied')) });
          }}
        />
      ))}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <WandSparkles className="size-4" aria-hidden />
            {t('adjust.instructionTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const v = text.trim();
              if (v.length < 2) return;
              instruct.mutate(v, {
                onSuccess: (r) => {
                  setText('');
                  toast(r.accepted || r.proposal.status === 'pending' ? t('adjust.queued') : t(`proposal.status.${r.proposal.status}`));
                },
              });
            }}
          >
            <Label htmlFor="adjust-instruction" className="sr-only">
              {t('adjust.instructionTitle')}
            </Label>
            <Textarea id="adjust-instruction" value={text} maxLength={CHECKIN_TEXT_MAX} onChange={(e) => setText(e.target.value)} placeholder={t('adjust.placeholder')} data-testid="adjust-instruction" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t('adjust.creditHint')}</p>
              <Button type="submit" variant="outline" disabled={instruct.isPending || text.trim().length < 2} data-testid="adjust-submit">
                {instruct.isPending ? <Spinner className="size-4" /> : null}
                {t('adjust.submit')}
              </Button>
            </div>
            {errorText ? (
              <p role="alert" className="text-sm text-destructive" data-testid="adjust-error">
                {errorText}
                {instructError instanceof ApiError && instructError.status === 402 ? (
                  <>
                    {' '}
                    <Link href="/pricing" className="font-medium underline">
                      {t('upgrade')}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
