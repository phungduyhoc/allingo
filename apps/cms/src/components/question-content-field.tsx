'use client';

import type { JSONFieldClientProps } from 'payload';
import { QUESTION_FIXTURES, type QuestionTypeCode, QUESTION_TYPE_CODES } from '@allingo/schemas';
import { Button, FieldDescription, FieldError, FieldLabel, useField, useFormFields } from '@payloadcms/ui';
import React, { useCallback, useMemo, useState } from 'react';
import { buildContentPreview } from '../lib/preview';

/**
 * Field tuỳ biến cho `questions.content`:
 * - mcq_single/mcq_multi: form có cấu trúc (đề bài, lựa chọn A–H, đáp án đúng, giải thích vi/en, evidence) → sinh JSON.
 * - Dạng khác: nhập JSON thô, nút "Chèn mẫu" lấy từ QUESTION_FIXTURES[type].content (packages/schemas); C2: khối "Xem trước"
 *   kiểm tra Zod + tham chiếu đáp án và liệt kê từng mục kèm đáp án (14 dạng IELTS Reading/Listening).
 * Validate thật diễn ra ở server (Zod trong collection); đây chỉ là UI nhập liệu.
 */

type Json = Record<string, unknown>;
interface McqOption {
  key: string;
  text: string;
}
interface McqView {
  stem: string;
  options: McqOption[];
  correct: string[];
  explanationVi: string;
  explanationEn: string;
  evidence: string;
  tagsText: string;
  rest: Json;
}

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;

function isQuestionType(v: unknown): v is QuestionTypeCode {
  return typeof v === 'string' && (QUESTION_TYPE_CODES as readonly string[]).includes(v);
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toMcqView(value: Json | null | undefined, type: 'mcq_single' | 'mcq_multi'): McqView {
  const v = value ?? {};
  const rawOptions = Array.isArray(v.options) ? (v.options as Array<Partial<McqOption>>) : [];
  const options: McqOption[] = rawOptions.length
    ? rawOptions.map((o, i) => ({ key: asString(o.key) || OPTION_KEYS[i] || String(i + 1), text: asString(o.text) }))
    : OPTION_KEYS.slice(0, 4).map((key) => ({ key, text: '' }));
  const ak = (v.answer_key ?? {}) as { correct?: unknown };
  const correct = type === 'mcq_single' ? (typeof ak.correct === 'string' ? [ak.correct] : []) : Array.isArray(ak.correct) ? ak.correct.filter((c): c is string => typeof c === 'string') : [];
  const explanation = (v.explanation ?? {}) as { vi?: unknown; en?: unknown };
  const tags = Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === 'string') : [];
  const { stem: _s, options: _o, answer_key: _a, explanation: _e, evidence: _ev, tags: _t, type: _ty, ...rest } = v;
  return {
    stem: asString(v.stem),
    options,
    correct,
    explanationVi: asString(explanation.vi),
    explanationEn: asString(explanation.en),
    evidence: asString(v.evidence),
    tagsText: tags.join(', '),
    rest,
  };
}

function fromMcqView(view: McqView, type: 'mcq_single' | 'mcq_multi'): Json {
  const explanation: Json = {};
  if (view.explanationVi.trim()) explanation.vi = view.explanationVi;
  if (view.explanationEn.trim()) explanation.en = view.explanationEn;
  const tags = view.tagsText
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const out: Json = {
    ...view.rest,
    type,
    stem: view.stem,
    options: view.options.map((o) => ({ key: o.key, text: o.text })),
    answer_key:
      type === 'mcq_single'
        ? { correct: view.correct[0] ?? '' }
        : { correct: view.correct, scoring: (view.rest.answer_key as { scoring?: string } | undefined)?.scoring ?? 'all_or_nothing' },
    tags,
  };
  if (Object.keys(explanation).length) out.explanation = explanation;
  if (view.evidence.trim()) out.evidence = view.evidence;
  return out;
}

const McqEditor: React.FC<{ value: Json | null; type: 'mcq_single' | 'mcq_multi'; readOnly: boolean; onChange: (v: Json) => void }> = ({ value, type, readOnly, onChange }) => {
  const view = useMemo(() => toMcqView(value, type), [value, type]);
  const update = (patch: Partial<McqView>) => onChange(fromMcqView({ ...view, ...patch }, type));

  const setOption = (idx: number, text: string) => {
    const options = view.options.map((o, i) => (i === idx ? { ...o, text } : o));
    update({ options });
  };
  const addOption = () => {
    if (view.options.length >= OPTION_KEYS.length) return;
    const key = OPTION_KEYS.find((k) => !view.options.some((o) => o.key === k)) ?? String(view.options.length + 1);
    update({ options: [...view.options, { key, text: '' }] });
  };
  const removeOption = (idx: number) => {
    if (view.options.length <= 2) return;
    const removed = view.options[idx];
    update({ options: view.options.filter((_, i) => i !== idx), correct: view.correct.filter((c) => c !== removed?.key) });
  };
  const toggleCorrect = (key: string) => {
    if (type === 'mcq_single') update({ correct: [key] });
    else update({ correct: view.correct.includes(key) ? view.correct.filter((c) => c !== key) : [...view.correct, key] });
  };

  return (
    <div className="allingo-card">
      <label className="field-label">Đề bài (stem) – Listening Part 1/2 có thể để trống</label>
      <textarea className="allingo-textarea" rows={3} value={view.stem} disabled={readOnly} onChange={(e) => update({ stem: e.target.value })} />

      <div style={{ marginTop: 12 }}>
        <label className="field-label">
          Lựa chọn – chọn đáp án đúng ({type === 'mcq_single' ? 'một' : 'nhiều'})
        </label>
        {view.options.map((o, idx) => (
          <div className="allingo-option-row" key={o.key}>
            <label title="Đáp án đúng" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type={type === 'mcq_single' ? 'radio' : 'checkbox'} name="allingo-correct" checked={view.correct.includes(o.key)} disabled={readOnly} onChange={() => toggleCorrect(o.key)} />
              <strong>{o.key}</strong>
            </label>
            <input type="text" value={o.text} disabled={readOnly} placeholder={`Lựa chọn ${o.key}`} onChange={(e) => setOption(idx, e.target.value)} />
            <button type="button" className="btn btn--style-secondary btn--size-small" disabled={readOnly || view.options.length <= 2} onClick={() => removeOption(idx)} aria-label={`Xoá lựa chọn ${o.key}`}>
              ×
            </button>
          </div>
        ))}
        <div className="allingo-actions">
          <Button buttonStyle="secondary" size="small" disabled={readOnly || view.options.length >= OPTION_KEYS.length} onClick={addOption}>
            + Thêm lựa chọn
          </Button>
          <span className="allingo-muted">Đáp án đúng: {view.correct.length ? view.correct.join(', ') : '(chưa chọn)'}</span>
        </div>
      </div>

      <div className="allingo-grid allingo-grid--2" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Giải thích (vi)</label>
          <textarea className="allingo-textarea" rows={3} value={view.explanationVi} disabled={readOnly} onChange={(e) => update({ explanationVi: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Explanation (en)</label>
          <textarea className="allingo-textarea" rows={3} value={view.explanationEn} disabled={readOnly} onChange={(e) => update({ explanationEn: e.target.value })} />
        </div>
      </div>

      <div className="allingo-grid allingo-grid--2" style={{ marginTop: 12 }}>
        <div>
          <label className="field-label">Evidence (trích đoạn/transcript quyết định đáp án)</label>
          <textarea className="allingo-textarea" rows={2} value={view.evidence} disabled={readOnly} onChange={(e) => update({ evidence: e.target.value })} />
        </div>
        <div>
          <label className="field-label">Tags (phân cách bằng dấu phẩy)</label>
          <input className="allingo-input" type="text" value={view.tagsText} disabled={readOnly} onChange={(e) => update({ tagsText: e.target.value })} />
        </div>
      </div>
    </div>
  );
};

function jsonEquivalent(text: string, value: Json | null): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value ?? null);
  } catch {
    return false;
  }
}

const RawJsonEditor: React.FC<{ value: Json | null; readOnly: boolean; onChange: (v: Json) => void }> = ({ value, readOnly, onChange }) => {
  const serialized = useMemo(() => (value ? JSON.stringify(value, null, 2) : ''), [value]);
  const [text, setText] = useState(serialized);
  const [parseError, setParseError] = useState<string | null>(null);
  const [prevSerialized, setPrevSerialized] = useState(serialized);

  // Giá trị đổi từ bên ngoài (nút "Chèn mẫu", tải lại) → đồng bộ textarea; giữ định dạng người dùng nếu JSON tương đương
  if (serialized !== prevSerialized) {
    setPrevSerialized(serialized);
    if (!jsonEquivalent(text, value)) {
      setText(serialized);
      setParseError(null);
    }
  }

  const commit = (next: string) => {
    setText(next);
    if (!next.trim()) {
      setParseError('Nội dung JSON trống.');
      return;
    }
    try {
      const parsed = JSON.parse(next) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setParseError('JSON phải là một đối tượng.');
        return;
      }
      setParseError(null);
      onChange(parsed as Json);
    } catch (err) {
      setParseError(`JSON không hợp lệ: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div>
      <textarea className="allingo-textarea allingo-textarea--code" value={text} disabled={readOnly} spellCheck={false} onChange={(e) => commit(e.target.value)} />
      {parseError ? <div className="allingo-error">{parseError}</div> : null}
    </div>
  );
};

/** C2 – xem trước nội dung (dạng nhập JSON): lỗi Zod/tham chiếu hoặc bản mô tả đề + từng mục kèm đáp án */
const ContentPreviewBox: React.FC<{ questionType: QuestionTypeCode; value: Json | null }> = ({ questionType, value }) => {
  const p = useMemo(() => buildContentPreview(questionType, value), [questionType, value]);
  if (!p.ok)
    return (
      <div className="allingo-card" style={{ marginTop: 12 }} data-testid="cms-content-preview" data-ok="false">
        <strong>Xem trước</strong>
        <ul className="allingo-error" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {p.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </div>
    );
  const d = p.description;
  return (
    <div className="allingo-card" style={{ marginTop: 12 }} data-testid="cms-content-preview" data-ok="true">
      <strong>Xem trước</strong> <span className="allingo-muted">({p.marks} câu hỏi đánh số)</span>
      {d.instructions ? <p className="allingo-badge" style={{ display: 'inline-block', marginLeft: 8 }}>{d.instructions}</p> : null}
      {d.stem ? <p style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{d.stem}</p> : null}
      {d.options.length ? (
        <ul style={{ marginTop: 8, paddingLeft: 18 }}>
          {d.options.map((o) => (
            <li key={o.key}>
              <strong>{o.key}</strong> {o.text}
            </li>
          ))}
        </ul>
      ) : null}
      {d.items.length ? (
        <ol style={{ marginTop: 8, paddingLeft: 18 }} data-testid="cms-preview-items">
          {d.items.map((i) => (
            <li key={i.key}>
              {i.text} → <strong style={{ color: 'var(--theme-success-500, #1a7f37)' }}>{i.correct}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <p style={{ marginTop: 8 }}>
          Đáp án: <strong>{d.correct_text || '—'}</strong>
        </p>
      )}
    </div>
  );
};

export const QuestionContentField: React.FC<JSONFieldClientProps> = (props) => {
  const { field, path: pathFromProps, readOnly = false } = props;
  const { value, setValue, showError, errorMessage, path } = useField<Json | null>({ path: pathFromProps });
  const questionTypeRaw = useFormFields(([fields]) => fields?.questionType?.value);
  const questionType: QuestionTypeCode = isQuestionType(questionTypeRaw) ? questionTypeRaw : 'mcq_single';
  const isMcq = questionType === 'mcq_single' || questionType === 'mcq_multi';

  const onChange = useCallback((v: Json) => setValue(v), [setValue]);
  const insertSample = () => setValue(QUESTION_FIXTURES[questionType].content);
  const typeMismatch = value && typeof value.type === 'string' && value.type !== questionType;

  return (
    <div className="field-type json-field" style={{ marginBottom: 'var(--base)' }}>
      <FieldLabel htmlFor={`field-${path}`} label={field.label ?? 'content'} required={field.required} path={path} />
      <div className="allingo-actions">
        <span className="allingo-badge">Dạng: {questionType}</span>
        <Button buttonStyle="secondary" size="small" disabled={readOnly} onClick={insertSample}>
          Chèn mẫu ({questionType})
        </Button>
        {typeMismatch ? <span className="allingo-error">content.type = &quot;{String(value?.type)}&quot; khác dạng đã chọn – bấm &quot;Chèn mẫu&quot; hoặc sửa JSON.</span> : null}
      </div>
      {isMcq ? (
        <McqEditor value={value} type={questionType} readOnly={readOnly} onChange={onChange} />
      ) : (
        <>
          <RawJsonEditor value={value} readOnly={readOnly} onChange={onChange} />
          <ContentPreviewBox questionType={questionType} value={value} />
        </>
      )}
      {showError && errorMessage ? <FieldError path={path} message={errorMessage} showError /> : null}
      <FieldDescription path={path} description={field.admin?.description} />
      {isMcq ? (
        <details style={{ marginTop: 8 }}>
          <summary className="allingo-muted">Xem JSON sinh ra</summary>
          <pre style={{ fontSize: 12, overflowX: 'auto' }}>{JSON.stringify(value ?? {}, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
};
