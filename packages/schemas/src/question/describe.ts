import type { AnswerInput } from './answer.js';
import { gapIdsOf, type QuestionContent, type QuestionTypeCode } from './content.js';
import { correctAnswerOf } from './grade.js';
import { GAP_SPLIT_RE, type WordLimit } from './rl-types.js';

/**
 * C2 – mô tả một câu hỏi (mọi dạng) thành văn bản phẳng cho prompt AI (explain_mcq, tutor_chat, diagnose): đề, lựa chọn dùng chung,
 * các mục đánh số kèm đáp án đúng/đáp án người học. Không chứa PII; nội dung câu hỏi + câu trả lời được caller đặt trong
 * <user_input> (CLAUDE.md §5.4). Giữ ngắn: mỗi mục ≤ 240 ký tự.
 */

export interface QuestionDescriptionItem {
  key: string;
  text: string;
  correct: string;
  chosen: string | null;
}

export interface QuestionDescription {
  format: QuestionTypeCode;
  /** Hướng dẫn đề bằng ngôn ngữ thi ("Write NO MORE THAN TWO WORDS AND/OR A NUMBER") */
  instructions: string | null;
  stem: string;
  /** Lựa chọn dùng chung: A–D, danh sách tiêu đề, ngân hàng từ, vị trí trên bản đồ, TRUE/FALSE/NOT GIVEN */
  options: Array<{ key: string; text: string }>;
  /** Mục đánh số trong câu (câu hỏi con); MCQ một đáp án → rỗng */
  items: QuestionDescriptionItem[];
  /** Tóm tắt đáp án đúng ("B" | "1: library; 2: 7.30") */
  correct_text: string;
  /** Tóm tắt câu trả lời người học; null khi không có */
  chosen_text: string | null;
}

const cut = (s: string, n = 240) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const NUMBER_WORDS = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];

/** Hướng dẫn giới hạn từ theo cách viết của đề IELTS (tiếng Anh – ngôn ngữ thi) */
export function wordLimitInstruction(limit: WordLimit | undefined): string | null {
  if (!limit) return null;
  if (limit.number_only) return 'Write A NUMBER';
  const n = limit.max_words ?? 1;
  const words = n === 1 ? 'ONE WORD' : `NO MORE THAN ${NUMBER_WORDS[n - 1] ?? n} WORDS`;
  return `Write ${n === 1 && !limit.allow_number ? 'ONE WORD ONLY' : words}${limit.allow_number ? ' AND/OR A NUMBER' : ''}`;
}

/** Văn bản có chỗ trống `{{id}}` → "____ (3)" theo số thứ tự chỗ trống */
function blankOut(text: string, order: ReadonlyMap<string, number>): string {
  return text
    .split(GAP_SPLIT_RE)
    .map((p) => {
      const m = /^\{\{([A-Za-z0-9_-]+)\}\}$/.exec(p);
      return m ? `____ (${order.get(m[1]!) ?? '?'})` : p;
    })
    .join('');
}

const TF_LABEL = { tfng: { true: 'TRUE', false: 'FALSE', not_given: 'NOT GIVEN' }, ynng: { true: 'YES', false: 'NO', not_given: 'NOT GIVEN' } } as const;

/** Chuỗi đáp án → tóm tắt "k: v; …" */
const summary = (items: readonly QuestionDescriptionItem[], pick: 'correct' | 'chosen') =>
  items
    .map((i, idx) => `${idx + 1}: ${(pick === 'correct' ? i.correct : i.chosen) ?? '—'}`)
    .join('; ');

function answerMap(answer: AnswerInput | null | undefined, field: 'pairs' | 'gaps' | 'values' | 'blanks'): Record<string, string> {
  if (!answer) return {};
  const v = (answer as unknown as Record<string, unknown>)[field];
  return v && typeof v === 'object' ? (v as Record<string, string>) : {};
}

export function describeQuestion(content: QuestionContent, answer?: AnswerInput | null): QuestionDescription {
  const a = answer && answer.type === content.type ? answer : null;
  const base = { format: content.type, instructions: null as string | null, stem: content.stem ?? '', options: [] as Array<{ key: string; text: string }>, items: [] as QuestionDescriptionItem[] };
  const finish = (d: typeof base, correct?: string, chosen?: string | null): QuestionDescription => ({
    ...d,
    items: d.items.map((i) => ({ ...i, text: cut(i.text) })),
    options: d.options.map((o) => ({ key: o.key, text: cut(o.text, 200) })),
    correct_text: correct ?? summary(d.items, 'correct'),
    chosen_text: chosen !== undefined ? chosen : a ? summary(d.items, 'chosen') : null,
  });

  switch (content.type) {
    case 'mcq_single':
      return finish({ ...base, options: content.options }, content.answer_key.correct, a?.type === 'mcq_single' ? a.selected : null);
    case 'mcq_multi':
      return finish(
        { ...base, instructions: content.select_count ? `Choose ${NUMBER_WORDS[content.select_count - 1] ?? content.select_count} letters` : null, options: content.options },
        content.answer_key.correct.join(', '),
        a?.type === 'mcq_multi' ? a.selected.join(', ') || null : null,
      );
    case 'tfng': {
      const labels = TF_LABEL[content.variant];
      const chosen = a?.type === 'tfng' ? a.values : {};
      return finish({
        ...base,
        options: (['true', 'false', 'not_given'] as const).map((k) => ({ key: k, text: labels[k] })),
        items: content.statements.map((s) => ({ key: s.key, text: s.text, correct: labels[content.answer_key.values[s.key] ?? 'not_given'], chosen: chosen[s.key] ? labels[chosen[s.key]!] : null })),
      });
    }
    case 'matching':
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings': {
      const left = content.type === 'matching' ? content.left : content.items;
      const right = content.type === 'matching' ? content.right : content.options;
      const chosen = answerMap(a, 'pairs');
      const example = content.type === 'matching_headings' ? content.example?.item : undefined;
      return finish({
        ...base,
        options: right,
        items: left.filter((i) => i.key !== example).map((i) => ({ key: i.key, text: i.text, correct: content.answer_key.pairs[i.key] ?? '—', chosen: chosen[i.key] ?? null })),
      });
    }
    case 'summary_word_bank': {
      const ids = gapIdsOf(content);
      const order = new Map(ids.map((id, i) => [id, i + 1]));
      const chosen = answerMap(a, 'gaps');
      const bank = new Map(content.bank.map((b) => [b.key, b.text]));
      const label = (k: string | undefined) => (k ? `${k} (${bank.get(k) ?? '?'})` : null);
      return finish({
        ...base,
        stem: [content.stem, content.title, blankOut(content.text, order)].filter(Boolean).join('\n'),
        options: content.bank,
        items: ids.map((id) => ({ key: id, text: `gap ${order.get(id)}`, correct: label(content.answer_key.gaps[id]) ?? '—', chosen: label(chosen[id]) })),
      });
    }
    case 'plan_map_labelling': {
      const chosen = answerMap(a, 'values');
      return finish({
        ...base,
        stem: [content.stem, content.title, `Image (${content.kind}): ${cut(content.image_alt, 600)}`].filter(Boolean).join('\n'),
        options: content.markers.map((m) => ({ key: m.key, text: m.description ?? `position ${m.key}` })),
        items: content.items.map((i) => ({ key: i.key, text: i.text, correct: content.answer_key.values[i.key] ?? '—', chosen: chosen[i.key] ?? null })),
      });
    }
    case 'fill_blank': {
      const chosen = answerMap(a, 'blanks');
      const order = new Map(content.blanks.map((b, i) => [b.id, i + 1]));
      return finish({
        ...base,
        stem: blankOut(content.stem, order),
        items: content.blanks.map((b) => ({ key: b.id, text: `blank ${order.get(b.id)}`, correct: b.accepted.join(' / '), chosen: chosen[b.id] || null })),
      });
    }
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling': {
      const ids = gapIdsOf(content);
      const order = new Map(ids.map((id, i) => [id, i + 1]));
      const chosen = answerMap(a, 'gaps');
      const correct = correctAnswerOf(content) as Record<string, string[]>;
      const contextOf = (id: string): string => {
        const c = content;
        switch (c.type) {
          case 'sentence_completion':
            return blankOut(c.sentences.find((s) => s.text.includes(`{{${id}}}`))?.text ?? '', order);
          case 'note_completion':
            return blankOut(c.lines.find((l) => l.text.includes(`{{${id}}}`))?.text ?? '', order);
          case 'table_completion': {
            const row = c.rows.find((r) => r.some((cell) => cell.includes(`{{${id}}}`)));
            return row ? blankOut(row.map((cell, i) => `${c.columns[i] ?? ''}: ${cell}`).join(' | '), order) : '';
          }
          case 'flow_chart_completion':
            return blankOut(c.steps.find((s) => s.text.includes(`{{${id}}}`))?.text ?? '', order);
          case 'form_completion': {
            const f = c.fields.find((x) => x.value.includes(`{{${id}}}`));
            return f ? blankOut(`${f.label}: ${f.value}`, order) : '';
          }
          case 'short_answer':
            return c.questions.find((q) => q.id === id)?.text ?? '';
          case 'diagram_labelling':
            return c.labels.find((l) => l.id === id)?.description ?? '';
          default:
            return `gap ${order.get(id)}`;
        }
      };
      const head =
        content.type === 'summary_completion'
          ? [content.title, blankOut(content.text, order)]
          : content.type === 'diagram_labelling'
            ? [content.title, `Image: ${cut(content.image_alt, 600)}`]
            : 'title' in content
              ? [content.title]
              : [];
      return finish({
        ...base,
        instructions: wordLimitInstruction(content.word_limit),
        stem: [content.stem, ...head].filter(Boolean).join('\n'),
        items: ids.map((id) => ({ key: id, text: contextOf(id) || `gap ${order.get(id)}`, correct: (correct[id] ?? []).join(' / '), chosen: chosen[id]?.trim() || null })),
      });
    }
    case 'drag_drop': {
      const chosen = answerMap(a, 'placements' as 'pairs');
      return finish({ ...base, options: content.items, items: content.slots.map((s) => ({ key: s.key, text: s.label, correct: content.answer_key.placements[s.key] ?? '—', chosen: chosen[s.key] ?? null })) });
    }
    case 'map_label': {
      const chosen = answerMap(a, 'positions' as 'pairs');
      return finish({ ...base, options: content.labels, items: content.positions.map((p) => ({ key: p.key, text: `position ${p.key}`, correct: content.answer_key.positions[p.key] ?? '—', chosen: chosen[p.key] ?? null })) });
    }
    case 'ordering':
      return finish({ ...base, options: content.items }, content.answer_key.order.join(' → '), a?.type === 'ordering' ? a.order.join(' → ') || null : null);
    case 'dictation':
      return finish(base, content.answer_key.text, a?.type === 'dictation' ? a.text || null : null);
    case 'essay':
    case 'speaking':
      return finish(base, content.answer_key.model_answer ?? '', null);
    case 'handwriting':
      return finish(base, content.target, null);
  }
}

/**
 * C2 – câu trả lời "đúng" dựng từ đáp án (cách viết chấp nhận đầu tiên – phần tuỳ chọn trong ngoặc được giữ): dùng cho xem trước
 * trong hàng chờ duyệt/CMS (hiển thị câu như người học thấy, điền sẵn đáp án) và kiểm thử. Dạng chấm thủ công → null.
 */
export function keyAnswerOf(content: QuestionContent): AnswerInput | null {
  const firstAccepted = (acc: readonly string[]) => (acc[0] ?? '').replace(/\(([^()]*)\)\s*/g, '').replace(/\s+/g, ' ').trim();
  switch (content.type) {
    case 'mcq_single':
      return { type: 'mcq_single', selected: content.answer_key.correct };
    case 'mcq_multi':
      return { type: 'mcq_multi', selected: [...content.answer_key.correct] };
    case 'fill_blank':
      return { type: 'fill_blank', blanks: Object.fromEntries(content.blanks.map((b) => [b.id, firstAccepted(b.accepted)])) };
    case 'matching':
      return { type: 'matching', pairs: { ...content.answer_key.pairs } };
    case 'drag_drop':
      return { type: 'drag_drop', placements: { ...content.answer_key.placements } };
    case 'map_label':
      return { type: 'map_label', positions: { ...content.answer_key.positions } };
    case 'tfng':
      return { type: 'tfng', values: { ...content.answer_key.values } };
    case 'ordering':
      return { type: 'ordering', order: [...content.answer_key.order] };
    case 'dictation':
      return { type: 'dictation', text: content.answer_key.text };
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return { type: content.type, pairs: { ...content.answer_key.pairs } };
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
      return { type: content.type, gaps: Object.fromEntries(gapIdsOf(content).map((id) => [id, firstAccepted(content.answer_key.gaps[id]?.accepted ?? [])])) };
    case 'summary_word_bank':
      return { type: 'summary_word_bank', gaps: { ...content.answer_key.gaps } };
    case 'plan_map_labelling':
      return { type: 'plan_map_labelling', values: { ...content.answer_key.values } };
    case 'essay':
    case 'speaking':
    case 'handwriting':
      return null;
  }
}
