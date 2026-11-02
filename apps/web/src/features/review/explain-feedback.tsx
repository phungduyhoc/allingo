'use client';

import * as React from 'react';
import { MessageSquarePlus, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, Label, Textarea } from '@allingo/ui';
import { useAiFeedback } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import { feedbackStore, readFeedback, type FeedbackRating } from './feedback-memory';

const OPTIONS = [
  ['helpful', ThumbsUp, 'feedbackHelpful'],
  ['not_helpful', ThumbsDown, 'feedbackNotHelpful'],
  ['wrong', TriangleAlert, 'feedbackWrong'],
] as const;

const NOTE_MAX = 1000;

/**
 * Đánh giá một giải thích AI: 👍 Hữu ích / 👎 Chưa hữu ích / Sai (+ ghi chú tuỳ chọn) → POST /ai/feedback.
 * Lựa chọn được nhớ theo ai_task_id (và khoá nội dung – xem feedback-memory.ts); đổi lựa chọn gửi lại cho cùng ai_task_id
 * (API cập nhật). `resolveTaskId` lấy ai_task_id khi giải thích kèm Review chưa có (ai_task_id = null).
 */
export function ExplainFeedback({ aiTaskId, contentKey, resolveTaskId }: { aiTaskId: string | null; contentKey: string | null; resolveTaskId: () => Promise<string | null> }) {
  const t = useTranslations('review');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const store = React.useSyncExternalStore(feedbackStore.subscribe, feedbackStore.getSnapshot, feedbackStore.getServerSnapshot);
  const remembered = readFeedback(store, aiTaskId, contentKey);
  const feedback = useAiFeedback();
  const [resolving, setResolving] = React.useState(false);
  const [message, setMessage] = React.useState<'thanks' | 'updated' | 'noteSaved' | null>(null);
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const noteId = React.useId();
  const busy = feedback.isPending || resolving;

  const send = async (rating: FeedbackRating, comment?: string) => {
    let target = remembered?.ai_task_id ?? aiTaskId;
    if (!target) {
      setResolving(true);
      try {
        target = await resolveTaskId();
      } catch (err) {
        toast.error(te(`codes.${getErrorCode(err)}`));
        return;
      } finally {
        setResolving(false);
      }
    }
    if (!target) {
      toast.error(te('codes.internal'));
      return;
    }
    const taskId = target;
    // API ghi đè comment mỗi lần gửi → đổi đánh giá vẫn giữ ghi chú cũ
    const text = (comment ?? remembered?.comment ?? '').trim().slice(0, NOTE_MAX);
    feedback.mutate(
      { ai_task_id: taskId, rating, ...(text ? { comment: text } : {}) },
      {
        onSuccess: (res) => {
          const wasRated = !!remembered;
          feedbackStore.save({ ai_task_id: taskId, rating, ...(text ? { comment: text } : {}), at: Date.now() }, contentKey);
          setMessage(comment !== undefined ? 'noteSaved' : res.updated || wasRated ? 'updated' : 'thanks');
          if (comment !== undefined) setNoteOpen(false);
          else if (!wasRated && rating !== 'helpful') setNoteOpen(true);
        },
        onError: (err) => toast.error(te(`codes.${getErrorCode(err)}`)),
      },
    );
  };

  const statusText = message === 'updated' ? t('feedbackUpdated') : message === 'noteSaved' ? t('feedbackNoteSaved') : remembered ? t('feedbackThanks') : t('feedbackQuestion');

  return (
    <div className="space-y-2 border-t border-accent/40 pt-3" data-testid="explain-feedback" data-rating={remembered?.rating ?? ''}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('feedbackGroup')}>
        <span className="text-xs text-muted-foreground" data-testid="feedback-status" aria-live="polite">
          {statusText}
        </span>
        {OPTIONS.map(([rating, Icon, key]) => {
          const selected = remembered?.rating === rating;
          return (
            <Button
              key={rating}
              variant={selected ? 'navy' : 'outline'}
              size="sm"
              aria-pressed={selected}
              aria-label={t(key)}
              disabled={busy}
              data-testid={`feedback-${rating}`}
              data-selected={selected}
              onClick={() => void send(rating)}
            >
              <Icon aria-hidden />
              <span className="hidden sm:inline">{t(key)}</span>
            </Button>
          );
        })}
        {remembered && !noteOpen ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNote(remembered.comment ?? '');
              setNoteOpen(true);
            }}
            data-testid="feedback-note-toggle"
          >
            <MessageSquarePlus aria-hidden />
            {t('feedbackNoteToggle')}
          </Button>
        ) : null}
      </div>
      {remembered && noteOpen ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(remembered.rating, note);
          }}
        >
          <Label htmlFor={noteId} className="text-xs">
            {t('feedbackNoteLabel')}
          </Label>
          <Textarea id={noteId} value={note} maxLength={NOTE_MAX} rows={2} placeholder={t('feedbackNotePlaceholder')} onChange={(e) => setNote(e.target.value)} data-testid="feedback-note" className="text-sm" />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="navy" disabled={busy || note.trim().length === 0} data-testid="feedback-note-submit">
              {t('feedbackNoteSubmit')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNoteOpen(false)}>
              {tc('cancel')}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
