import { describe, expect, it } from 'vitest';
import type { Attempt, QuestionPublic } from '@/lib/types';
import { groupOf, initialAttemptState, modeTraits, questionGroups, sectionIndexOf, sectionRanges, sortQuestions } from './attempt-state';
import { clampSplit, DEFAULT_EXAM_PREFS, EXAM_PREFS_KEY, loadExamPrefs, parseExamPrefs, saveExamPrefs, stepFont } from './exam-prefs';
import { markersInStem, parsePassage } from './passage-format';

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function q(n: number, section: string, opts: { group?: string | null; passage?: number } = {}): QuestionPublic {
  return {
    question_id: uid(n),
    question_version_id: uid(1000 + n),
    question_type: 'mcq_single',
    section_code: section,
    group_key: opts.group ?? null,
    order_no: n,
    content: { type: 'mcq_single', stem: `Q${n}`, options: [] },
    media: [],
    passage: opts.passage ? { id: uid(5000 + opts.passage), kind: 'memo', title: null, body: 'text', media_url: null } : null,
  };
}

const QUESTIONS = [q(1, 'part5'), q(2, 'part5'), q(3, 'part6', { group: 'g1', passage: 1 }), q(4, 'part6', { group: 'g1', passage: 1 }), q(5, 'part7', { passage: 2 }), q(6, 'part7', { passage: 2 }), q(7, 'part7', { group: 'g3', passage: 3 })];

function attemptOf(questions: QuestionPublic[], extra: Partial<Attempt> = {}): Attempt {
  return {
    id: uid(9999),
    program: 'toeic',
    mode: 'exam',
    status: 'in_progress',
    test_set: null,
    sections: [],
    questions,
    draft_answers: [],
    started_at: '2026-11-01T10:00:00.000Z',
    expires_at: null,
    server_time: '2026-11-01T10:00:00.000Z',
    ...extra,
  };
}

describe('attempt-state', () => {
  it('chia Part theo thứ tự câu và tìm Part của câu', () => {
    const ranges = sectionRanges(QUESTIONS);
    expect(ranges).toEqual([
      { code: 'part5', start: 0, end: 1 },
      { code: 'part6', start: 2, end: 3 },
      { code: 'part7', start: 4, end: 6 },
    ]);
    expect(sectionIndexOf(ranges, 3)).toBe(1);
    expect(sectionIndexOf(ranges, 99)).toBe(-1);
  });

  it('gom câu dùng chung đoạn văn theo group_key, hoặc passage.id khi thiếu group_key; câu không đoạn văn đứng riêng', () => {
    const groups = questionGroups(QUESTIONS);
    expect(groups.map((g) => [g.start, g.end])).toEqual([
      [0, 0],
      [1, 1],
      [2, 3],
      [4, 5],
      [6, 6],
    ]);
    expect(groupOf(groups, 5)?.key).toBe(`passage:${uid(5002)}`);
    expect(groupOf(groups, 3)?.key).toBe('g1');
  });

  it('khôi phục: nháp cục bộ (IndexedDB) đè draft_answers của server; câu đang xem ưu tiên ui_state cục bộ', () => {
    const shuffled = [QUESTIONS[2]!, QUESTIONS[0]!, QUESTIONS[1]!];
    const attempt = attemptOf(shuffled, {
      draft_answers: [{ question_id: uid(1), answer: { type: 'mcq_single', selected: 'A' }, flagged: true }],
      ui_state: { current_question_id: uid(2) },
    });
    // Không có nháp cục bộ → theo server (chỉ số trên danh sách ĐÃ sắp xếp theo order_no)
    const fromServer = initialAttemptState(attempt, []);
    expect(sortQuestions(shuffled).map((x) => x.order_no)).toEqual([1, 2, 3]);
    expect(fromServer.currentIndex).toBe(1);
    expect(fromServer.flags[uid(1)]).toBe(true);

    const local = initialAttemptState(attempt, [{ question_id: uid(1), answer: { type: 'mcq_single', selected: 'C' }, flagged: false }, { question_id: uid(3), answer: { type: 'mcq_single', selected: 'B' } }], { current_question_id: uid(3) });
    expect(local.answers[uid(1)]).toEqual({ type: 'mcq_single', selected: 'C' });
    expect(local.answers[uid(3)]).toEqual({ type: 'mcq_single', selected: 'B' });
    expect(local.flags[uid(1)]).toBe(false);
    expect(local.currentIndex).toBe(2);

    // ui_state trỏ câu không còn trong đề → về câu đầu
    expect(initialAttemptState(attempt, [], { current_question_id: uid(77) }).currentIndex).toBe(0);
  });

  it('đặc điểm theo chế độ: chỉ practice/drill có phản hồi tức thì', () => {
    expect(modeTraits('practice')).toEqual({ feedback: true, examLike: false });
    expect(modeTraits('drill')).toEqual({ feedback: true, examLike: false });
    expect(modeTraits('exam').feedback).toBe(false);
    expect(modeTraits('timed_drill')).toEqual({ feedback: false, examLike: true });
    expect(modeTraits('diagnostic').examLike).toBe(true);
  });
});

describe('exam-prefs (cỡ chữ/tỉ lệ đoạn văn, localStorage bọc try/catch)', () => {
  it('đọc dữ liệu hỏng/thiếu → mặc định; kẹp tỉ lệ 0.3–0.7; cỡ chữ 3 mức', () => {
    expect(parseExamPrefs(null)).toEqual(DEFAULT_EXAM_PREFS);
    expect(parseExamPrefs('{oops')).toEqual(DEFAULT_EXAM_PREFS);
    expect(parseExamPrefs('"x"')).toEqual(DEFAULT_EXAM_PREFS);
    expect(parseExamPrefs(JSON.stringify({ font: 2, split: 0.95 }))).toEqual({ font: 2, split: 0.7 });
    expect(parseExamPrefs(JSON.stringify({ font: 7, split: 'a' }))).toEqual({ font: 0, split: 0.5 });
    expect(clampSplit(0.1)).toBe(0.3);
    expect(stepFont(0, -1)).toBe(0);
    expect(stepFont(1, 1)).toBe(2);
    expect(stepFont(2, 1)).toBe(2);
  });

  it('localStorage ném lỗi (chế độ riêng tư) → không vỡ', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
    };
    expect(loadExamPrefs(throwing)).toEqual(DEFAULT_EXAM_PREFS);
    expect(() => saveExamPrefs({ font: 1, split: 0.4 }, throwing)).not.toThrow();
    const m = new Map<string, string>();
    const ok = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    saveExamPrefs({ font: 1, split: 0.42 }, ok);
    expect(JSON.parse(m.get(EXAM_PREFS_KEY)!)).toEqual({ font: 1, split: 0.42 });
    expect(loadExamPrefs(ok)).toEqual({ font: 1, split: 0.42 });
  });
});

describe('passage-format', () => {
  it('tách tiêu đề phụ [Nhãn] của bộ nhiều đoạn, giữ mốc [131]/[1]', () => {
    const body = '[E-mail]\nFrom: A\nTo: B\n\nWe are glad you [131] our team.\n\n[Booking summary]\nRoom: Willow [2]';
    expect(parsePassage(body)).toEqual([
      { kind: 'heading', text: 'E-mail' },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'From: A\nTo: B' }] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'We are glad you ' }, { kind: 'marker', id: '131' }, { kind: 'text', text: ' our team.' }] },
      { kind: 'heading', text: 'Booking summary' },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'Room: Willow ' }, { kind: 'marker', id: '2' }] },
    ]);
    // Dòng chỉ có mốc số không phải tiêu đề
    expect(parsePassage('[3]')).toEqual([{ kind: 'paragraph', segments: [{ kind: 'marker', id: '3' }] }]);
    expect(parsePassage(null)).toEqual([]);
  });

  it('mốc được đề bài nhắc tới', () => {
    expect(markersInStem('Question 131: Choose the word that best completes blank [131].')).toEqual(['131']);
    expect(markersInStem('In which of the positions marked [1], [2], [3], and [4] does the sentence belong?')).toEqual(['1', '2', '3', '4']);
    expect(markersInStem(undefined)).toEqual([]);
  });
});
