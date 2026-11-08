'use client';

import { ArrowRight, CalendarCheck, Flame, Route } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useLocalized } from '@/lib/localized';
import { CardSkeleton } from '@/components/states';
import { pct } from './progress';
import { PROGRAM, useToday } from './queries';
import { TaskIcon } from './task-ui';
import { useFlag } from '@/features/flags/flags-provider';

/** Thẻ "Hôm nay" trên dashboard: streak, tiến độ việc hôm nay, việc kế tiếp; chưa có lộ trình → mời onboarding */
/** S11: kill-switch ff.learning.study_plan tắt → không hiện thẻ (không gọi /me/plan/today) */
export function TodayCard() {
  return useFlag('ff.learning.study_plan') ? <TodayCardInner /> : null;
}

function TodayCardInner() {
  const t = useTranslations('today');
  const tc = useTranslations('common');
  const L = useLocalized();
  const today = useToday(PROGRAM);
  if (today.isPending) return <CardSkeleton lines={3} />;
  if (today.isError) return null;
  const d = today.data;
  if (!d.plan_id) {
    return (
      <Card className="border-accent/60 bg-accent/10" data-testid="dashboard-onboarding">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4" aria-hidden />
            {t('cardNoPlanTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t('cardNoPlanDesc')}</p>
          <Link href="/onboarding" className={buttonVariants({ variant: 'gold' })} data-testid="dashboard-onboarding-cta">
            {t('noPlanCta')}
            <ArrowRight aria-hidden />
          </Link>
        </CardContent>
      </Card>
    );
  }
  const counted = d.tasks.filter((x) => x.status !== 'skipped');
  const done = counted.filter((x) => x.status === 'done').length;
  const next = [...d.tasks, ...d.overdue].find((x) => x.status === 'pending') ?? null;
  return (
    <Card data-testid="dashboard-today">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <CalendarCheck className="size-4" aria-hidden />
          {t('title')}
        </CardTitle>
        <span className={cn('flex items-center gap-1 text-sm font-semibold', d.streak.at_risk && 'text-accent-foreground')} data-testid="dashboard-streak">
          <Flame className={cn('size-4', d.streak.current > 0 ? 'text-accent' : 'text-muted-foreground')} aria-hidden />
          {t('streakDays', { count: d.streak.current })}
          {d.streak.at_risk ? <Badge variant="gold">{t('atRiskShort')}</Badge> : null}
        </span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span>{t('doneCount', { done, total: counted.length })}</span>
            {d.overdue.length ? <Badge variant="destructive">{t('overdueBadge', { count: d.overdue.length })}</Badge> : null}
          </div>
          <Progress value={counted.length ? pct((done / counted.length) * 100) : 0} tone="success" label={t('title')} />
        </div>
        {next ? (
          <div className="flex items-center gap-3 rounded-lg border border-border p-3">
            <TaskIcon type={next.task_type} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{L(next.title)}</p>
              <p className="text-xs text-muted-foreground">{tc('minutes', { count: next.est_minutes })}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{counted.length ? t('allDone') : t('restDesc')}</p>
        )}
        <Link href="/toeic/today" className={buttonVariants({ variant: 'navy', className: 'w-full' })} data-testid="dashboard-today-link">
          {t('open')}
          <ArrowRight aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
