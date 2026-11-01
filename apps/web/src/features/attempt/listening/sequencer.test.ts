import { describe, expect, it } from 'vitest';
import { initSequencer, reachedStep, sequencerReducer, type SeqAction, type SeqState, type StepKind } from './sequencer';

const KINDS: StepKind[] = ['audio', 'pause', 'audio', 'audio', 'pause'];
const run = (s: SeqState, ...actions: SeqAction[]) => actions.reduce(sequencerReducer, s);

describe('sequencerReducer', () => {
  it('bắt buộc bấm "Bắt đầu nghe" rồi phát tuần tự: audio → chờ → audio nhóm → audio câu → chờ → xong', () => {
    let s = initSequencer(KINDS, { step: 0, offsetMs: 0 });
    expect(s.phase).toBe('gate');
    expect(run(s, { type: 'ended', step: 0 }).phase).toBe('gate');
    s = run(s, { type: 'start' });
    expect(s).toMatchObject({ phase: 'loading', step: 0 });
    s = run(s, { type: 'playing', step: 0 });
    expect(s.phase).toBe('playing');
    s = run(s, { type: 'ended', step: 0 });
    expect(s).toMatchObject({ phase: 'pause', step: 1 });
    s = run(s, { type: 'pauseElapsed', step: 1 });
    expect(s).toMatchObject({ phase: 'loading', step: 2 });
    s = run(s, { type: 'playing', step: 2 }, { type: 'ended', step: 2 });
    expect(s).toMatchObject({ phase: 'loading', step: 3 });
    s = run(s, { type: 'playing', step: 3 }, { type: 'ended', step: 3 }, { type: 'pauseElapsed', step: 4 });
    expect(s).toMatchObject({ phase: 'done', step: 5 });
    expect(reachedStep(s)).toBe(5);
  });

  it('bỏ qua sự kiện trễ của bước khác (phần tử audio cũ) – không lùi/không nhảy bước', () => {
    let s = run(initSequencer(KINDS, { step: 0, offsetMs: 0 }), { type: 'start' }, { type: 'playing', step: 0 }, { type: 'ended', step: 0 });
    const before = s;
    s = run(s, { type: 'ended', step: 0 }, { type: 'playing', step: 0 }, { type: 'pauseElapsed', step: 3 }, { type: 'stalled', step: 0 });
    expect(s).toBe(before);
    // Không có hành động lùi/tạm dừng: start khi đang chạy không đổi gì
    expect(run(s, { type: 'start' })).toBe(s);
  });

  it('stalled (mất mạng/đệm) → chờ, có dữ liệu lại → playing; hết audio vẫn đi tiếp', () => {
    let s = run(initSequencer(KINDS, { step: 0, offsetMs: 0 }), { type: 'start' }, { type: 'playing', step: 0 });
    s = run(s, { type: 'stalled', step: 0 });
    expect(s.phase).toBe('stalled');
    s = run(s, { type: 'playing', step: 0 });
    expect(s.phase).toBe('playing');
    s = run(s, { type: 'stalled', step: 0 }, { type: 'ended', step: 0 });
    expect(s).toMatchObject({ phase: 'pause', step: 1 });
  });

  it('trình duyệt chặn tự phát → về màn bắt đầu, giữ bước + vị trí; bấm lại tiếp tục đúng chỗ', () => {
    let s = run(initSequencer(KINDS, { step: 0, offsetMs: 0 }), { type: 'start' }, { type: 'playing', step: 0 }, { type: 'ended', step: 0 }, { type: 'pauseElapsed', step: 1 });
    s = run(s, { type: 'blocked', offsetMs: 1500 });
    expect(s).toMatchObject({ phase: 'gate', step: 2, offsetMs: 1500 });
    expect(reachedStep(s)).toBe(2);
    s = run(s, { type: 'start' });
    expect(s).toMatchObject({ phase: 'loading', step: 2, offsetMs: 1500 });
    // Không chặn được khi đang chờ trả lời
    const pause = initSequencer(KINDS, { step: 1, offsetMs: 0 });
    expect(run(run(pause, { type: 'start' }), { type: 'blocked', offsetMs: 0 }).phase).toBe('pause');
  });

  it('khôi phục sau tải lại: bắt đầu ở bước đã lưu (kể cả bước chờ), offset giữ nguyên; đã xong → done', () => {
    const mid = initSequencer(KINDS, { step: 3, offsetMs: 700 });
    expect(mid).toMatchObject({ phase: 'gate', step: 3, offsetMs: 700 });
    expect(reachedStep(mid)).toBe(3);
    const fresh = initSequencer(KINDS, { step: 2, offsetMs: 0 });
    expect(reachedStep(fresh)).toBe(1);
    expect(run(initSequencer(KINDS, { step: 1, offsetMs: 200 }), { type: 'start' }).phase).toBe('pause');
    const done = initSequencer(KINDS, { step: 9, offsetMs: 50 });
    expect(done).toMatchObject({ phase: 'done', step: 5, offsetMs: 0 });
  });

  it('audio hỏng hẳn → skip sang bước kế', () => {
    const s = run(initSequencer(KINDS, { step: 0, offsetMs: 0 }), { type: 'start' }, { type: 'stalled', step: 0 }, { type: 'skip', step: 0 });
    expect(s).toMatchObject({ phase: 'pause', step: 1 });
  });
});
