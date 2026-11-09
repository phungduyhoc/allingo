import { describe, expect, it } from 'vitest';
import type { AnswerInput, QuestionPublic } from '@/lib/types';
import { sectionRanges } from './attempt-state';
import { DraftQueue } from './draft-queue';
import { buildIeltsListeningProgram, ieltsAudioPlays, isAnswerable, resumeCursor } from './listening/program';
import { initSequencer, reachedStep, sequencerReducer } from './listening/sequencer';
import { hasMultiMarks, markGridItems, markInfoOf, marksAnswered, markLabel, subItemKeys, totalMarks } from './numbering';

/** C3 – IELTS: đánh số "Questions 1–40" theo mục, lưới theo số, Listening liên tục theo part (S170), nháp khi section bị khoá */

const id = (n: number, p = 'aaaa') => `${p}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function q(n: number, section: string, content: Record<string, unknown>, extra: Partial<QuestionPublic> = {}): QuestionPublic {
  return {
    question_id: id(n),
    question_version_id: id(n, 'bbbb'),
    question_type: content.type as QuestionPublic['question_type'],
    section_code: section,
    group_key: section,
    order_no: n,
    content,
    media: [],
    passage: null,
    ...extra,
  };
}

const tfng = { type: 'tfng', stem: 'Do the statements agree?', variant: 'tfng', statements: [{ key: 's1', text: 'A' }, { key: 's2', text: 'B' }, { key: 's3', text: 'C' }], tags: [] };
const note = { type: 'note_completion', stem: 'Complete the notes', lines: [{ text: 'Name: {{g1}}' }, { text: 'Date: {{g2}}' }], tags: [] };
const mcq = { type: 'mcq_single', stem: 'Choose', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], tags: [] };
const two = { type: 'mcq_multi', stem: 'Choose TWO', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }, { key: 'C', text: 'c' }], select_count: 2, tags: [] };

describe('numbering – markInfoOf', () => {
  it('dùng number_start/mark_count của server', () => {
    const infos = markInfoOf([{ number_start: 1, mark_count: 3 }, { number_start: 4, mark_count: 2 }, { number_start: 6, mark_count: 1 }]);
    expect(infos).toEqual([{ start: 1, count: 3 }, { start: 4, count: 2 }, { start: 6, count: 1 }]);
    expect(totalMarks(infos)).toBe(6);
    expect(hasMultiMarks(infos)).toBe(true);
    expect(markLabel(infos[0]!)).toBe('1–3');
    expect(markLabel(infos[2]!)).toBe('6');
  });
  it('thiếu (server cũ/TOEIC) → mỗi câu một số theo thứ tự; thiếu một phần → cộng dồn từ câu trước', () => {
    expect(markInfoOf([{}, {}, {}])).toEqual([{ start: 1, count: 1 }, { start: 2, count: 1 }, { start: 3, count: 1 }]);
    expect(markInfoOf([{ mark_count: 5 }, {}])).toEqual([{ start: 1, count: 5 }, { start: 6, count: 1 }]);
    expect(hasMultiMarks(markInfoOf([{}, {}]))).toBe(false);
  });
});

describe('numbering – mục trả lời & lưới theo số', () => {
  it('khoá mục theo dạng câu', () => {
    expect(subItemKeys(tfng as never)).toEqual(['s1', 's2', 's3']);
    expect(subItemKeys(note as never)).toEqual(['g1', 'g2']);
    expect(subItemKeys(mcq as never)).toEqual([]);
  });
  it('đã trả lời từng mục: TFNG theo mệnh đề, điền từ theo ô (bỏ ô rỗng), "Choose TWO" theo số lựa chọn', () => {
    expect(marksAnswered(tfng as never, { type: 'tfng', values: { s1: 'true', s3: 'false' } }, 3)).toEqual([true, false, true]);
    expect(marksAnswered(note as never, { type: 'note_completion', gaps: { g1: 'Anna', g2: '  ' } } as unknown as AnswerInput, 2)).toEqual([true, false]);
    expect(marksAnswered(two as never, { type: 'mcq_multi', selected: ['A'] }, 2)).toEqual([true, false]);
    expect(marksAnswered(mcq as never, { type: 'mcq_single', selected: 'A' }, 1)).toEqual([true]);
    // Số mục server khác số khoá → cả câu một trạng thái
    expect(marksAnswered(tfng as never, { type: 'tfng', values: { s1: 'true' } }, 5)).toEqual([true, true, true, true, true]);
  });
  it('lưới: mỗi số một ô, giữ chỉ số câu + khoá mục để focus; cờ theo câu', () => {
    const qs = [q(1, 'reading_p1', tfng, { number_start: 1, mark_count: 3 }), q(2, 'reading_p1', mcq, { number_start: 4, mark_count: 1 })];
    const items = markGridItems(qs, markInfoOf(qs), { [id(1)]: { type: 'tfng', values: { s2: 'true' } } }, { [id(1)]: true });
    expect(items.map((i) => [i.number, i.index, i.subKey, i.answered, i.flagged])).toEqual([
      [1, 0, 's1', false, true],
      [2, 0, 's2', true, true],
      [3, 0, 's3', false, true],
      [4, 1, null, false, false],
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(4);
  });
});

describe('buildIeltsListeningProgram (S170)', () => {
  const part = (n: number, section: string, group: number, audio = true) =>
    q(n, section, mcq, { group_key: `p${group}`, passage: { id: id(group, 'eeee'), kind: 'audio_script', title: `Part ${group}`, body: null, media_url: audio ? `/p${group}.mp3?sig=1` : null, media_asset_id: audio ? id(group, 'ffff') : null } });
  const format = { preread_sec: 30, review_sec: 120, listening_parts: [{ section_code: 'listening_p1', media_asset_id: id(1, 'ffff'), duration_ms: 300_000, started_at: null, played: false }] };
  const isL = (c: string) => c.startsWith('listening_');

  it('mỗi part: đọc trước → audio cả part; hết part cuối → xem lại; câu của part mở từ bước đọc trước', () => {
    const qs = [part(1, 'listening_p1', 1), part(2, 'listening_p1', 1), part(3, 'listening_p2', 2), q(4, 'reading_p1', mcq)];
    const p = buildIeltsListeningProgram(qs, sectionRanges(qs), format, isL);
    expect(p.steps.map((s) => (s.kind === 'audio' ? `audio:${s.sectionCode}` : `${s.phase}:${s.ms}`))).toEqual(['preread:30000', 'audio:listening_p1', 'preread:30000', 'audio:listening_p2', 'review:120000']);
    expect(p.unlockStep.get(0)).toBe(0);
    expect(p.unlockStep.get(1)).toBe(0);
    expect(p.unlockStep.get(2)).toBe(2);
    expect(p.unlockStep.has(3)).toBe(false);
    const a1 = p.steps[1]!;
    expect(a1.kind === 'audio' && [a1.role, a1.groupStart, a1.groupEnd, a1.durationMs, a1.eventQuestionId]).toEqual(['group', 0, 1, 300_000, id(1)]);
    expect(p.nextIndex).toBe(3);
    // Đọc trước part 2 bắt đầu → câu part 2 chọn được; part 2 chưa tới → chưa chọn được
    expect(isAnswerable(p, 2, 1)).toBe(false);
    expect(isAnswerable(p, 2, 2)).toBe(true);
    expect(isAnswerable(p, 3, 0)).toBe(true);
  });

  it('part chưa có audio (đề mẫu C2) → không vào chuỗi phát; không có audio nào → chương trình rỗng', () => {
    const qs = [part(1, 'listening_p1', 1, false), q(2, 'reading_p1', mcq)];
    const p = buildIeltsListeningProgram(qs, sectionRanges(qs), format, isL);
    expect(p.steps).toEqual([]);
    expect(p.unlockStep.size).toBe(0);
  });

  it('chỉ đi tới: hết bước xem lại → done (Exam Mode tự nộp)', () => {
    const qs = [part(1, 'listening_p1', 1)];
    const p = buildIeltsListeningProgram(qs, sectionRanges(qs), format, isL);
    let s = initSequencer(p.steps.map((x) => x.kind), { step: 0, offsetMs: 0 });
    s = sequencerReducer(s, { type: 'start' });
    expect(s.phase).toBe('pause');
    expect(reachedStep(s)).toBe(0);
    s = sequencerReducer(s, { type: 'pauseElapsed', step: 0 });
    expect(s.phase).toBe('loading');
    s = sequencerReducer(s, { type: 'playing', step: 1 });
    s = sequencerReducer(s, { type: 'ended', step: 1 });
    expect(s.phase).toBe('pause');
    s = sequencerReducer(s, { type: 'pauseElapsed', step: 2 });
    expect(s.phase).toBe('done');
  });

  it('khôi phục: part đang phát (started_at) → không phát lại từ đầu; part đã nghe xong (played) → ra khỏi chuỗi phát', () => {
    const qs = [part(1, 'listening_p1', 1), part(2, 'listening_p2', 2)];
    const parts = [
      { section_code: 'listening_p1', media_asset_id: id(1, 'ffff'), duration_ms: 1000, started_at: '2026-11-09T01:00:00Z', played: false },
      { section_code: 'listening_p2', media_asset_id: id(2, 'ffff'), duration_ms: 1000, started_at: null, played: false },
    ];
    const p = buildIeltsListeningProgram(qs, sectionRanges(qs), { ...format, listening_parts: parts }, isL);
    const plays = ieltsAudioPlays(p, parts, undefined);
    expect(plays).toEqual({ [id(1)]: 1 });
    // Không có vị trí cục bộ → tiếp từ sau audio part 1 (đọc trước part 2)
    expect(resumeCursor(p, null, plays)).toEqual({ step: 2, offsetMs: 0 });
    // Server: part 1 đã nghe xong (played, media_url null) → chuỗi phát bắt đầu từ đọc trước part 2; câu part 1 trả lời tự do
    const done = [{ ...parts[0]!, played: true }, parts[1]!];
    const p2 = buildIeltsListeningProgram(qs, sectionRanges(qs), { ...format, listening_parts: done }, isL);
    expect(p2.steps.map((s) => (s.kind === 'audio' ? `audio:${s.sectionCode}` : s.phase))).toEqual(['preread', 'audio:listening_p2', 'review']);
    expect(p2.unlockStep.has(0)).toBe(false);
  });
});

describe('DraftQueue – 409 section_locked (đồng hồ theo section)', () => {
  it('bỏ các câu của section đã khoá rồi gửi phần còn lại; không đóng cả bài', async () => {
    const sent: string[][] = [];
    let calls = 0;
    const lockedErr = Object.assign(new Error('locked'), { code: 'section_locked' });
    const queue = new DraftQueue({
      attemptId: 'a1',
      isOnline: () => true,
      isClosedError: () => true,
      flush: async (b) => {
        calls++;
        const ids = b.answers.map((a) => a.question_id);
        if (ids.includes('locked-q')) throw lockedErr;
        sent.push(ids);
      },
    });
    queue.setRejectedEntries((err) => (err === lockedErr ? ['locked-q'] : null));
    await queue.ready;
    queue.enqueue({ question_id: 'locked-q', answer: { type: 'mcq_single', selected: 'A' } });
    queue.enqueue({ question_id: 'open-q', answer: { type: 'mcq_single', selected: 'B' } });
    await queue.flush();
    expect(calls).toBe(2);
    expect(sent).toEqual([['open-q']]);
    expect(queue.closed).toBe(false);
    expect(queue.pendingCount).toBe(0);
  });
});
