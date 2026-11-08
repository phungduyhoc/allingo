'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { CHECKIN_FEELINGS, CHECKIN_TEXT_MAX, WEEKDAY_CODES, type PlanAdjustProposal } from '@allingo/schemas/api/learning-plan';
import { Alert, AlertDescription, Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Spinner, Textarea, ToggleChip } from '@allingo/ui';
import { getErrorCode } from '@/lib/errors';
import { useRealtimeEvent } from '@/features/realtime/realtime-provider';
import type { PlanCheckinResult } from '@/lib/plan-api';
import { PROGRAM, useApplyProposal, useCheckin, useProposals } from './queries';
import { ProposalCard } from './proposal-card';

const HOUR_PRESETS = [1, 2, 3, 5, 7] as const;
type Weekday = (typeof WEEKDAY_CODES)[number];

/**
 * Check-in tuần (S9): cảm nhận, giờ thực tế, khó khăn (≤ 500 ký tự – qua guard + che PII ở server), thời gian tuần tới →
 * POST /me/plan/checkin → hiển thị đề xuất điều chỉnh tuần tới (pending → chờ `plan.updated`/polling; ready → Áp dụng;
 * rejected/needs_clarification → lý do/câu hỏi).
 */
export function CheckinDialog({ open, onOpenChange, defaultMinutes }: { open: boolean; onOpenChange: (open: boolean) => void; defaultMinutes?: number | null }) {
  const t = useTranslations('checkin');
  const te = useTranslations('errors');
  const tw = useTranslations('onboarding.weekdays');
  const checkin = useCheckin(PROGRAM);
  const apply = useApplyProposal(PROGRAM);
  const [feeling, setFeeling] = React.useState<(typeof CHECKIN_FEELINGS)[number] | null>(null);
  const [actualHours, setActualHours] = React.useState<string>(defaultMinutes ? String(Math.round((defaultMinutes / 60) * 10) / 10) : '');
  const [difficulties, setDifficulties] = React.useState('');
  const [nextHours, setNextHours] = React.useState<number | null>(null);
  const [nextDays, setNextDays] = React.useState<Weekday[]>([]);
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState<PlanCheckinResult | null>(null);
  const proposalId = result?.adjust?.proposal_id ?? null;
  const proposals = useProposals(PROGRAM, { enabled: open && !!proposalId });
  const proposal: PlanAdjustProposal | null = proposals.data?.find((p) => p.proposal_id === proposalId) ?? null;
  const status = proposal?.status ?? result?.adjust?.status ?? null;

  // Đề xuất đang tạo → realtime `plan.updated` (proposal_id) làm mới; dự phòng polling 3 s khi realtime chưa tới
  useRealtimeEvent('plan.updated', (data) => {
    const d = data as { proposal_id?: string } | null;
    if (proposalId && d?.proposal_id === proposalId) void proposals.refetch();
  });
  React.useEffect(() => {
    if (!open || status !== 'pending') return;
    const id = window.setInterval(() => void proposals.refetch(), 3000);
    return () => window.clearInterval(id);
  }, [open, proposals, status]);

  const reset = () => {
    setResult(null);
    checkin.reset();
    apply.reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const hours = Number(actualHours.replace(',', '.'));
    checkin.mutate(
      {
        ...(feeling ? { feeling } : {}),
        ...(actualHours.trim() && Number.isFinite(hours) ? { actual_minutes: Math.max(0, Math.min(3000, Math.round(hours * 60))) } : {}),
        ...(difficulties.trim() ? { difficulties: difficulties.trim().slice(0, CHECKIN_TEXT_MAX) } : {}),
        ...(nextHours !== null || nextDays.length || note.trim()
          ? { availability_next_week: { ...(nextHours !== null ? { minutes: Math.round(nextHours * 60) } : {}), ...(nextDays.length ? { days: nextDays } : {}), ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}) } }
          : {}),
      },
      {
        onSuccess: (r) => {
          setResult(r);
          if (r.xp_earned > 0) toast.success(t('xpToast', { xp: r.xp_earned }));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
      className="max-w-xl"
      data-testid="checkin-dialog"
    >
      <DialogContent>
        <DialogClose aria-label={t('close')} />
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{result ? t('doneDesc') : t('description')}</DialogDescription>
        </DialogHeader>

        {!result ? (
          <form onSubmit={submit} className="space-y-5" data-testid="checkin-form">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('feeling')}</legend>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('feeling')}>
                {CHECKIN_FEELINGS.map((f) => (
                  <ToggleChip key={f} pressed={feeling === f} onPressedChange={(p) => setFeeling(p ? f : null)} data-testid={`feeling-${f}`}>
                    {t(`feelings.${f}`)}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <Label htmlFor="checkin-actual">{t('actualHours')}</Label>
              <Input id="checkin-actual" inputMode="decimal" type="number" min={0} max={50} step={0.5} value={actualHours} onChange={(e) => setActualHours(e.target.value)} className="max-w-40" data-testid="checkin-actual" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="checkin-difficulties">{t('difficulties')}</Label>
              <Textarea id="checkin-difficulties" maxLength={CHECKIN_TEXT_MAX} value={difficulties} onChange={(e) => setDifficulties(e.target.value)} placeholder={t('difficultiesPlaceholder')} data-testid="checkin-difficulties" />
              <p className="tabular text-right text-xs text-muted-foreground">{t('counter', { count: difficulties.length, max: CHECKIN_TEXT_MAX })}</p>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('nextWeek')}</legend>
              <p className="text-xs text-muted-foreground">{t('nextWeekHint')}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('nextWeekHours')}>
                {HOUR_PRESETS.map((h) => (
                  <ToggleChip key={h} pressed={nextHours === h} onPressedChange={(p) => setNextHours(p ? h : null)} data-testid={`next-hours-${h}`}>
                    {t('hours', { count: h })}
                  </ToggleChip>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1" role="group" aria-label={t('nextWeekDays')}>
                {WEEKDAY_CODES.map((d) => (
                  <ToggleChip key={d} className="min-w-11 px-2.5" pressed={nextDays.includes(d)} onPressedChange={(p) => setNextDays((cur) => (p ? [...cur, d] : cur.filter((x) => x !== d)))} aria-label={tw(`long.${d}`)}>
                    {tw(`short.${d}`)}
                  </ToggleChip>
                ))}
              </div>
              <Input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} aria-label={t('note')} />
            </fieldset>

            {checkin.isError ? (
              <Alert variant="destructive">
                <AlertDescription>{te(`codes.${getErrorCode(checkin.error)}`)}</AlertDescription>
              </Alert>
            ) : null}

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                {t('later')}
              </Button>
              <Button type="submit" variant="navy" disabled={checkin.isPending} data-testid="checkin-submit">
                {checkin.isPending ? <Spinner className="size-4" /> : null}
                {t('submit')}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4" data-testid="checkin-result">
            <p className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="size-5 text-success" aria-hidden />
              {t('saved', { xp: result.xp_earned })}
            </p>
            {!result.difficulties_used && difficulties.trim() ? <p className="text-xs text-muted-foreground">{t('difficultiesBlocked')}</p> : null}
            {!result.adjust ? (
              <p className="text-sm text-muted-foreground">{t('noNextWeek')}</p>
            ) : proposal ? (
              <ProposalCard
                proposal={proposal}
                applying={apply.isPending}
                applyError={apply.error}
                onApply={(p) =>
                  apply.mutate(p.proposal_id, {
                    onSuccess: () => {
                      toast.success(t('applied'));
                      onOpenChange(false);
                      reset();
                    },
                  })
                }
              />
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="proposal-loading">
                <Spinner className="size-4" />
                {t('proposalLoading')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="checkin-close">
                {t('close')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
