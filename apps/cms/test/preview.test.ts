import { QUESTION_FIXTURES, QUESTION_TYPE_CODES, RL_QUESTION_TYPE_CODES } from '@allingo/schemas';
import { describe, expect, it } from 'vitest';
import { buildContentPreview } from '../src/lib/preview';
import { QUESTION_TYPE_LABELS, STATIC_REFERENCE } from '../src/lib/reference';

/** C2 – khối "Xem trước" trong CMS cho nội dung nhập JSON (14 dạng IELTS) */
describe('buildContentPreview', () => {
  it.each(RL_QUESTION_TYPE_CODES.map((t) => [t] as const))('%s: fixture hợp lệ → mô tả + số câu hỏi + đáp án điền sẵn', (t) => {
    const { type: _type, ...rest } = QUESTION_FIXTURES[t].content;
    const r = buildContentPreview(t, rest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.description.format).toBe(t);
    expect(r.marks).toBeGreaterThanOrEqual(1);
    expect(r.description.items.length).toBe(r.marks);
    // Đáp án điền sẵn (keyAnswerOf) – dạng gõ: cách viết chấp nhận đầu tiên, có trong danh sách đáp án đúng
    for (const it of r.description.items) {
      expect(it.chosen, it.key).toBeTruthy();
      expect(it.correct.toLowerCase()).toContain(String(it.chosen).toLowerCase());
    }
  });

  it('đáp án lệch chỗ trống → lỗi Zod có đường dẫn (biên tập viên sửa trước khi lưu)', () => {
    const c = QUESTION_FIXTURES.note_completion.content;
    const r = buildContentPreview('note_completion', { ...c, answer_key: { ...c.answer_key, gaps: {} } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.join('\n')).toMatch(/answer_key|gaps|chỗ trống/);
  });

  it('chưa chọn dạng / nội dung trống → thông báo rõ', () => {
    expect(buildContentPreview('khong-co', {})).toEqual({ ok: false, issues: [expect.any(String)] });
    expect(buildContentPreview('short_answer', null)).toMatchObject({ ok: false });
    expect(buildContentPreview('short_answer', [])).toMatchObject({ ok: false });
  });

  it('nhãn CMS + tham chiếu tĩnh phủ đủ 26 dạng; IELTS có phần thi Listening/Reading', () => {
    for (const t of QUESTION_TYPE_CODES) expect(QUESTION_TYPE_LABELS[t].vi.length, t).toBeGreaterThan(0);
    expect(STATIC_REFERENCE.question_types).toHaveLength(QUESTION_TYPE_CODES.length);
    const ielts = STATIC_REFERENCE.sections.filter((s) => s.program === 'ielts').map((s) => s.code);
    for (const code of ['listening_p1', 'reading_p3']) expect(ielts).toContain(code);
  });
});
