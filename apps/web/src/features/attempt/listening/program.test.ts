import { describe, expect, it } from 'vitest';
import type { QuestionPublic } from '@/lib/types';
import { questionGroups } from '../attempt-state';
import { buildListeningProgram, cursorFromAudioPlays, focusIndexAt, isAnswerable, parseStoredCursor, pauseMsOf, resumeCursor, serializeCursor, upcomingAudioSteps } from './program';

const id = (n: number, p = 'aaaa') => `${p}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function q(n: number, section: string, opts: { audio?: boolean; pause?: number; policy?: 'once' | 'free'; group?: number } = {}): QuestionPublic {
  const audio = opts.audio ?? true;
  const passage = opts.group
    ? { id: id(opts.group, 'eeee'), kind: 'audio_script', title: `Conversation ${opts.group}`, body: null, media_url: `/g${opts.group}.mp3?sig=1`, media_asset_id: id(opts.group, 'ffff') }
    : null;
  return {
    question_id: id(n),
    question_version_id: id(n, 'bbbb'),
    question_type: 'mcq_single',
    section_code: section,
    group_key: opts.group ? `g${opts.group}` : null,
    order_no: n,
    content: { type: 'mcq_single', stem: '', options: [], tags: [], media: { listen_policy: opts.policy ?? 'once', ...(opts.pause !== undefined ? { pause_ms: opts.pause } : {}) } },
    media: audio ? [{ id: id(n, 'dddd'), kind: 'audio', url: `/q${n}.mp3?sig=1`, duration_ms: 3000 }] : [],
    passage,
  };
}

function reading(n: number): QuestionPublic {
  return { ...q(n, 'part5', { audio: false }), content: { type: 'mcq_single', stem: 'x', options: [], tags: [] } };
}

const build = (qs: QuestionPublic[]) => buildListeningProgram(qs, questionGroups(qs));

describe('buildListeningProgram', () => {
  it('Part 1/2: audio câu → chờ pause_ms → câu kế', () => {
    const p = build([q(1, 'part1', { pause: 5000 }), q(2, 'part2', { pause: 4000 })]);
    expect(p.steps.map((s) => (s.kind === 'audio' ? `audio:${s.role}:${s.questionIndex}` : `pause:${s.ms}:${s.questionIndex}`))).toEqual(['audio:question:0', 'pause:5000:0', 'audio:question:1', 'pause:4000:1']);
    expect(p.unlockStep.get(0)).toBe(0);
    expect(p.unlockStep.get(1)).toBe(2);
    expect(p.firstIndex).toBe(0);
    expect(p.lastIndex).toBe(1);
    expect(p.nextIndex).toBeNull();
  });

  it('Part 3/4: audio nhóm → lần lượt audio câu hỏi + pause_ms; cả nhóm mở từ khi hội thoại bắt đầu', () => {
    const p = build([q(1, 'part2'), q(2, 'part3', { group: 1, pause: 8000 }), q(3, 'part3', { group: 1, pause: 8000 }), q(4, 'part3', { group: 1, pause: 8000 })]);
    const kinds = p.steps.map((s) => (s.kind === 'audio' ? `${s.role}@${s.questionIndex}` : `pause@${s.questionIndex}`));
    expect(kinds).toEqual(['question@0', 'pause@0', 'group@1', 'question@1', 'pause@1', 'question@2', 'pause@2', 'question@3', 'pause@3']);
    const group = p.steps[2]!;
    expect(group.kind === 'audio' && group.url).toBe('/g1.mp3?sig=1');
    expect(group.kind === 'audio' && group.assetId).toBe(id(1, 'ffff'));
    // Sự kiện audio nhóm mang question_id của câu đầu nhóm (hợp đồng audio_plays)
    expect(group.kind === 'audio' && group.eventQuestionId).toBe(id(2));
    expect([p.unlockStep.get(1), p.unlockStep.get(2), p.unlockStep.get(3)]).toEqual([2, 2, 2]);
    expect(group.groupStart).toBe(1);
    expect(group.groupEnd).toBe(3);
  });

  it('pause_ms mặc định theo Part khi nội dung không ghi', () => {
    expect(pauseMsOf(q(1, 'part1'))).toBe(5000);
    expect(pauseMsOf(q(1, 'part4'))).toBe(8000);
    expect(pauseMsOf(q(1, 'part9'))).toBe(5000);
    expect(pauseMsOf(q(1, 'part3', { pause: 0 }))).toBe(0);
  });

  it('chỉ câu listen_policy = once; Reading sau Listening là nextIndex và luôn chọn được', () => {
    const qs = [q(1, 'part1'), q(2, 'part2', { policy: 'free' }), reading(3), reading(4)];
    const p = build(qs);
    expect(p.steps).toHaveLength(2);
    expect(p.unlockStep.has(1)).toBe(false);
    expect(p.nextIndex).toBe(1);
    expect(isAnswerable(p, 2, -1)).toBe(true);
  });

  it('đề L&R: nextIndex = câu Reading đầu tiên; focus khi xong = Reading', () => {
    const qs = [q(1, 'part1'), q(2, 'part2'), reading(3)];
    const p = build(qs);
    expect(p.nextIndex).toBe(2);
    expect(focusIndexAt(p, 0)).toBe(0);
    expect(focusIndexAt(p, 3)).toBe(1);
    expect(focusIndexAt(p, p.steps.length)).toBe(2);
  });

  it('không có Listening → chương trình rỗng', () => {
    const p = build([reading(1), reading(2)]);
    expect(p.steps).toEqual([]);
    expect(p.firstIndex).toBe(-1);
    expect(p.nextIndex).toBeNull();
  });
});

describe('isAnswerable / upcomingAudioSteps', () => {
  const p = build([q(1, 'part1'), q(2, 'part1'), q(3, 'part3', { group: 1 }), q(4, 'part3', { group: 1 })]);
  it('câu chưa phát bị khoá; đã/đang phát mở; xong toàn bộ → mở hết', () => {
    expect(isAnswerable(p, 0, -1)).toBe(false);
    expect(isAnswerable(p, 0, 0)).toBe(true);
    expect(isAnswerable(p, 1, 1)).toBe(false);
    expect(isAnswerable(p, 1, 2)).toBe(true);
    // Hội thoại (bước 4) bắt đầu → cả hai câu của nhóm mở
    expect(isAnswerable(p, 3, 3)).toBe(false);
    expect(isAnswerable(p, 3, 4)).toBe(true);
    expect(isAnswerable(p, 2, 4)).toBe(true);
    expect(isAnswerable(p, 3, p.steps.length)).toBe(true);
  });
  it('preload: bước audio hiện tại + các bước audio kế tiếp', () => {
    expect(upcomingAudioSteps(p, 0, 3)).toEqual([0, 2, 4]);
    expect(upcomingAudioSteps(p, 1, 3)).toEqual([2, 4, 5]);
    expect(upcomingAudioSteps(p, 7, 3)).toEqual([7]);
    expect(upcomingAudioSteps(p, 99, 3)).toEqual([]);
  });
});

describe('khôi phục vị trí', () => {
  const qs = [q(1, 'part1'), q(2, 'part2'), q(3, 'part3', { group: 1 }), q(4, 'part3', { group: 1 })];
  const p = build(qs);
  // bước: 0 a(q1) 1 p 2 a(q2) 3 p 4 g(q3) 5 a(q3) 6 p 7 a(q4) 8 p

  it('lưu/đọc localStorage; bỏ bản không khớp số bước hoặc hỏng', () => {
    const raw = serializeCursor({ step: 4, offsetMs: 1234.6 }, p.steps.length);
    expect(parseStoredCursor(raw, p.steps.length)).toEqual({ step: 4, offsetMs: 1235 });
    expect(parseStoredCursor(raw, p.steps.length + 1)).toBeNull();
    expect(parseStoredCursor('{bad', p.steps.length)).toBeNull();
    expect(parseStoredCursor(null, p.steps.length)).toBeNull();
    // Đã xong → offset bỏ qua
    expect(parseStoredCursor(serializeCursor({ step: 99, offsetMs: 50 }, p.steps.length), p.steps.length)).toEqual({ step: p.steps.length, offsetMs: 0 });
  });

  it('audio_plays (server): sau bước audio cuối đã bắt đầu, không phát lại', () => {
    expect(cursorFromAudioPlays(p, undefined)).toEqual({ step: 0, offsetMs: 0 });
    expect(cursorFromAudioPlays(p, {})).toEqual({ step: 0, offsetMs: 0 });
    expect(cursorFromAudioPlays(p, { [id(1)]: 1 })).toEqual({ step: 1, offsetMs: 0 });
    // Nhóm: hội thoại + audio câu đầu nhóm cùng question_id → 2 lượt
    expect(cursorFromAudioPlays(p, { [id(1)]: 1, [id(2)]: 1, [id(3)]: 1 })).toEqual({ step: 5, offsetMs: 0 });
    expect(cursorFromAudioPlays(p, { [id(1)]: 1, [id(2)]: 1, [id(3)]: 2 })).toEqual({ step: 6, offsetMs: 0 });
    // Thiếu lượt giữa chừng (sự kiện mất khi offline) → dừng ở chỗ thiếu
    expect(cursorFromAudioPlays(p, { [id(1)]: 1, [id(3)]: 2 })).toEqual({ step: 1, offsetMs: 0 });
  });

  it('ưu tiên bản cục bộ (giữa audio) trừ khi server đã nghe xa hơn', () => {
    const plays = { [id(1)]: 1, [id(2)]: 1, [id(3)]: 1 };
    // Cục bộ đang giữa hội thoại (bước 4) – server đã ghi nhận bước 4 bắt đầu → dùng cục bộ (tiếp tục từ 3,2 s)
    expect(resumeCursor(p, { step: 4, offsetMs: 3200 }, plays)).toEqual({ step: 4, offsetMs: 3200 });
    // Cục bộ cũ hơn server (thiết bị khác đã nghe tới câu 3) → theo server
    expect(resumeCursor(p, { step: 1, offsetMs: 500 }, plays)).toEqual({ step: 5, offsetMs: 0 });
    expect(resumeCursor(p, null, plays)).toEqual({ step: 5, offsetMs: 0 });
    expect(resumeCursor(p, { step: 8, offsetMs: 100 }, plays)).toEqual({ step: 8, offsetMs: 100 });
  });
});
