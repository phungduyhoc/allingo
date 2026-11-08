'use client';

import { Award, Flame, ListChecks, Lock, type LucideIcon, Medal, Rocket, Sparkles, Trophy, TrendingUp } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { Badge as BadgeDto } from '@allingo/schemas/api/learning-plan';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn, Progress } from '@allingo/ui';
import { useLocalized } from '@/lib/localized';
import { useStats } from '@/lib/queries';
import { PageHeader } from '@/components/page-header';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { PROGRAM, useBadges } from '@/features/plan/queries';
import { xpLevelView } from '@/features/plan/progress';

/** Icon theo mã/luật huy hiệu (seed learn.badges: first_attempt, first_full_test, questions_1000, score_up_50, streak_7, streak_30…) */
export function badgeIcon(b: Pick<BadgeDto, 'code' | 'rule'>): LucideIcon {
  const r = b.rule as { streak?: unknown; answered?: unknown; score_delta?: unknown; kind?: unknown };
  if (typeof r.streak === 'number' || b.code.startsWith('streak')) return Flame;
  if (typeof r.answered === 'number') return ListChecks;
  if (typeof r.score_delta === 'number') return TrendingUp;
  if (r.kind === 'full' || b.code.includes('full')) return Trophy;
  if (b.code.startsWith('first')) return Rocket;
  return Medal;
}

/** Màn huy hiệu `/badges` (S9): lưới đã đạt/chưa + tiến độ, XP và cấp độ */
export function BadgesPage() {
  const t = useTranslations('badges');
  const fmt = useFormatter();
  const L = useLocalized();
  const badges = useBadges(PROGRAM);
  const stats = useStats(PROGRAM);
  const xp = stats.data?.xp;
  const lv = xp ? xpLevelView(xp.total, xp.level, xp.next_level_at) : null;
  const list = badges.data?.data ?? [];
  const earned = [...list].filter((b) => b.earned).sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? ''));
  const locked = list.filter((b) => !b.earned).sort((a, b) => progressRatio(b) - progressRatio(a));

  return (
    <div className="space-y-8" data-testid="badges-page">
      <PageHeader title={t('title')} description={badges.data ? t('subtitle', { earned: badges.data.earned_count, total: list.length }) : undefined} />

      <div className="grid gap-4 sm:grid-cols-3">
        {stats.isPending ? (
          <CardSkeleton lines={2} className="sm:col-span-3" />
        ) : stats.isError ? (
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} className="sm:col-span-3" />
        ) : (
          <>
            <Card className="bg-navy text-navy-foreground sm:col-span-2" data-testid="xp-card" data-xp={xp?.total ?? 0} data-level={lv?.level ?? 1}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-white/70">{t('xpTitle')}</CardTitle>
                <Sparkles className="size-4 text-accent" aria-hidden />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-baseline gap-3">
                  <span className="tabular text-4xl font-extrabold tracking-tight text-accent">{fmt.number(xp?.total ?? 0)}</span>
                  <Badge variant="gold">{t('level', { level: lv?.level ?? 1 })}</Badge>
                </div>
                {lv ? (
                  <div className="space-y-1.5">
                    <Progress value={lv.pct} tone="gold" label={t('toNext', { xp: lv.toNext, level: lv.level + 1 })} className="bg-white/15" />
                    <p className="tabular text-xs text-white/80">{t('toNext', { xp: lv.toNext, level: lv.level + 1 })}</p>
                  </div>
                ) : null}
                <p className="tabular text-xs text-white/70">
                  {t('xpToday', { count: xp?.today ?? 0 })} · {t('xpWeek', { count: xp?.this_week ?? 0 })}
                </p>
              </CardContent>
            </Card>
            <Card data-testid="badges-streak">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t('streakTitle')}</CardTitle>
                <Flame className={cn('size-4', (stats.data?.streak.current ?? 0) > 0 ? 'text-accent' : 'text-muted-foreground')} aria-hidden />
              </CardHeader>
              <CardContent>
                <p className="tabular text-3xl font-extrabold tracking-tight">{t('streakDays', { count: stats.data?.streak.current ?? 0 })}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('streakLongest', { count: stats.data?.streak.longest ?? 0 })}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {badges.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} lines={2} />
          ))}
        </div>
      ) : badges.isError ? (
        <ErrorState error={badges.error} onRetry={() => void badges.refetch()} />
      ) : !list.length ? (
        <EmptyState title={t('empty')} />
      ) : (
        <section aria-labelledby="badge-grid-title" className="space-y-3">
          <h2 id="badge-grid-title" className="text-lg font-semibold">
            {t('gridTitle')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="badge-grid">
            {[...earned, ...locked].map((b) => {
              const Icon = b.earned ? badgeIcon(b) : Lock;
              const p = b.progress;
              const pctValue = p && p.target > 0 ? Math.round((Math.min(p.current, p.target) / p.target) * 100) : b.earned ? 100 : 0;
              return (
                <li
                  key={b.code}
                  className={cn('flex gap-3 rounded-xl border p-4', b.earned ? 'border-accent/60 bg-accent/10' : 'border-border bg-card')}
                  data-testid="badge-tile"
                  data-code={b.code}
                  data-earned={b.earned ? 'true' : 'false'}
                >
                  <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-full', b.earned ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')} aria-hidden>
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {L(b.name)}
                      {b.earned ? (
                        <Badge variant="gold">
                          <Award aria-hidden />
                          {t('earned')}
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">{ruleText(b, t)}</p>
                    {b.earned && b.earned_at ? (
                      <p className="text-xs text-muted-foreground">{t('earnedAt', { date: fmt.dateTime(new Date(b.earned_at), { dateStyle: 'medium' }) })}</p>
                    ) : p ? (
                      <div className="space-y-1">
                        <Progress value={pctValue} label={L(b.name)} />
                        <p className="tabular text-xs text-muted-foreground" data-testid="badge-progress">
                          {t('progress', { current: Math.min(p.current, p.target), target: p.target })}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

const progressRatio = (b: BadgeDto) => (b.progress && b.progress.target ? b.progress.current / b.progress.target : 0);

/** Mô tả luật (web dịch theo dạng rule seed) */
function ruleText(b: BadgeDto, t: ReturnType<typeof useTranslations<'badges'>>): string {
  const r = b.rule as { streak?: number; answered?: number; score_delta?: number; count?: number; kind?: string; event?: string };
  if (typeof r.streak === 'number') return t('rule.streak', { count: r.streak });
  if (typeof r.answered === 'number') return t('rule.answered', { count: r.answered });
  if (typeof r.score_delta === 'number') return t('rule.scoreDelta', { count: r.score_delta });
  if (r.event === 'attempt.graded') return r.kind === 'full' ? t('rule.fullTest', { count: r.count ?? 1 }) : t('rule.attempts', { count: r.count ?? 1 });
  return t('rule.other');
}
