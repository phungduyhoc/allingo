import { describe, expect, it } from 'vitest';
import { newCardState, previewIntervals, retrievability, reviewCard } from '../src/index.js';

describe('@allingo/fsrs', () => {
  const t0 = new Date('2026-11-01T00:00:00Z');
  it('thẻ mới → Good → due trong tương lai, state learning/review', () => {
    const c0 = newCardState(t0);
    expect(c0.state).toBe('new');
    const { card, review } = reviewCard(c0, 3, t0);
    expect(card.due_at.getTime()).toBeGreaterThan(t0.getTime());
    expect(['learning', 'review']).toContain(card.state);
    expect(card.reps).toBe(1);
    expect(review.rating).toBe(3);
  });
  it('Again tăng lapses khi đang review', () => {
    let c = newCardState(t0);
    let now = t0;
    for (let i = 0; i < 5; i++) {
      c = reviewCard(c, 3, now).card;
      now = new Date(c.due_at.getTime() + 1000);
    }
    expect(c.state).toBe('review');
    const again = reviewCard(c, 1, now).card;
    expect(again.lapses).toBe(c.lapses + 1);
    expect(again.state).toBe('relearning');
  });
  it('Easy cho khoảng dài hơn Good', () => {
    const c = newCardState(t0);
    const p = previewIntervals(c, t0);
    expect(p[4].getTime()).toBeGreaterThan(p[3].getTime());
    expect(p[3].getTime()).toBeGreaterThanOrEqual(p[2].getTime());
  });
  it('retrievability giảm theo thời gian', () => {
    const c = reviewCard(newCardState(t0), 3, t0).card;
    const r1 = retrievability(c, new Date(t0.getTime() + 86_400_000));
    const r2 = retrievability(c, new Date(t0.getTime() + 30 * 86_400_000));
    expect(r1).toBeGreaterThan(r2);
  });
});
