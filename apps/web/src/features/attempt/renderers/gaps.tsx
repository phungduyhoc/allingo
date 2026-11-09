'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { GAP_SPLIT_RE, type WordLimit } from '@allingo/schemas/question/rl-types';
import { cn, Input } from '@allingo/ui';

/**
 * C2 – phần dùng chung của các dạng điền từ IELTS (hoàn thành câu/tóm tắt/ghi chú/bảng/sơ đồ quy trình/biểu mẫu, trả lời ngắn, gán
 * nhãn sơ đồ): chỗ trống `{{id}}` trong văn bản → ô nhập có nhãn "Câu n" (trình đọc màn hình), gợi ý giới hạn từ, trạng thái
 * đúng/sai khi xem lại và đáp án chấp nhận. Ô nhập là `<input>` gốc → phím tắt màn làm bài không bắt phím khi đang gõ.
 */

export interface GapReview {
  /** id → đúng/sai (GradeResult.details) */
  details: Record<string, boolean> | null;
  /** id → các cách viết được chấp nhận (correctAnswerOf) */
  correct: Record<string, string[]> | null;
}

/** Thông điệp giới hạn từ theo i18n ("Không quá HAI từ và/hoặc một số") */
export function useWordLimitText(): (limit: WordLimit | undefined) => string | null {
  const t = useTranslations('attempt.rl');
  return (limit) => {
    if (!limit) return null;
    if (limit.number_only) return t('limitNumber');
    const n = limit.max_words ?? 1;
    return limit.allow_number ? t('limitWordsNumber', { count: n }) : t('limitWords', { count: n });
  };
}

export function WordLimitBadge({ limit, id }: { limit: WordLimit | undefined; id?: string }) {
  const text = useWordLimitText()(limit);
  if (!text) return null;
  return (
    <p id={id} className="inline-flex rounded-md bg-accent/15 px-2 py-1 text-xs font-semibold text-accent-foreground dark:text-accent" data-testid="word-limit">
      {text}
    </p>
  );
}

export interface GapInputProps {
  id: string;
  number: number;
  value: string;
  onChange: (id: string, value: string) => void;
  disabled?: boolean;
  review?: GapReview;
  /** Nhãn truy cập bổ sung (mô tả vị trí nhãn sơ đồ, câu hỏi trả lời ngắn) */
  label?: string;
  describedBy?: string;
  inline?: boolean;
  questionId: string;
}

/** Một chỗ trống: ô nhập + số câu; xem lại → viền đúng/sai, đáp án chấp nhận khi sai */
export function GapInput({ id, number, value, onChange, disabled, review, label, describedBy, inline = true, questionId }: GapInputProps) {
  const t = useTranslations('attempt.rl');
  const ok = review?.details?.[id];
  const accepted = review?.correct?.[id] ?? [];
  return (
    <span className={cn('inline-flex max-w-full flex-col align-baseline', inline ? 'mx-1' : 'w-full')} data-gap={id} data-state={review ? (ok ? 'correct' : 'wrong') : undefined}>
      <span className="inline-flex max-w-full items-center gap-1">
        <span className="tabular rounded bg-muted px-1.5 text-xs font-bold text-muted-foreground" aria-hidden>
          {number}
        </span>
        <Input
          id={`gap-${questionId}-${id}`}
          aria-label={label ? t('gapLabelWith', { number, label }) : t('gapLabel', { number })}
          aria-describedby={describedBy}
          aria-invalid={review && ok === false ? true : undefined}
          value={value}
          disabled={disabled || !!review}
          onChange={(e) => onChange(id, e.target.value)}
          className={cn(
            'h-9 rounded-none border-x-0 border-t-0 border-b-2 bg-transparent px-1 shadow-none focus-visible:ring-0',
            inline ? 'w-36 max-w-[60vw] text-center' : 'w-full max-w-sm',
            review && ok === true && 'border-success text-success',
            review && ok === false && 'border-destructive text-destructive',
          )}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={200}
          data-testid={`gap-input-${id}`}
        />
      </span>
      {review && ok === false && accepted.length ? (
        <span className="mt-0.5 text-xs font-medium text-success" data-testid={`gap-correct-${id}`}>
          {accepted.join(' / ')}
        </span>
      ) : null}
    </span>
  );
}

/** Thứ tự đánh số chỗ trống (1-based) theo thứ tự xuất hiện */
export function gapNumbers(ids: readonly string[]): Map<string, number> {
  return new Map(ids.map((id, i) => [id, i + 1]));
}

/** Văn bản chứa `{{id}}` → các đoạn chữ + chỗ trống (render qua `renderGap`) */
export function GapText({ text, renderGap, className }: { text: string; renderGap: (id: string) => React.ReactNode; className?: string }) {
  const parts = text.split(GAP_SPLIT_RE);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const m = /^\{\{([A-Za-z0-9_-]+)\}\}$/.exec(p);
        return m ? <React.Fragment key={i}>{renderGap(m[1]!)}</React.Fragment> : <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </span>
  );
}
