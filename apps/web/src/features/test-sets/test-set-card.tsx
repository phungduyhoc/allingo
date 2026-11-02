'use client';

import { Clock, Lock, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { useLocalized } from '@/lib/localized';
import type { TestSetSummary } from '@/lib/types';

export function TestSetCard({ summary, onOpen, busy, compact = false }: { summary: TestSetSummary; onOpen: (s: TestSetSummary) => void; busy?: boolean; compact?: boolean }) {
  const t = useTranslations('testSets');
  const tc = useTranslations('common');
  const L = useLocalized();
  const locked = summary.locked;

  return (
    <article
      className={cn('group relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 transition-colors sm:p-5', locked ? 'opacity-80' : 'hover:border-navy/40 dark:hover:border-accent/50')}
      data-testid={`test-set-${summary.code}`}
      aria-disabled={locked}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={summary.kind === 'full' ? 'default' : 'secondary'}>{t(`kind.${summary.kind}`)}</Badge>
            {summary.is_free ? <Badge variant="outline">{t('free')}</Badge> : null}
            {locked ? (
              <Badge variant="muted">
                <Lock aria-hidden />
                {tc('locked')}
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-2 line-clamp-2 text-base font-semibold break-words sm:text-lg">{L(summary.title)}</h3>
        </div>
      </div>
      {/* Danh sách thông tin (trước đây <dl> chỉ có <dd> – sai cấu trúc, Lighthouse a11y "definition-list") */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <li className="tabular font-medium text-foreground">{tc('questions', { count: summary.question_count })}</li>
        <li className="inline-flex items-center gap-1">
          <Clock className="size-3.5" aria-hidden />
          {summary.duration_sec ? t('duration', { minutes: Math.round(summary.duration_sec / 60) }) : t('noLimit')}
        </li>
        {!compact ? <li>{t('attemptsCount', { count: summary.attempts_count })}</li> : null}
        {summary.best_score !== null ? <li className="text-foreground">{t('best', { score: summary.best_score })}</li> : null}
        {!compact && summary.last_score !== null ? <li>{t('last', { score: summary.last_score })}</li> : null}
      </ul>
      <div className="mt-auto flex items-center justify-between gap-3">
        {locked ? <p className="text-xs text-muted-foreground">{t('lockedHint')}</p> : <span />}
        <Button variant={locked ? 'outline' : 'navy'} size="sm" disabled={locked || busy} onClick={() => onOpen(summary)} aria-label={`${t('start')}: ${L(summary.title)}`}>
          {locked ? <Lock aria-hidden /> : <Play aria-hidden />}
          {t('start')}
        </Button>
      </div>
    </article>
  );
}
