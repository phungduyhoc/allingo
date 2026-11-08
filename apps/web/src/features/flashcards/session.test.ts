import { describe, expect, it } from 'vitest';
import type { SrsCard } from '@allingo/schemas/api/learning-tools';
import { AGAIN_GAP, checkDictation, currentCard, initialSession, intervalOf, keyToAction, sessionProgress, sessionReducer, sessionStatus, sessionSummary, suggestedRating, type SessionState } from './session';

const card = (id: string, state: SrsCard['state'] = 'new', extra: Partial<SrsCard> = {}): SrsCard => ({
  id,
  card_type: 'vocab',
  ref_id: `ref-${id}`,
  state,
  due_at: '2026-11-08T00:00:00.000Z',
  stability: null,
  difficulty: null,
  reps: 0,
  lapses: 0,
  payload: { headword: id },
  preview: { again: '2026-11-08T00:01:00.000Z', hard: '2026-11-08T00:05:00.000Z', good: '2026-11-09T00:00:00.000Z', easy: '2026-11-12T00:00:00.000Z' },
  ...extra,
});

const start = (cards: SrsCard[]) => sessionReducer(initialSession(), { type: 'start', cards });
const rate = (s: SessionState, rating: 1 | 2 | 3 | 4, at = `2026-11-08T00:00:0${s.reviewed}.000Z`) => sessionReducer(sessionReducer(s, { type: 'flip' }), { type: 'rate', rating, at });

describe('phiên ôn thẻ – reducer', () => {
  it('bắt đầu: thẻ đầu tiên đang xem, mặt trước, bỏ thẻ trùng', () => {
    const s = start([card('a'), card('b'), card('a')]);
    expect(s.queue).toEqual(['a', 'b']);
    expect(currentCard(s)?.id).toBe('a');
    expect(s.side).toBe('front');
    expect(sessionStatus(s)).toBe('active');
    expect(sessionStatus(initialSession())).toBe('idle');
  });

  it('Good → thẻ rời hàng đợi, ghi lượt gửi server; lật lại mặt trước cho thẻ kế', () => {
    const s = rate(start([card('a'), card('b')]), 3);
    expect(s.queue).toEqual(['b']);
    expect(s.side).toBe('front');
    expect(s.inflight).toEqual([{ card_id: 'a', rating: 3, reviewed_at: '2026-11-08T00:00:00.000Z', review_mode: 'flashcard', was_new: true }]);
    expect(s.ratings[3]).toBe(1);
  });

  it(`Again → thẻ quay lại trong phiên sau ${AGAIN_GAP} thẻ khác, preview cũ bị xoá`, () => {
    const s = rate(start(['a', 'b', 'c', 'd', 'e'].map((x) => card(x))), 1);
    expect(s.queue).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(s.cards.a?.preview).toBeUndefined();
    expect(s.again).toEqual(['a']);
    // Hàng đợi ngắn → về cuối
    const short = rate(start([card('x'), card('y')]), 1);
    expect(short.queue).toEqual(['y', 'x']);
    // Ôn lại thẻ Again → hết phiên khi server xác nhận
    let t = rate(start([card('only')]), 1);
    expect(t.queue).toEqual(['only']);
    t = sessionReducer(t, { type: 'server_ok', review: t.inflight[0]!, card: card('only', 'learning', { in_session: true }) });
    t = rate(t, 3);
    expect(sessionStatus(t)).toBe('saving');
    t = sessionReducer(t, { type: 'server_ok', review: t.inflight[0]!, card: card('only', 'review') });
    expect(sessionStatus(t)).toBe('done');
    expect(sessionSummary(t)).toMatchObject({ cards: 1, reviews: 2, again: 1, recall: 50, learnedNew: 1 });
  });

  it('server báo in_session cho lượt khác Again (Hard ở thẻ đang học) → thêm cuối hàng đợi', () => {
    let s = rate(start([card('a', 'learning'), card('b')]), 2);
    s = sessionReducer(s, { type: 'server_ok', review: s.inflight[0]!, card: card('a', 'learning', { in_session: true }) });
    expect(s.queue).toEqual(['b', 'a']);
    // Lượt trùng (duplicate) không cộng từ mới
    expect(s.learnedNew).toBe(0);
  });

  it('429 hạn mức thẻ mới → hoàn tác lượt, bỏ mọi thẻ mới còn lại, giữ thẻ đã học + giờ reset', () => {
    let s = start([card('n1'), card('r1', 'review'), card('n2')]);
    s = rate(s, 3);
    s = sessionReducer(s, { type: 'server_quota', review: s.inflight[0]!, resetAt: '2026-11-08T17:00:00.000Z' });
    expect(s.queue).toEqual(['r1']);
    expect(s.reviewed).toBe(0);
    expect(s.ratings[3]).toBe(0);
    expect(s.seen).toEqual([]);
    expect(s.newLimit).toEqual({ reached: true, resetAt: '2026-11-08T17:00:00.000Z' });
    expect(s.inflight).toEqual([]);
  });

  it('lỗi mạng → failed, thử lại chuyển về inflight cùng reviewed_at (idempotent)', () => {
    let s = rate(start([card('a'), card('b')]), 4);
    const r = s.inflight[0]!;
    s = sessionReducer(s, { type: 'server_error', review: r });
    expect(s.failed).toEqual([r]);
    expect(s.inflight).toEqual([]);
    s = sessionReducer(s, { type: 'retry', reviews: s.failed });
    expect(s.failed).toEqual([]);
    expect(s.inflight).toEqual([r]);
  });

  it('nạp lại preview cho thẻ quay lại; tiến độ theo thẻ đã xong', () => {
    let s = rate(start([card('a'), card('b')]), 1);
    expect(sessionProgress(s)).toEqual({ done: 0, total: 2 });
    s = sessionReducer(s, { type: 'previews', previews: { a: { again: 'x', hard: 'y', good: 'z', easy: 'w' } } });
    expect(s.cards.a?.preview?.good).toBe('z');
    s = rate(s, 3);
    expect(sessionProgress(s)).toEqual({ done: 1, total: 2 });
  });
});

describe('khoảng lịch xem trước', () => {
  const now = Date.parse('2026-11-08T00:00:00.000Z');
  it('phút / giờ / ngày / tháng / năm', () => {
    expect(intervalOf('2026-11-08T00:01:00.000Z', now)).toEqual({ value: 1, unit: 'minute' });
    expect(intervalOf('2026-11-08T00:00:10.000Z', now)).toEqual({ value: 1, unit: 'minute' });
    expect(intervalOf('2026-11-08T05:00:00.000Z', now)).toEqual({ value: 5, unit: 'hour' });
    expect(intervalOf('2026-11-08T23:59:30.000Z', now)).toEqual({ value: 1, unit: 'day' });
    expect(intervalOf('2026-11-08T00:59:50.000Z', now)).toEqual({ value: 1, unit: 'hour' });
    expect(intervalOf('2026-11-11T00:00:00.000Z', now)).toEqual({ value: 3, unit: 'day' });
    expect(intervalOf('2027-01-07T00:00:00.000Z', now)).toEqual({ value: 2, unit: 'month' });
    expect(intervalOf('2028-05-08T00:00:00.000Z', now)?.unit).toBe('year');
    expect(intervalOf(null, now)).toBeNull();
    expect(intervalOf('không phải ngày', now)).toBeNull();
  });
});

describe('phím tắt', () => {
  it('Space/Enter lật (mặt trước), 1–4 chấm (mặt sau), S phát âm; đang gõ/phím bổ trợ → bỏ qua', () => {
    expect(keyToAction({ key: ' ' }, 'front', false)).toEqual({ type: 'flip' });
    expect(keyToAction({ key: 'Enter' }, 'front', false)).toEqual({ type: 'flip' });
    expect(keyToAction({ key: ' ' }, 'back', false)).toBeNull();
    expect(keyToAction({ key: '1' }, 'front', false)).toBeNull();
    expect(keyToAction({ key: '3' }, 'back', false)).toEqual({ type: 'rate', rating: 3 });
    expect(keyToAction({ key: '5' }, 'back', false)).toBeNull();
    expect(keyToAction({ key: 's' }, 'front', false)).toEqual({ type: 'speak' });
    expect(keyToAction({ key: '2' }, 'back', true)).toBeNull();
    expect(keyToAction({ key: '2', ctrlKey: true }, 'back', false)).toBeNull();
    expect(keyToAction({ key: ' ', repeat: true }, 'front', false)).toBeNull();
  });
});

describe('gõ lại từ (dictation mini)', () => {
  it('đúng / gần đúng (sai 1 ký tự, từ ≥ 5 chữ) / sai; gợi ý điểm', () => {
    expect(checkDictation('  Invoice ', 'invoice')).toBe('correct');
    expect(checkDictation('invoise', 'invoice')).toBe('close');
    expect(checkDictation('inv', 'invoice')).toBe('wrong');
    expect(checkDictation('fee', 'fed')).toBe('wrong');
    expect(checkDictation('', 'invoice')).toBe('wrong');
    expect(checkDictation('follow‐up', 'follow-up')).toBe('close');
    expect(suggestedRating('correct')).toBe(3);
    expect(suggestedRating('close')).toBe(2);
    expect(suggestedRating('wrong')).toBe(1);
  });
});
