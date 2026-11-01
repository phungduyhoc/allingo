'use client';

import { Check, CloudOff, Lock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, cn, Spinner } from '@allingo/ui';
import { formatAnswer } from '@/lib/format-answer';
import { useLocalized } from '@/lib/localized';
import type { Attempt } from '@/lib/types';
import { Transcript } from '@/features/review/transcript';
import { parseTranscript } from '@/features/review/transcript-format';

export type FeedbackEntry = NonNullable<Attempt['feedback']>[string];

/**
 * Phản hồi tức thì của Practice/drill (từ `GET /attempts/{id}.feedback`): đúng/sai, đáp án đúng, giải thích của tác giả.
 * Chưa có phản hồi → "Đang kiểm tra…" (hoặc báo sẽ hiện khi có mạng).
 */
export function PracticeFeedback({ feedback, checking, online }: { feedback: FeedbackEntry | undefined; checking: boolean; online: boolean }) {
  const transcript = parseTranscript(feedback?.transcript);
  const t = useTranslations('attempt');
  const L = useLocalized();

  if (!feedback) {
    if (!checking) return null;
    return (
      <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="practice-checking">
        {online ? <Spinner className="size-4" aria-hidden /> : <CloudOff className="size-4" aria-hidden />}
        {online ? t('feedbackChecking') : t('feedbackOffline')}
      </p>
    );
  }

  const correct = feedback.is_correct === true;
  const answer = formatAnswer(feedback.correct_answer);
  const explanation = feedback.explanation ? L(feedback.explanation) : '';
  return (
    <div
      className={cn('mt-5 space-y-2 rounded-lg border p-4 text-sm', correct ? 'border-success/40 bg-success/5' : 'border-destructive/40 bg-destructive/5')}
      role="status"
      aria-live="polite"
      data-testid="practice-feedback"
      data-correct={feedback.is_correct}
    >
      <div className="flex flex-wrap items-center gap-2">
        {correct ? (
          <Badge variant="success">
            <Check aria-hidden />
            {t('feedbackCorrect')}
          </Badge>
        ) : (
          <Badge variant="destructive">
            <X aria-hidden />
            {t('feedbackWrong')}
          </Badge>
        )}
        {answer ? <span className="font-semibold" data-testid="practice-correct-answer">{t('feedbackAnswer', { answer })}</span> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="size-3" aria-hidden />
          {t('feedbackLocked')}
        </span>
      </div>
      {explanation ? (
        <div>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{t('feedbackExplanation')}</p>
          <p className="mt-1 leading-relaxed" data-testid="practice-explanation">
            {explanation}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">{t('feedbackNoExplanation')}</p>
      )}
      {/* Listening Part 1/2: transcript của câu (Part 3/4 – transcript nhóm hiện ở đầu nhóm khi cả nhóm đã trả lời) */}
      {transcript && transcript.source !== 'passage' ? <Transcript transcript={transcript} className="mt-3" /> : null}
    </div>
  );
}
