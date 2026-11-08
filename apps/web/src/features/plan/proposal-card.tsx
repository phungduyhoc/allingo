'use client';

import * as React from 'react';
import { ArrowRight, CalendarClock, CircleHelp, TriangleAlert } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import type { PlanAdjustProposal } from '@allingo/schemas/api/learning-plan';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Spinner } from '@allingo/ui';
import { useLocalized } from '@/lib/localized';
import { conflictDetails } from '@/lib/plan-api';
import { getErrorCode } from '@/lib/errors';
import { diffSummary, effectiveStatus, proposalDiff, type DiffKind } from './proposal-diff';
import { formatDay, formatRange } from './progress';
import { TaskIcon } from './task-ui';

const STATUS_VARIANT: Record<PlanAdjustProposal['status'], 'success' | 'gold' | 'destructive' | 'muted' | 'secondary' | 'default'> = {
  pending: 'secondary',
  ready: 'gold',
  rejected: 'destructive',
  needs_clarification: 'secondary',
  applied: 'success',
  expired: 'muted',
  failed: 'destructive',
  superseded: 'muted',
};

const DIFF_KINDS: DiffKind[] = ['removed', 'moved', 'reduced', 'increased', 'added', 'restored'];
const PREVIEW = 6;

export interface ProposalCardProps {
  proposal: PlanAdjustProposal;
  onApply?: (p: PlanAdjustProposal) => void;
  applying?: boolean;
  applyError?: unknown;
  highlight?: boolean;
  className?: string;
}

/** Đề xuất điều chỉnh: trạng thái, tóm tắt, phút trước → sau, danh sách thay đổi (diff before/after), vi phạm, hạn, Áp dụng */
export function ProposalCard({ proposal, onApply, applying, applyError, highlight, className }: ProposalCardProps) {
  const t = useTranslations('plan.proposal');
  const tc = useTranslations('common');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const locale = useLocale();
  const L = useLocalized();
  const status = effectiveStatus(proposal);
  const items = React.useMemo(() => proposalDiff(proposal), [proposal]);
  const summary = diffSummary(items);
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? items : items.slice(0, PREVIEW);
  const conflict = conflictDetails(applyError);
  const conflictViolations = (conflict?.violations as PlanAdjustProposal['violations'] | undefined) ?? [];
  const violations = proposal.violations.length ? proposal.violations : conflictViolations;
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlight]);

  return (
    <Card ref={ref} className={cn(highlight && 'ring-2 ring-accent', className)} data-testid="proposal-card" data-status={status} data-proposal-id={proposal.proposal_id}>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {t(`source.${proposal.source}`)}
            {proposal.week ? (
              <span className="text-sm font-normal text-muted-foreground">
                {t('week', { week: proposal.week.week_no, range: formatRange(proposal.week.start_date, proposal.week.end_date, locale) })}
              </span>
            ) : null}
          </CardTitle>
          <Badge variant={STATUS_VARIANT[status]} data-testid="proposal-status">
            {status === 'pending' ? <Spinner className="size-3" /> : null}
            {t(`status.${status}`)}
          </Badge>
        </div>
        {proposal.summary ? <p className="text-sm">{proposal.summary}</p> : null}
        {status === 'pending' ? <p className="text-sm text-muted-foreground">{t('pendingHint')}</p> : null}
        {status === 'failed' ? <p className="text-sm text-destructive">{t('failedHint')}</p> : null}
        {status === 'needs_clarification' && proposal.clarifying_question ? (
          <p className="flex items-start gap-2 rounded-md bg-secondary/60 p-2.5 text-sm" data-testid="proposal-question">
            <CircleHelp className="mt-0.5 size-4 shrink-0" aria-hidden />
            {proposal.clarifying_question}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {status !== 'pending' && status !== 'failed' ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="tabular flex items-center gap-1.5 font-medium" data-testid="proposal-minutes" data-before={proposal.minutes_before} data-after={proposal.minutes_after}>
              {tc('minutes', { count: proposal.minutes_before })}
              <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
              {tc('minutes', { count: proposal.minutes_after })}
            </span>
            <span className="text-xs text-muted-foreground">
              {proposal.max_minutes !== null ? t('maxMinutes', { budget: proposal.budget_minutes, max: proposal.max_minutes }) : t('budget', { budget: proposal.budget_minutes })}
            </span>
          </div>
        ) : null}

        {items.length ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {DIFF_KINDS.filter((k) => summary[k] > 0)
                .map((k) => t(`diffCount.${k}`, { count: summary[k] }))
                .join(' · ')}
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border" data-testid="proposal-diff">
              {shown.map((i) => (
                <li key={i.task_id} className="flex items-center gap-2.5 px-3 py-2 text-sm" data-kind={i.kinds.join(' ')}>
                  <TaskIcon type={i.task.task_type} className="size-7" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate', i.kinds.includes('removed') && 'text-muted-foreground line-through')}>{L(i.task.title)}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {i.kinds.includes('moved') && i.date_before && i.date_after
                        ? t('movedFromTo', { from: formatDay(i.date_before, locale), to: formatDay(i.date_after, locale) })
                        : formatDay(i.date_after ?? i.date_before ?? i.task.due_date, locale)}
                      {(i.kinds.includes('reduced') || i.kinds.includes('increased')) && i.minutes_before !== null && i.minutes_after !== null ? ` · ${t('minutesFromTo', { from: i.minutes_before, to: i.minutes_after })}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {i.kinds.map((k) => (
                      <Badge key={k} variant={k === 'removed' ? 'muted' : k === 'added' || k === 'restored' ? 'success' : 'secondary'}>
                        {t(`diff.${k}`)}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {items.length > PREVIEW ? (
              <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setExpanded((v) => !v)}>
                {expanded ? t('showLess') : t('showMore', { count: items.length - PREVIEW })}
              </Button>
            ) : null}
          </div>
        ) : status === 'ready' || status === 'applied' ? (
          <p className="text-sm text-muted-foreground">{t('noChanges')}</p>
        ) : null}

        {violations.length ? (
          <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 p-3" data-testid="proposal-violations">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <TriangleAlert className="size-4 text-destructive" aria-hidden />
              {t('violationsTitle')}
            </p>
            <ul className="list-disc space-y-0.5 pl-6 text-sm text-muted-foreground">
              {violations.map((v, idx) => (
                <li key={`${v.code}-${idx}`}>{t.has(`violation.${v.code}`) ? t(`violation.${v.code}`) : (v.detail ?? v.code)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {applyError ? (
          <p role="alert" className="text-sm text-destructive" data-testid="proposal-apply-error">
            {conflict ? t('applyConflict', { status: t(`status.${typeof conflict.status === 'string' && t.has(`status.${conflict.status}`) ? conflict.status : 'rejected'}`) }) : te(`codes.${getErrorCode(applyError)}`)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5" aria-hidden />
            {status === 'applied' && proposal.applied_at
              ? t('appliedAt', { at: fmt.dateTime(new Date(proposal.applied_at), { dateStyle: 'medium', timeStyle: 'short' }) })
              : status === 'expired'
                ? t('expired')
                : t('expiresAt', { at: fmt.dateTime(new Date(proposal.expires_at), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </p>
          {onApply && status === 'ready' ? (
            <Button variant="gold" onClick={() => onApply(proposal)} disabled={applying} data-testid="proposal-apply">
              {applying ? <Spinner className="size-4" /> : null}
              {t('apply')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
