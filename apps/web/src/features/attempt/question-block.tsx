'use client';

import * as React from 'react';
import { Flag } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { asPublicContent, type AnswerInput, type QuestionPublic } from '@/lib/types';
import { AudioPlayer } from './audio-player';
import { PracticeFeedback, type FeedbackEntry } from './practice-feedback';
import { QuestionRenderer } from './question-renderer';
import { isAnswered } from './attempt-state';

export interface QuestionBlockProps {
  question: QuestionPublic;
  /** Số thứ tự hiển thị (1-based) */
  number: number;
  total: number;
  answer: AnswerInput | null;
  flagged: boolean;
  /** Câu đang xem (nhận phím tắt); trong nhóm đoạn văn được tô viền */
  current: boolean;
  /** Đang hiển thị trong nhóm nhiều câu dùng chung đoạn văn */
  inGroup?: boolean;
  onActivate?: () => void;
  onAnswer: (answer: AnswerInput) => void;
  onToggleFlag: () => void;
  disabled?: boolean;
  /** Hệ số cỡ chữ (CSS zoom) */
  zoom: number;
  audio?: { policy: 'once' | 'free'; played: boolean; onPlayed: () => void; onStarted: () => void };
  /** Practice/drill: phản hồi đúng/sai tức thì */
  practice?: { feedback: FeedbackEntry | undefined; checking: boolean; locked: boolean; online: boolean; onCheck: () => void };
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

/** Một câu hỏi trong màn làm bài (đề bài, audio, lựa chọn, đánh dấu, phản hồi Practice) */
export function QuestionBlock({ question, number, total, answer, flagged, current, inGroup = false, onActivate, onAnswer, onToggleFlag, disabled, zoom, audio, practice, badge, children }: QuestionBlockProps) {
  const t = useTranslations('attempt');
  const content = asPublicContent(question.content);
  const stemId = `q-${question.question_id}-stem`;
  const media = question.media.find((m) => m.kind === 'audio');
  const feedback = practice?.feedback;
  // Có phản hồi → hiển thị như Review (tô đúng/sai, không cho sửa)
  const review = feedback ? { correctAnswer: feedback.correct_answer, details: null, isCorrect: feedback.is_correct } : undefined;
  const needsCheckButton = !!practice && !practice.locked && content?.type !== 'mcq_single';

  return (
    <section
      id={`qblock-${question.question_id}`}
      aria-labelledby={stemId}
      aria-current={inGroup && current ? 'true' : undefined}
      className={cn('scroll-mt-24 rounded-xl border bg-card p-5 sm:p-6', inGroup && current ? 'border-accent ring-2 ring-accent/40' : 'border-border')}
      data-testid={current ? 'question-card' : 'question-block'}
      data-number={number}
      onFocusCapture={inGroup && !current ? onActivate : undefined}
      onPointerDownCapture={inGroup && !current ? onActivate : undefined}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="tabular text-sm font-semibold text-muted-foreground">{t('questionOf', { current: number, total })}</span>
          {badge}
          {practice?.locked && !feedback ? <Badge variant="muted">{t('feedbackLocked')}</Badge> : null}
        </div>
        <Button variant={flagged ? 'gold' : 'outline'} size="sm" onClick={onToggleFlag} aria-pressed={flagged} data-testid={current ? 'flag-button' : undefined}>
          <Flag className={cn(flagged && 'fill-current')} aria-hidden />
          {flagged ? t('flagged') : t('flag')}
        </Button>
      </div>

      <div style={zoom !== 1 ? { zoom } : undefined}>
        {media && audio ? (
          <AudioPlayer key={question.question_id} src={media.url} policy={audio.policy} played={audio.played} onPlayed={audio.onPlayed} onStarted={audio.onStarted} autoPlay={false} className="mb-4" />
        ) : null}

        {content?.stem && content.type !== 'fill_blank' ? (
          <p id={stemId} className="mb-5 text-lg leading-relaxed font-medium">
            {content.stem}
          </p>
        ) : (
          <span id={stemId} className="sr-only">
            {t('questionNumber', { number })}
          </span>
        )}

        {content ? <QuestionRenderer questionId={question.question_id} content={content} answer={answer} onChange={onAnswer} disabled={disabled || practice?.locked} review={review} /> : null}
      </div>

      {practice ? (
        <>
          {needsCheckButton ? (
            <Button variant="outline" size="sm" className="mt-4" onClick={practice.onCheck} disabled={disabled || !isAnswered(answer)} data-testid="practice-check">
              {t('feedbackCheck')}
            </Button>
          ) : null}
          <PracticeFeedback feedback={feedback} checking={practice.checking} online={practice.online} />
        </>
      ) : null}

      {children}
    </section>
  );
}
