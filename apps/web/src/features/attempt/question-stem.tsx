'use client';

import * as React from 'react';
import { cn } from '@allingo/ui';
import { hasStemMarkup, parseStem, type InlineSegment } from './stem-format';

const Inline = ({ segments }: { segments: InlineSegment[] }) => (
  <>
    {segments.map((s, i) =>
      s.bold ? <strong key={i}>{s.text}</strong> : <React.Fragment key={i}>{s.text}</React.Fragment>,
    )}
  </>
);

/**
 * Đề bài: văn bản thường → một đoạn như trước; có `**đậm**`/bảng (graphic Part 3/4) → dựng bảng có tiêu đề cột.
 * `id` gắn cho phần tử bao để radiogroup `aria-labelledby` đọc được cả đề và bảng. `data-lookup`: vùng tra từ (S6 – chỉ
 * hoạt động ở trang có LookupLayer: Practice/Review, không bao giờ trong Exam Mode).
 */
export function QuestionStem({ id, stem, className }: { id: string; stem: string; className?: string }) {
  const blocks = React.useMemo(() => (hasStemMarkup(stem) ? parseStem(stem) : null), [stem]);
  if (!blocks) {
    return (
      <p id={id} className={className} data-lookup="">
        {stem}
      </p>
    );
  }
  return (
    <div id={id} className={cn('space-y-3', className)} data-testid="question-stem" data-lookup="">
      {blocks.map((b, i) =>
        b.kind === 'paragraph' ? (
          <p key={i} className="whitespace-pre-line">
            <Inline segments={b.segments} />
          </p>
        ) : (
          <div key={i} className="overflow-x-auto">
            <table
              className="w-full min-w-[16rem] border-collapse overflow-hidden rounded-lg border border-border text-sm font-normal"
              data-testid="stem-table"
            >
              <thead className="bg-muted">
                <tr>
                  {b.header.map((h, j) => (
                    <th
                      key={j}
                      scope="col"
                      className="border border-border px-3 py-1.5 text-left font-semibold"
                      style={{ textAlign: b.align[j] ?? 'left' }}
                    >
                      <Inline segments={h} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="odd:bg-card even:bg-muted/40">
                    {r.map((c, k) => (
                      <td
                        key={k}
                        className="tabular border border-border px-3 py-1.5"
                        style={{ textAlign: b.align[k] ?? 'left' }}
                      >
                        <Inline segments={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </div>
  );
}
