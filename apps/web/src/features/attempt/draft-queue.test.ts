import { describe, expect, it, vi } from 'vitest';
import { DraftQueue, draftStorageKey } from './draft-queue';
import type { AttemptAnswersPut } from '@/lib/types';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

describe('DraftQueue', () => {
  it('gộp theo question_id và gửi theo lô một lần', async () => {
    const sent: AttemptAnswersPut[] = [];
    const q = new DraftQueue({ attemptId: 'a1', flush: async (b) => void sent.push(b), isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'B' }, flagged: true });
    q.enqueue({ question_id: 'q2', answer: { type: 'mcq_single', selected: 'C' } });
    q.setMeta({ ui_state: { current_question_id: 'q2' } });
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.answers).toEqual([
      { question_id: 'q1', answer: { type: 'mcq_single', selected: 'B' }, flagged: true, time_spent_ms: undefined },
      { question_id: 'q2', answer: { type: 'mcq_single', selected: 'C' }, time_spent_ms: undefined },
    ]);
    expect(sent[0]!.ui_state).toEqual({ current_question_id: 'q2' });
    expect(q.pendingCount).toBe(0);
    expect(q.status).toBe('saved');
  });

  it('cộng dồn time_spent_ms khi cùng câu', async () => {
    const sent: AttemptAnswersPut[] = [];
    const q = new DraftQueue({ attemptId: 'a2', flush: async (b) => void sent.push(b), isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 1000 });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'B' }, time_spent_ms: 500 });
    await q.flush();
    expect(sent[0]!.answers[0]!.time_spent_ms).toBe(1500);
  });

  it('offline: giữ trong storage, không gọi flush; online lại thì gửi và xoá storage', async () => {
    const storage = memoryStorage();
    let online = false;
    const flush = vi.fn(async () => undefined);
    const q = new DraftQueue({ attemptId: 'a3', flush, storage, isOnline: () => online });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    await q.flush();
    expect(flush).not.toHaveBeenCalled();
    expect(q.status).toBe('offline');
    expect(storage.map.has(draftStorageKey('a3'))).toBe(true);

    // Tải lại trang: hàng đợi mới khôi phục từ storage
    const q2 = new DraftQueue({ attemptId: 'a3', flush, storage, isOnline: () => online });
    expect(q2.pendingCount).toBe(1);
    online = true;
    await q2.flush();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(storage.map.has(draftStorageKey('a3'))).toBe(false);
  });

  it('lỗi mạng: giữ lại mục chưa gửi, trạng thái error, lần sau gửi lại', async () => {
    let fail = true;
    const flush = vi.fn(async () => {
      if (fail) throw new TypeError('Failed to fetch');
    });
    const q = new DraftQueue({ attemptId: 'a4', flush, isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'fill_blank', blanks: { b1: '8' } } });
    await expect(q.flush()).rejects.toThrow();
    expect(q.status).toBe('error');
    expect(q.pendingCount).toBe(1);
    fail = false;
    await q.flush();
    expect(q.pendingCount).toBe(0);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('thay đổi trong lúc đang gửi không bị mất', async () => {
    const first = { resolve: (): void => undefined };
    const bodies: AttemptAnswersPut[] = [];
    const flush = vi.fn((b: AttemptAnswersPut) => {
      bodies.push(b);
      return bodies.length === 1 ? new Promise<void>((r) => (first.resolve = r)) : Promise.resolve();
    });
    const q = new DraftQueue({ attemptId: 'a5', flush, isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    const p = q.flush();
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'D' } });
    first.resolve();
    await p;
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.answers[0]!.answer).toEqual({ type: 'mcq_single', selected: 'D' });
    expect(q.pendingCount).toBe(0);
  });
});
