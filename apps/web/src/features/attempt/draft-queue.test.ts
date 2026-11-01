import { describe, expect, it, vi } from 'vitest';
import { DraftQueue, legacyDraftStorageKey } from './draft-queue';
import { createMemoryDraftStore, openDraftStore, sharedMemoryDraftStore, type DraftStore } from './draft-store';
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
    await q.ready;
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
    expect(q.storeKind).toBe('none');
  });

  it('cộng dồn time_spent_ms khi cùng câu', async () => {
    const sent: AttemptAnswersPut[] = [];
    const q = new DraftQueue({ attemptId: 'a2', flush: async (b) => void sent.push(b), isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 1000 });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'B' }, time_spent_ms: 500 });
    await q.flush();
    expect(sent[0]!.answers[0]!.time_spent_ms).toBe(1500);
  });

  it('offline: giữ trong store (fallback bộ nhớ), không gọi flush; tải lại thì khôi phục; online gửi và xoá khỏi store', async () => {
    const store = createMemoryDraftStore();
    let online = false;
    const flush = vi.fn(async () => undefined);
    const q = new DraftQueue({ attemptId: 'a3', flush, store, isOnline: () => online });
    await q.ready;
    expect(q.storeKind).toBe('memory');
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    q.setMeta({ ui_state: { current_question_id: 'q1', current_section_code: 'part5' } });
    await q.flush();
    await q.persisted();
    expect(flush).not.toHaveBeenCalled();
    expect(q.status).toBe('offline');
    expect((await store.load('a3'))?.entries.q1?.answer).toEqual({ type: 'mcq_single', selected: 'A' });

    // Tải lại trang: hàng đợi mới khôi phục bất đồng bộ từ store, kể cả câu đang xem
    const q2 = new DraftQueue({ attemptId: 'a3', flush, store: Promise.resolve(store), isOnline: () => online });
    expect(q2.pendingCount).toBe(0);
    await q2.ready;
    expect(q2.pendingCount).toBe(1);
    expect(q2.pendingUiState()).toEqual({ current_question_id: 'q1', current_section_code: 'part5' });
    online = true;
    await q2.flush();
    await q2.persisted();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await store.load('a3')).toBeNull();
    expect(q2.pendingUiState()).toBeUndefined();
  });

  it('khôi phục không đè thay đổi mới hơn đã enqueue trong lúc chờ store', async () => {
    const store = createMemoryDraftStore();
    await store.save('a6', { entries: { q1: { question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } }, q2: { question_id: 'q2', answer: { type: 'mcq_single', selected: 'B' } } }, updated_at: 1 });
    let release: (s: DraftStore) => void = () => undefined;
    const pendingStore = new Promise<DraftStore>((r) => (release = r));
    const q = new DraftQueue({ attemptId: 'a6', flush: async () => undefined, store: pendingStore, isOnline: () => false });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'D' } });
    release(store);
    await q.ready;
    const byId = Object.fromEntries(q.pendingEntries().map((e) => [e.question_id, e.answer]));
    expect(byId).toEqual({ q1: { type: 'mcq_single', selected: 'D' }, q2: { type: 'mcq_single', selected: 'B' } });
    await q.persisted();
    expect((await store.load('a6'))?.entries.q1?.answer).toEqual({ type: 'mcq_single', selected: 'D' });
  });

  it('chuyển nháp localStorage của bản cũ sang store rồi xoá khoá cũ', async () => {
    const legacy = memoryStorage();
    legacy.setItem(legacyDraftStorageKey('a7'), JSON.stringify({ entries: { q9: { question_id: 'q9', answer: { type: 'mcq_single', selected: 'C' } } }, ui_state: { current_question_id: 'q9' } }));
    const store = createMemoryDraftStore();
    const q = new DraftQueue({ attemptId: 'a7', flush: async () => undefined, store, legacyStorage: legacy, isOnline: () => false });
    await q.ready;
    await q.persisted();
    expect(q.pendingCount).toBe(1);
    expect(legacy.map.has(legacyDraftStorageKey('a7'))).toBe(false);
    expect((await store.load('a7'))?.ui_state).toEqual({ current_question_id: 'q9' });
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

  it('store ghi lỗi (đầy/bị chặn) không làm hỏng hàng đợi', async () => {
    const broken: DraftStore = {
      kind: 'indexeddb',
      load: async () => null,
      save: async () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      remove: async () => undefined,
    };
    const sent: AttemptAnswersPut[] = [];
    const q = new DraftQueue({ attemptId: 'a8', flush: async (b) => void sent.push(b), store: broken, isOnline: () => true });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    await q.persisted();
    q.enqueue({ question_id: 'q2', answer: { type: 'mcq_single', selected: 'B' } });
    await q.persisted();
    await q.flush();
    expect(sent[0]!.answers.map((a) => a.question_id)).toEqual(['q1', 'q2']);
  });

  it('409 (quá hạn + 30 s / đã nộp): báo onClosed đúng một lần, ngừng gửi lại', async () => {
    const conflict = Object.assign(new Error('Attempt has expired'), { status: 409 });
    const flush = vi.fn(async () => {
      throw conflict;
    });
    const q = new DraftQueue({ attemptId: 'a10', flush, isOnline: () => true, isClosedError: (e) => (e as { status?: number }).status === 409 });
    const closed = vi.fn();
    q.onClosed(closed);
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    await expect(q.flush()).rejects.toBe(conflict);
    expect(q.closed).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
    q.enqueue({ question_id: 'q2', answer: { type: 'mcq_single', selected: 'B' } });
    await q.flush();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('clear() xoá nháp khỏi store', async () => {
    const store = createMemoryDraftStore();
    const q = new DraftQueue({ attemptId: 'a9', flush: async () => undefined, store, isOnline: () => false });
    q.enqueue({ question_id: 'q1', answer: { type: 'mcq_single', selected: 'A' } });
    await q.persisted();
    expect(await store.load('a9')).not.toBeNull();
    await q.clear();
    expect(await store.load('a9')).toBeNull();
    expect(q.hasPending).toBe(false);
  });
});

describe('openDraftStore (fallback khi IndexedDB không dùng được)', () => {
  it('không có indexedDB (SSR/Node) → bộ nhớ dùng chung', async () => {
    const s = await openDraftStore(undefined);
    expect(s.kind).toBe('memory');
    expect(s).toBe(sharedMemoryDraftStore());
  });

  it('indexedDB.open ném lỗi (SecurityError) → bộ nhớ', async () => {
    const factory = {
      open: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    } as unknown as IDBFactory;
    expect((await openDraftStore(factory)).kind).toBe('memory');
  });

  it('open báo onerror → bộ nhớ', async () => {
    const factory = {
      open: () => {
        const req = {} as { onerror?: () => void; error: DOMException };
        req.error = new DOMException('broken', 'UnknownError');
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    expect((await openDraftStore(factory)).kind).toBe('memory');
  });

  it('open treo (bị chặn bởi tab khác) → hết giờ chuyển bộ nhớ', async () => {
    const factory = { open: () => ({}) } as unknown as IDBFactory;
    const started = Date.now();
    expect((await openDraftStore(factory, 30)).kind).toBe('memory');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('store bộ nhớ trả bản sao (không chia sẻ tham chiếu)', async () => {
    const s = createMemoryDraftStore();
    const data = { entries: { q1: { question_id: 'q1', answer: { type: 'mcq_single' as const, selected: 'A' } } }, updated_at: 1 };
    await s.save('x', data);
    data.entries.q1.answer.selected = 'B';
    expect((await s.load('x'))?.entries.q1?.answer).toEqual({ type: 'mcq_single', selected: 'A' });
  });
});
