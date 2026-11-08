'use client';

import * as React from 'react';
import { Flag, Lock, Volume2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, cn } from '@allingo/ui';
import { asPublicContent, type AnswerInput, type QuestionPublic } from '@/lib/types';
import { AudioPlayer } from './audio-player';
import { PracticeFeedback, type FeedbackEntry } from './practice-feedback';
import { QuestionRenderer } from './question-renderer';
import { QuestionStem } from './question-stem';
import { isAnswered } from './attempt-state';
import { ReportQuestionButton } from '@/features/content-report/report-question-button';

/** Trạng thái nghe của câu trong Exam Mode (chuỗi phát một lần) */
export type ListenStatus = 'upcoming' | 'playing' | 'played';

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
  /** Trình phát tự do (Practice/drill, hoặc câu `listen_policy = 'free'`); Exam Mode "nghe một lần" không có */
  audio?: { src: string; onError: () => void; onStarted?: () => void } | null;
  /** URL ảnh (Part 1) đã gia hạn theo asset id */
  imageUrl?: (assetId: string, fallback: string) => string;
  /** Exam Mode: trạng thái nghe; `upcoming` → chưa chọn được đáp án */
  listen?: ListenStatus | null;
  /** Practice/drill: phản hồi đúng/sai tức thì */
  practice?: { feedback: FeedbackEntry | undefined; checking: boolean; locked: boolean; online: boolean; onCheck: () => void };
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

const DIRECTION_SECTIONS = new Set(['part1', 'part2']);

/** Một câu hỏi trong màn làm bài (đề bài, audio/ảnh, lựa chọn, đánh dấu, phản hồi Practice) */
export function QuestionBlock({ question, number, total, answer, flagged, current, inGroup = false, onActivate, onAnswer, onToggleFlag, disabled, zoom, audio, imageUrl, listen, practice, badge, children }: QuestionBlockProps) {
  const t = useTranslations('attempt');
  const content = asPublicContent(question.content);
  const stemId = `q-${question.question_id}-stem`;
  const images = question.media.filter((m) => m.kind === 'image');
  const feedback = practice?.feedback;
  // Có phản hồi → hiển thị như Review (tô đúng/sai, không cho sửa)
  const review = feedback ? { correctAnswer: feedback.correct_answer, details: null, isCorrect: feedback.is_correct } : undefined;
  const needsCheckButton = !!practice && !practice.locked && content?.type !== 'mcq_single';
  const listenLocked = listen === 'upcoming';
  // Part 1/2: đề và lựa chọn được ĐỌC trong audio (API xoá chữ khi đang làm bài) → hướng dẫn chung thay cho đề
  const direction = !content?.stem && DIRECTION_SECTIONS.has(question.section_code) ? t(`directions.${question.section_code as 'part1' | 'part2'}`) : null;

  return (
    <section
      id={`qblock-${question.question_id}`}
      aria-labelledby={stemId}
      aria-current={inGroup && current ? 'true' : undefined}
      className={cn('scroll-mt-24 rounded-xl border bg-card p-5 sm:p-6', inGroup && current ? 'border-accent ring-2 ring-accent/40' : 'border-border')}
      data-testid={current ? 'question-card' : 'question-block'}
      data-number={number}
      data-listen={listen ?? undefined}
      onFocusCapture={inGroup && !current ? onActivate : undefined}
      onPointerDownCapture={inGroup && !current ? onActivate : undefined}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="tabular text-sm font-semibold text-muted-foreground">{t('questionOf', { current: number, total })}</span>
          {badge}
          {listen === 'playing' ? (
            <Badge variant="gold" data-testid="listen-now">
              <Volume2 className="animate-pulse" aria-hidden />
              {t('listenNow')}
            </Badge>
          ) : listen === 'upcoming' ? (
            <Badge variant="muted">
              <Lock aria-hidden />
              {t('listenUpcoming')}
            </Badge>
          ) : null}
          {practice?.locked && !feedback ? <Badge variant="muted">{t('feedbackLocked')}</Badge> : null}
        </div>
        <Button variant={flagged ? 'gold' : 'outline'} size="sm" onClick={onToggleFlag} aria-pressed={flagged} data-testid={current ? 'flag-button' : undefined}>
          <Flag className={cn(flagged && 'fill-current')} aria-hidden />
          {flagged ? t('flagged') : t('flag')}
        </Button>
      </div>

      <div style={zoom !== 1 ? { zoom } : undefined}>
        {/* Part 3/4: audio câu hỏi (người dẫn đọc) – trình phát gọn; tua/tốc độ/lặp ở trình phát của cả nhóm */}
        {audio ? <AudioPlayer key={question.question_id} src={audio.src} compact={question.passage?.kind === 'audio_script'} onError={audio.onError} onStarted={audio.onStarted} label={t('audioQuestionLabel', { number })} className="mb-4" /> : null}

        {images.length ? (
          <div className="mb-4 flex flex-wrap gap-3">
            {images.map((m) => (
              // eslint-disable-next-line @next/next/no-img-element -- ảnh nội dung qua URL ký hết hạn (không tối ưu bằng next/image)
              <img
                key={m.id}
                src={imageUrl ? imageUrl(m.id, m.url) : m.url}
                alt={t('questionImageAlt', { number })}
                className="max-h-80 w-full max-w-xl rounded-lg border border-border bg-muted object-contain"
                data-testid="question-image"
              />
            ))}
          </div>
        ) : null}

        {content?.stem && content.type !== 'fill_blank' ? (
          <QuestionStem id={stemId} stem={content.stem} className="mb-5 text-lg leading-relaxed font-medium" />
        ) : direction ? (
          <p id={stemId} className="mb-4 text-sm text-muted-foreground" data-testid="listening-direction">
            {direction}
          </p>
        ) : (
          <span id={stemId} className="sr-only">
            {t('questionNumber', { number })}
          </span>
        )}

        {content ? <QuestionRenderer questionId={question.question_id} content={content} answer={answer} onChange={onAnswer} disabled={disabled || practice?.locked || listenLocked} review={review} /> : null}
      </div>

      {practice ? (
        <>
          {needsCheckButton ? (
            <Button variant="outline" size="sm" className="mt-4" onClick={practice.onCheck} disabled={disabled || !isAnswered(answer)} data-testid="practice-check">
              {t('feedbackCheck')}
            </Button>
          ) : null}
          <PracticeFeedback feedback={feedback} checking={practice.checking} online={practice.online} />
          {/* S12: báo lỗi câu – chỉ Practice/drill (Exam Mode không có khối practice) */}
          <div className="mt-3 flex justify-end">
            <ReportQuestionButton questionVersionId={question.question_version_id} number={number} />
          </div>
        </>
      ) : null}

      {children}
    </section>
  );
}
