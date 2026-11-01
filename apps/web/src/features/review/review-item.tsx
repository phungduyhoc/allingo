'use client';

import { Check, Flag, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { explanationSchema } from '@allingo/schemas';
import { Badge, cn } from '@allingo/ui';
import { asPublicContent, type AnswerInput, type ReviewItem as ReviewItemT } from '@/lib/types';
import { QuestionRenderer } from '@/features/attempt/question-renderer';
import { AudioPlayer } from '@/features/attempt/audio-player';
import { ExplainPanel } from './explain-panel';

function formatAnswer(a: unknown): string {
  if (a === null || a === undefined) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.map(formatAnswer).join(', ');
  if (typeof a === 'object') {
    const o = a as Record<string, unknown>;
    if ('selected' in o) return formatAnswer(o.selected);
    if ('values' in o) return formatAnswer(o.values);
    if ('blanks' in o) return formatAnswer(o.blanks);
    return Object.entries(o)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? (v as unknown[]).map(String).join('/') : String(v)}`)
      .join('; ');
  }
  return typeof a === 'number' || typeof a === 'boolean' ? String(a) : '';
}

export function ReviewItemCard({ item, number, attemptId }: { item: ReviewItemT; number: number; attemptId: string }) {
  const t = useTranslations('review');
  const ts = useTranslations('sections');
  const ta = useTranslations('attempt');
  const content = asPublicContent(item.question.content);
  const yourAnswer = (item.your_answer ?? null) as AnswerInput | null;
  const correct = item.is_correct;
  const audio = item.question.media.find((m) => m.kind === 'audio');
  const sectionKnown = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'].includes(item.question.section_code);
  const cachedExplanation = item.explanation ? explanationSchema.safeParse({ ...item.explanation, cached: true }) : null;
  const chosen = yourAnswer?.type === 'mcq_single' ? (yourAnswer.selected ?? undefined) : undefined;

  return (
    <article className={cn('rounded-xl border bg-card p-5', correct === true ? 'border-success/40' : correct === false ? 'border-destructive/40' : 'border-border')} data-testid={`review-item-${number}`} data-correct={correct}>
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tabular text-sm font-semibold">{number}.</span>
        <Badge variant="secondary">{sectionKnown ? ts(item.question.section_code as 'part1').split(' · ')[0] : item.question.section_code}</Badge>
        {correct === true ? (
          <Badge variant="success">
            <Check aria-hidden />
            {t('correct')}
          </Badge>
        ) : correct === false ? (
          <Badge variant="destructive">
            <X aria-hidden />
            {t('wrong')}
          </Badge>
        ) : null}
        {item.flagged ? (
          <Badge variant="gold">
            <Flag aria-hidden />
          </Badge>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-3 text-xs text-muted-foreground">
          {item.community_correct_rate !== null ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {t('community', { rate: Math.round(item.community_correct_rate) })}
            </span>
          ) : null}
          {item.time_spent_ms !== null ? <span className="tabular">{t('timeSpent', { seconds: Math.round(item.time_spent_ms / 1000) })}</span> : null}
        </span>
      </header>

      {item.question.passage?.body ? (
        <details className="mb-3 rounded-lg border border-border bg-background p-3 text-sm">
          <summary className="cursor-pointer font-medium">{item.question.passage.title ?? ta('passageTitle')}</summary>
          <div className="mt-2 leading-relaxed whitespace-pre-wrap">{item.question.passage.body}</div>
        </details>
      ) : null}

      {audio ? <AudioPlayer src={audio.url} policy="free" className="mb-3" /> : null}

      {content?.stem && content.type !== 'fill_blank' ? (
        <p id={`q-${item.question.question_id}-stem`} className="mb-4 text-base leading-relaxed font-medium">
          {content.stem}
        </p>
      ) : null}

      {content ? (
        <QuestionRenderer
          questionId={item.question.question_id}
          content={content}
          answer={yourAnswer}
          onChange={() => undefined}
          review={{ correctAnswer: item.correct_answer, details: item.details, isCorrect: item.is_correct }}
        />
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('yourAnswer')}</dt>
          <dd className={cn('font-semibold', correct === false && 'text-destructive')}>{yourAnswer && formatAnswer(yourAnswer) ? formatAnswer(yourAnswer) : t('noAnswer')}</dd>
        </div>
        <div className="rounded-lg bg-success/10 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('correctAnswer')}</dt>
          <dd className="font-semibold text-success">{formatAnswer(item.correct_answer)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <ExplainPanel questionVersionId={item.question.question_version_id} chosenOption={chosen} attemptId={attemptId} initial={cachedExplanation?.success ? cachedExplanation.data : null} />
      </div>
    </article>
  );
}
