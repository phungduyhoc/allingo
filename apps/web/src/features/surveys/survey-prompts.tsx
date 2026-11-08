'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, HeartHandshake, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, buttonVariants, Card, CardContent, cn, Label, Spinner, Textarea } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { useExamLock } from '@/lib/exam-lock';
import { getErrorCode } from '@/lib/errors';
import { getPendingSurveys, s12Keys, submitNps } from '@/lib/s12-api';
import { betaOnboardingPending, npsBucket, npsToShow, readNpsSnoozes, snoozeNps } from '@/lib/surveys';

/**
 * Khảo sát in-app trên dashboard (S12): NPS ngày 7/14 (thang 0–10 + lý do, `POST /me/surveys/nps`) và nhắc khảo sát onboarding
 * beta. Đặt trong luồng trang (không phủ nội dung, không bẫy focus); không hiện khi Exam Mode; "Để sau" ẩn 24 giờ. Tài khoản
 * khách không có khảo sát (không gọi API).
 */
export function SurveyPrompts() {
  const me = useMe();
  const lock = useExamLock();
  const enabled = !!me.data && !me.data.is_guest;
  const pending = useQuery({ queryKey: s12Keys.pendingSurveys, queryFn: getPendingSurveys, enabled, staleTime: 10 * 60_000, retry: false });
  const [snoozes, setSnoozes] = React.useState<Partial<Record<string, number>>>(() => (typeof window === 'undefined' ? {} : readNpsSnoozes()));
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  if (!enabled || !pending.data) return null;
  const nps = npsToShow({ pending: pending.data.data, examLocked: lock.locked || lock.pending, snoozedUntil: snoozes, dismissed });
  const onboarding = betaOnboardingPending(pending.data.data) && !dismissed.has('beta_onboarding');
  if (!nps && !onboarding) return null;
  return (
    <div className="space-y-3">
      {onboarding ? <BetaSurveyReminder onDismiss={() => setDismissed((s) => new Set(s).add('beta_onboarding'))} /> : null}
      {nps ? (
        <NpsCard
          kind={nps.kind}
          onSnooze={() => setSnoozes(snoozeNps(nps.kind))}
          onSubmitted={() => setDismissed((s) => new Set(s).add(nps.kind))}
        />
      ) : null}
    </div>
  );
}

function BetaSurveyReminder({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations('surveys');
  return (
    <Card className="border-accent/60 bg-accent/10" data-testid="beta-survey-reminder">
      <CardContent className="flex flex-wrap items-center gap-3 p-4">
        <ClipboardList className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">{t('onboardingTitle')}</span> <span className="text-muted-foreground">{t('onboardingDesc')}</span>
        </p>
        <Link href="/onboarding/beta" className={buttonVariants({ variant: 'navy', size: 'sm' })}>
          {t('onboardingCta')}
        </Link>
        <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label={t('later')}>
          <X aria-hidden />
        </Button>
      </CardContent>
    </Card>
  );
}

function NpsCard({ kind, onSnooze, onSubmitted }: { kind: 'nps_d7' | 'nps_d14'; onSnooze: () => void; onSubmitted: () => void }) {
  const t = useTranslations('surveys');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const id = React.useId();
  const [score, setScore] = React.useState<number | null>(null);
  const [comment, setComment] = React.useState('');
  const [thanks, setThanks] = React.useState(false);
  const send = useMutation({
    mutationFn: () => submitNps({ score: score!, survey: kind, ...(comment.trim() ? { comment: comment.trim().slice(0, 2000) } : {}) }),
    onSuccess: () => {
      setThanks(true);
      void qc.invalidateQueries({ queryKey: s12Keys.pendingSurveys });
      window.setTimeout(onSubmitted, 4000);
    },
    // 409 not_due (hết khung) → ẩn luôn
    onError: (err) => {
      if (getErrorCode(err) === 'conflict') onSubmitted();
    },
  });

  if (thanks) {
    return (
      <Card className="border-success/40" data-testid="nps-thanks">
        <CardContent className="flex items-center gap-3 p-4 text-sm" role="status">
          <HeartHandshake className="size-5 shrink-0 text-success" aria-hidden />
          {t('thanks')}
        </CardContent>
      </Card>
    );
  }
  const bucket = score === null ? null : npsBucket(score);
  return (
    <section aria-labelledby={`${id}-title`} className="rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="nps-card" data-kind={kind}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="font-semibold">
            {t('npsTitle')}
          </h2>
          <p className="text-sm text-muted-foreground">{t(kind === 'nps_d14' ? 'npsDescD14' : 'npsDescD7')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onSnooze} data-testid="nps-later">
          {t('later')}
        </Button>
      </div>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (score !== null && !send.isPending) send.mutate();
        }}
      >
        <fieldset>
          <legend className="sr-only">{t('npsQuestion')}</legend>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
            {Array.from({ length: 11 }, (_, n) => (
              <label key={n} className="relative block" data-testid={`nps-option-${n}`}>
                <input type="radio" name={`${id}-score`} value={n} checked={score === n} onChange={() => setScore(n)} className="peer sr-only" data-testid={`nps-score-${n}`} />
                <span
                  className={cn(
                    'flex h-10 cursor-pointer items-center justify-center rounded-md border text-sm font-semibold tabular transition-colors select-none',
                    'peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/40',
                    score === n ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-input hover:bg-muted',
                  )}
                >
                  {n}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground" aria-hidden>
            <span>{t('scaleLow')}</span>
            <span>{t('scaleHigh')}</span>
          </div>
        </fieldset>
        {score !== null ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-comment`}>{bucket === 'promoter' ? t('reasonPromoter') : bucket === 'passive' ? t('reasonPassive') : t('reasonDetractor')}</Label>
            <Textarea id={`${id}-comment`} rows={3} value={comment} onChange={(e) => setComment(e.target.value.slice(0, 2000))} placeholder={t('reasonPlaceholder')} data-testid="nps-comment" />
          </div>
        ) : null}
        {send.isError && getErrorCode(send.error) !== 'conflict' ? (
          <p role="alert" className="text-sm text-destructive">
            {te(`codes.${getErrorCode(send.error)}`)}
          </p>
        ) : null}
        <Button type="submit" variant="navy" size="sm" disabled={score === null || send.isPending} data-testid="nps-submit">
          {send.isPending ? <Spinner aria-hidden /> : null}
          {t('submit')}
        </Button>
      </form>
    </section>
  );
}
