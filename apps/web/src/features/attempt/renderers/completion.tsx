'use client';

import * as React from 'react';
import { ArrowDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { gapIdsOf } from '@allingo/schemas/question/content';
import { cn } from '@allingo/ui';
import type { PublicQuestionContent } from '@/lib/types';
import { useNumberBase } from './number-base';
import { gapNumbers, GapInput, GapText, WordLimitBadge, type GapReview } from './gaps';
import type { RendererProps, ReviewInfo } from './types';
import { DiagramFigure } from './figure';

/**
 * C2 – renderer dạng điền từ IELTS (8 dạng): hoàn thành câu, tóm tắt, ghi chú, bảng, sơ đồ quy trình, biểu mẫu, trả lời ngắn, gán
 * nhãn sơ đồ. Câu trả lời `{ type, gaps: { id: chuỗi } }`; mỗi chỗ trống một ô nhập có nhãn "Câu n" + gợi ý giới hạn từ.
 * Bảng nằm trong vùng cuộn ngang riêng (trang không tràn ngang ở 360 px).
 */

type CompletionType = 'sentence_completion' | 'summary_completion' | 'note_completion' | 'table_completion' | 'flow_chart_completion' | 'form_completion' | 'short_answer' | 'diagram_labelling';
type Content = Extract<PublicQuestionContent, { type: CompletionType }>;
type Answer = { type: CompletionType; gaps: Record<string, string> };

export const COMPLETION_TYPES: ReadonlySet<string> = new Set<CompletionType>(['sentence_completion', 'summary_completion', 'note_completion', 'table_completion', 'flow_chart_completion', 'form_completion', 'short_answer', 'diagram_labelling']);

function toGapReview(review: ReviewInfo | undefined, values: Record<string, string>, ids: readonly string[]): GapReview | undefined {
  if (!review) return undefined;
  const correct = (review.correctAnswer ?? null) as Record<string, string[]> | null;
  // Practice không có details cũ → suy từ kết quả cả câu (đúng hết) hoặc so khớp đơn giản với đáp án đầu
  const details = review.details ?? (review.isCorrect === true ? Object.fromEntries(ids.map((id) => [id, true])) : Object.fromEntries(ids.map((id) => [id, (correct?.[id] ?? []).some((a) => a.trim().toLowerCase() === (values[id] ?? '').trim().toLowerCase())])));
  return { details, correct };
}

export function Completion({ content, answer, onChange, disabled, review, questionId, resolveImage }: RendererProps<Content, Answer> & { resolveImage?: (assetId: string) => string | null }) {
  const t = useTranslations('attempt.rl');
  const ids = gapIdsOf(content as unknown as Parameters<typeof gapIdsOf>[0]);
  const numbers = gapNumbers(ids, useNumberBase());
  const values = answer?.gaps ?? {};
  const gapReview = toGapReview(review, values, ids);
  const limitId = `q-${questionId}-limit`;
  const meta = new Map((content.gaps ?? []).map((g) => [g.id, g]));
  const set = (id: string, v: string) => onChange({ type: content.type, gaps: { ...values, [id]: v } });
  const gap = (id: string, opts: { inline?: boolean; label?: string } = {}) => (
    <GapInput key={id} id={id} number={numbers.get(id) ?? 0} value={values[id] ?? ''} onChange={set} disabled={disabled} review={gapReview} questionId={questionId} describedBy={content.word_limit ? limitId : undefined} label={opts.label ?? meta.get(id)?.label} inline={opts.inline ?? true} />
  );
  const title = 'title' in content && content.title ? <h3 className="mb-2 text-base font-bold">{content.title}</h3> : null;

  let body: React.ReactNode;
  switch (content.type) {
    case 'sentence_completion':
      body = (
        <ol className="space-y-3">
          {content.sentences.map((s) => (
            <li key={s.key} className="text-base leading-9">
              <GapText text={s.text} renderGap={(id) => gap(id)} />
            </li>
          ))}
        </ol>
      );
      break;
    case 'summary_completion':
      body = (
        <div className="rounded-lg border border-border bg-background p-4">
          {title}
          {content.text.split(/\n{2,}/).map((para, i) => (
            <p key={i} className="text-base leading-9">
              <GapText text={para} renderGap={(id) => gap(id)} />
            </p>
          ))}
        </div>
      );
      break;
    case 'note_completion':
      body = (
        <div className="rounded-lg border border-border bg-background p-4">
          {title}
          <ul className="space-y-1.5">
            {content.lines.map((l, i) => (
              <li key={i} className={cn('text-base leading-9', l.heading && 'pt-1 font-semibold', l.level === 1 && 'ml-5 list-disc', l.level === 2 && 'ml-10 list-[circle]')}>
                <GapText text={l.text} renderGap={(id) => gap(id)} />
              </li>
            ))}
          </ul>
        </div>
      );
      break;
    case 'table_completion':
      body = (
        <div>
          {title}
          <div className="max-w-full overflow-x-auto rounded-lg border border-border" data-testid="completion-table-scroll">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-muted">
                <tr>
                  {content.columns.map((c, i) => (
                    <th key={i} scope="col" className="border-b border-border px-3 py-2 text-left font-semibold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {content.rows.map((r, ri) => (
                  <tr key={ri} className="border-b border-border last:border-b-0">
                    {r.map((cell, ci) =>
                      ci === 0 ? (
                        <th key={ci} scope="row" className="px-3 py-2 text-left align-top font-medium">
                          <GapText text={cell} renderGap={(id) => gap(id)} />
                        </th>
                      ) : (
                        <td key={ci} className="px-3 py-2 align-top leading-9">
                          <GapText text={cell} renderGap={(id) => gap(id)} />
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
      break;
    case 'flow_chart_completion':
      body = (
        <div>
          {title}
          <ol className="flex flex-col items-stretch gap-1" aria-label={t('flowChart')}>
            {content.steps.map((s, i) => (
              <li key={i} className="flex flex-col items-center gap-1">
                <div className="w-full rounded-lg border border-border bg-background px-3 py-2 text-center text-base leading-9">
                  <GapText text={s.text} renderGap={(id) => gap(id)} />
                </div>
                {i < content.steps.length - 1 ? <ArrowDown className="size-4 text-muted-foreground" aria-hidden /> : null}
              </li>
            ))}
          </ol>
        </div>
      );
      break;
    case 'form_completion':
      body = (
        <div className="rounded-lg border border-border bg-background p-4">
          {title}
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
            {content.fields.map((f, i) => (
              <React.Fragment key={i}>
                <dt className="text-sm font-semibold text-muted-foreground sm:py-2">{f.label}</dt>
                <dd className="text-base leading-9">
                  <GapText text={f.value} renderGap={(id) => gap(id)} />
                </dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      );
      break;
    case 'short_answer':
      body = (
        <ol className="space-y-4">
          {content.questions.map((q) => (
            <li key={q.id} className="space-y-1.5">
              <p className="text-base">
                <span className="mr-2 font-semibold tabular">{numbers.get(q.id)}.</span>
                {q.text}
              </p>
              {gap(q.id, { inline: false, label: q.text })}
            </li>
          ))}
        </ol>
      );
      break;
    case 'diagram_labelling':
      body = (
        <div className="space-y-4">
          {title}
          <DiagramFigure src={resolveImage?.(content.image_asset_id) ?? null} alt={content.image_alt} pins={content.labels.map((l) => ({ key: l.id, x: l.x, y: l.y, label: String(numbers.get(l.id) ?? '') }))} questionId={questionId} />
          <ol className="space-y-3">
            {content.labels.map((l) => (
              <li key={l.id} className="space-y-1">
                <p className="text-sm text-muted-foreground">{l.description}</p>
                {gap(l.id, { inline: false, label: l.description })}
              </li>
            ))}
          </ol>
        </div>
      );
      break;
  }

  return (
    <div className="space-y-4" data-testid={`renderer-${content.type}`}>
      <WordLimitBadge limit={content.word_limit} id={limitId} />
      {body}
    </div>
  );
}
