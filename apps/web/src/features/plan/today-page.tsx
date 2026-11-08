'use client';

import * as React from 'react';
import { CalendarCheck, CheckCircle2, Flame, Hourglass, Route, Snowflake, Sparkles } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { PlanTask, PlanToday } from '@allingo/schemas/api/learning-plan';
import { ApiError } from '@allingo/api-client';
import { Alert, AlertDescription, AlertTitle, Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { getErrorCode } from '@/lib/errors';
import { useStats } from '@/lib/queries';
import { CheckinDialog } from './checkin-dialog';
import { pct } from './progress';
import { PROGRAM, usePatchTask, useToday } from './queries';
import { sortDayTasks } from './reschedule';
import { TaskRow } from './task-ui';
import { useLaunchTask } from './use-launch-task';

/** Trang "Hôm nay học gì" `/toeic/today` (S9): trọng tâm, task hôm nay + quá hạn, gợi ý 15 phút, streak, check-in tuần */
export function TodayPage() {
  const t = useTranslations('today');
  const fmt = useFormatter();
  const today = useToday(PROGRAM);
  const stats = useStats(PROGRAM);
  // Realtime `plan.updated` → RealtimeProvider làm mới lộ trình/hôm nay/thống kê
  const [checkinOpen, setCheckinOpen] = React.useState(false);

  if (today.isPending) {
    return (
      <div className="space-y-6">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={5} />
      </div>
    );
  }
  if (today.isError) return <ErrorState error={today.error} onRetry={() => void today.refetch()} />;
  const d = today.data;
  const dateLabel = fmt.dateTime(new Date(`${d.date}T00:00:00Z`), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <div className="space-y-8" data-testid="today-page" data-date={d.date}>
      <PageHeader
        title={t('title')}
        description={dateLabel}
        actions={
          d.plan_id ? (
            <Link href="/toeic/plan" className={buttonVariants({ variant: 'outline' })}>
              <Route aria-hidden />
              {t('viewPlan')}
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StreakCard today={d} />
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('xpTitle')}</CardTitle>
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent>
            <p className="tabular text-3xl font-extrabold tracking-tight" data-testid="today-xp" data-xp={stats.data?.xp.total ?? ''}>
              {stats.data ? fmt.number(stats.data.xp.total) : '–'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.data ? t('xpToday', { count: stats.data.xp.today ?? 0 }) : null}
              {stats.data?.xp.level ? ` · ${t('level', { level: stats.data.xp.level })}` : null}
            </p>
            <Link href="/badges" className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline">
              {t('badgesLink')}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">{t('weekTitle')}</CardTitle>
            <CalendarCheck className="size-4 text-muted-foreground" aria-hidden />
          </CardHeader>
          <CardContent className="space-y-2">
            {d.week ? (
              <>
                <p className="text-sm font-semibold">{t('weekNo', { week: d.week.week_no })}</p>
                <Progress value={pct(d.week.progress_pct)} label={t('weekTitle')} />
                <p className="tabular text-xs text-muted-foreground" data-testid="today-week-pct">
                  {t('weekPct', { pct: pct(d.week.progress_pct) })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('noWeek')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {!d.plan_id ? (
        <EmptyState
          title={t('noPlanTitle')}
          description={t('noPlanDesc')}
          action={
            <Link href="/onboarding" className={buttonVariants({ variant: 'gold' })} data-testid="today-onboarding-cta">
              {t('noPlanCta')}
            </Link>
          }
        />
      ) : (
        <TodayTasks today={d} onCheckin={() => setCheckinOpen(true)} />
      )}
      <CheckinDialog open={checkinOpen} onOpenChange={setCheckinOpen} />
    </div>
  );
}

export function StreakCard({ today, className }: { today: Pick<PlanToday, 'streak' | 'studied_today'>; className?: string }) {
  const t = useTranslations('today');
  const s = today.streak;
  return (
    <Card className={cn(s.at_risk && 'border-accent', className)} data-testid="streak-card" data-streak={s.current} data-at-risk={s.at_risk ? 'true' : 'false'}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">{t('streakTitle')}</CardTitle>
        <Flame className={cn('size-4', s.current > 0 ? 'text-accent' : 'text-muted-foreground')} aria-hidden />
      </CardHeader>
      <CardContent>
        <p className="tabular text-3xl font-extrabold tracking-tight" data-testid="streak-current">
          {t('streakDays', { count: s.current })}
        </p>
        {today.studied_today ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="size-3.5" aria-hidden />
            {t('studiedToday')}
          </p>
        ) : s.at_risk ? (
          <p className="mt-1 text-xs font-medium text-foreground" data-testid="streak-at-risk">
            {t('streakAtRisk')}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t('streakStart')}</p>
        )}
        {s.freeze_available ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Snowflake className="size-3.5" aria-hidden />
            {t('freezeAvailable')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TodayTasks({ today, onCheckin }: { today: PlanToday; onCheckin: () => void }) {
  const t = useTranslations('today');
  const tp = useTranslations('plan');
  const te = useTranslations('errors');
  const ts = useTranslations('sections');
  const patch = usePatchTask(PROGRAM);
  const { launch, busyId, error, errorTaskId } = useLaunchTask({ returnTo: '/toeic/today', onCheckin });
  const all = [...today.tasks, ...today.overdue];
  const byId = new Map(all.map((x) => [x.id, x]));
  const quick = today.quick.items.map((i) => ({ ...i, task: byId.get(i.task_id) })).filter((i): i is typeof i & { task: PlanTask } => !!i.task);
  const done = today.tasks.filter((x) => x.status === 'done').length;
  const counted = today.tasks.filter((x) => x.status !== 'skipped').length;
  const setStatus = (task: PlanTask, status: 'done' | 'skipped' | 'pending') =>
    patch.mutate({ taskId: task.id, patch: { status } }, { onError: (err) => toast.error(err instanceof ApiError && err.status === 400 ? tp('statusError') : te(`codes.${getErrorCode(err)}`)) });
  const row = (task: PlanTask, extra?: { showDate?: boolean; minutes?: number }) => (
    <TaskRow key={task.id} task={task} busy={busyId === task.id} onOpen={launch} onStatus={setStatus} showDate={extra?.showDate} minutesOverride={extra?.minutes} />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        {today.week?.checkin_due && !today.week.checkin_done ? (
          <Alert variant="gold" data-testid="today-checkin-due">
            <CalendarCheck aria-hidden />
            <AlertTitle>{t('checkinTitle')}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              {t('checkinDesc')}
              <Button size="sm" variant="navy" onClick={onCheckin} data-testid="today-checkin-open">
                {tp('actions.checkin')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="today-tasks-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="today-tasks-title" className="text-lg font-semibold">
                {t('tasksTitle')}
              </h2>
              {today.focus ? <p className="text-sm text-muted-foreground">{t('focus', { section: ts.has(today.focus) ? ts(today.focus) : today.focus })}</p> : null}
            </div>
            {counted ? (
              <Badge variant={done === counted ? 'success' : 'outline'} data-testid="today-done-count">
                {t('doneCount', { done, total: counted })}
              </Badge>
            ) : null}
          </div>
          {error && errorTaskId ? (
            <Alert variant="destructive">
              <AlertDescription>{te(`codes.${getErrorCode(error)}`)}</AlertDescription>
            </Alert>
          ) : null}
          {today.tasks.length ? (
            <ul className="space-y-2" data-testid="today-tasks">
              {sortDayTasks(today.tasks).map((x) => row(x))}
            </ul>
          ) : (
            <EmptyState title={t('restTitle')} description={t('restDesc')} />
          )}
        </section>

        {today.overdue.length ? (
          <section aria-labelledby="today-overdue-title" className="space-y-3">
            <h2 id="today-overdue-title" className="text-lg font-semibold">
              {t('overdueTitle', { count: today.overdue.length })}
            </h2>
            <p className="text-sm text-muted-foreground">{t('overdueDesc')}</p>
            <ul className="space-y-2" data-testid="today-overdue">
              {today.overdue.map((x) => row(x, { showDate: true }))}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="space-y-6">
        <Card data-testid="today-quick">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Hourglass className="size-4" aria-hidden />
              {t('quickTitle', { minutes: 15 })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {quick.length ? (
              <>
                <p className="text-sm text-muted-foreground">{t('quickDesc', { minutes: today.quick.minutes })}</p>
                <ul className="space-y-2">
                  {quick.map((i) => (
                    <li key={i.task_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 truncate">{tp(`taskType.${i.task.task_type}`)}</span>
                      <span className="tabular shrink-0 text-xs text-muted-foreground">
                        {t('quickMinutes', { count: i.est_minutes })}
                        {i.shortened ? ` · ${t('shortened')}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                <Button
                  variant="gold"
                  className="w-full"
                  data-testid="today-quick-start"
                  onClick={() => {
                    const first = quick.find((i) => i.task.status === 'pending');
                    if (first) launch(first.task);
                  }}
                  disabled={!quick.some((i) => i.task.status === 'pending')}
                >
                  {t('quickStart')}
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('quickNone')}</p>
            )}
          </CardContent>
        </Card>
        {today.warmup && today.warmup.status === 'pending' ? (
          // Khởi động từ vựng (spec `warmup`) – chính là task ôn từ hôm nay, chỉ nhắc ở đây (không lặp dòng task)
          <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm text-muted-foreground" data-testid="today-warmup">
            <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
            {t('warmup', { minutes: today.warmup.est_minutes })}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
