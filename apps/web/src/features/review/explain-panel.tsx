'use client';

import * as React from 'react';
import { Sparkles, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle, Badge, Button, buttonVariants, cn, Skeleton } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useAiFeedback } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import type { Explanation } from '@/lib/types';
import { useExplain } from './use-explain';

export function ExplainPanel({ questionVersionId, chosenOption, attemptId, initial }: { questionVersionId: string; chosenOption?: string; attemptId: string; initial: Explanation | null }) {
  const t = useTranslations('review');
  const te = useTranslations('errors');
  const { state, run } = useExplain(initial);
  const feedback = useAiFeedback();
  const [rated, setRated] = React.useState<string | null>(null);

  const start = () => void run({ question_version_id: questionVersionId, chosen_option: chosenOption, attempt_id: attemptId });

  if (state.status === 'idle') {
    return (
      <Button variant="gold" size="sm" onClick={start} data-testid="explain-button">
        <Sparkles aria-hidden />
        {t('explain')}
      </Button>
    );
  }

  if (state.status === 'error') {
    const code = getErrorCode(state.error);
    if (code === 'quota_exceeded' || code === 'insufficient_credits') {
      return (
        <Alert variant="gold" data-testid="explain-quota">
          <TriangleAlert aria-hidden />
          <AlertTitle>{code === 'quota_exceeded' ? t('quotaTitle') : t('creditsTitle')}</AlertTitle>
          <AlertDescription>
            {t('quotaDesc')}
            <Link href="/settings" className={cn(buttonVariants({ variant: 'gold', size: 'sm' }), 'mt-2')}>
              {t('quotaCta')}
            </Link>
          </AlertDescription>
        </Alert>
      );
    }
    return (
      <Alert variant="destructive">
        <TriangleAlert aria-hidden />
        <AlertTitle>{code === 'exam_mode_locked' ? t('examLocked') : t('error')}</AlertTitle>
        <AlertDescription>
          {te(`codes.${code}`)}
          <div className="mt-2">
            <Button variant="outline" size="sm" onClick={start}>
              {t('explain')}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  const d = state.data;
  return (
    <div className="rounded-xl border border-accent/60 bg-accent/10 p-4" data-testid="explanation" data-cached={state.cached} aria-live="polite">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-accent-foreground dark:text-accent" aria-hidden />
        <span className="font-semibold">{t('explanationTitle')}</span>
        {state.status === 'streaming' ? <Badge variant="muted">{t('explaining')}</Badge> : null}
        {state.cached ? <Badge variant="outline">{t('fromCache')}</Badge> : null}
      </div>

      {state.status === 'streaming' && !d ? (
        // API stream `delta` là mảnh JSON của structured output (không phải văn xuôi) → hiện tiến trình thay vì JSON thô;
        // chỉ hiển thị trực tiếp khi provider stream văn bản thường.
        /^\s*[{[]/.test(state.streamText) || state.streamText.length === 0 ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-3 w-11/12 bg-accent/30" />
            <Skeleton className="h-3 w-4/5 bg-accent/30" />
            <Skeleton className="h-3 w-2/3 bg-accent/30" />
            <p className="tabular text-xs text-muted-foreground">{state.streamText.length > 0 ? `${state.streamText.length}…` : ''}</p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {state.streamText}
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-foreground align-middle" aria-hidden />
          </p>
        )
      ) : d ? (
        <div className="space-y-3 text-sm leading-relaxed">
          <Section title={t('whyCorrect')}>
            <span className="omr-bubble mr-2 size-6 text-xs">{d.correct_option}</span>
            {d.why_correct}
          </Section>
          {Object.keys(d.why_others_wrong).length ? (
            <Section title={t('whyOthersWrong')}>
              <ul className="space-y-1">
                {Object.entries(d.why_others_wrong).map(([k, v]) => (
                  <li key={k} className="flex gap-2">
                    <span className="omr-bubble size-6 text-xs">{k}</span>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {d.chosen_option_trap ? <Section title={t('chosenTrap')}>{d.chosen_option_trap}</Section> : null}
          <Section title={t('howToSpot')}>{d.how_to_spot}</Section>
          {d.tested_point ? <Section title={t('testedPoint')}>{d.tested_point}</Section> : null}
          {d.key_vocab?.length ? (
            <Section title={t('keyVocab')}>
              <ul className="flex flex-wrap gap-2">
                {d.key_vocab.map((v) => (
                  <li key={v.term} className="rounded-md border border-border bg-card px-2 py-1">
                    <span className="font-semibold">{v.term}</span>
                    {v.reading ? <span className="text-muted-foreground"> {v.reading}</span> : null}
                    <span className="text-muted-foreground"> — {v.meaning}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {d.related_points.length ? (
            <Section title={t('relatedPoints')}>
              <ul className="flex flex-wrap gap-1.5">
                {d.related_points.map((p, i) => (
                  <li key={`${p.type}-${p.code ?? p.ref_id ?? i}`}>
                    <Badge variant="secondary">{p.label}</Badge>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {state.aiTaskId ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-accent/40 pt-3">
              <span className="text-xs text-muted-foreground">{rated ? t('feedbackThanks') : t('feedbackQuestion')}</span>
              {!rated
                ? (
                    [
                      ['helpful', ThumbsUp, t('feedbackHelpful')],
                      ['not_helpful', ThumbsDown, t('feedbackNotHelpful')],
                      ['wrong', TriangleAlert, t('feedbackWrong')],
                    ] as const
                  ).map(([rating, Icon, label]) => (
                    <Button
                      key={rating}
                      variant="outline"
                      size="sm"
                      aria-label={label}
                      disabled={feedback.isPending}
                      onClick={() =>
                        feedback.mutate(
                          { ai_task_id: state.aiTaskId!, rating },
                          {
                            onSuccess: () => setRated(rating),
                            onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
                          },
                        )
                      }
                    >
                      <Icon aria-hidden />
                      <span className="hidden sm:inline">{label}</span>
                    </Button>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{title}</p>
      <div>{children}</div>
    </div>
  );
}
