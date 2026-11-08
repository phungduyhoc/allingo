import { describe, expect, it } from 'vitest';
import { matchesEventPattern, outboxBackoffSeconds } from '../../src/shared/events/outbox.service.js';

describe('B7/S26 – outbox: khớp mẫu sự kiện kiểu EventEmitter2', () => {
  it('khớp chính xác, `*` một đoạn, `**` nhiều đoạn', () => {
    expect(matchesEventPattern('outbox.attempt.graded', 'outbox.attempt.graded')).toBe(true);
    expect(matchesEventPattern('outbox.attempt.graded', 'outbox.attempt.submitted')).toBe(false);
    expect(matchesEventPattern('outbox.content.*', 'outbox.content.published')).toBe(true);
    expect(matchesEventPattern('outbox.*', 'outbox.content.published')).toBe(false);
    expect(matchesEventPattern('outbox.**', 'outbox.content.published')).toBe(true);
    expect(matchesEventPattern('outbox.**.paid', 'outbox.order.paid')).toBe(true);
    expect(matchesEventPattern('outbox.attempt.graded', 'outbox.attempt.graded.extra')).toBe(false);
  });
});

describe('B7/S26 – outbox: backoff mũ có trần', () => {
  it('base·2^(n−1), trần max; base 0 → thử lại ngay', () => {
    expect([1, 2, 3, 4, 5].map((n) => outboxBackoffSeconds(n, 10, 3600))).toEqual([10, 20, 40, 80, 160]);
    expect(outboxBackoffSeconds(12, 10, 3600)).toBe(3600);
    expect(outboxBackoffSeconds(100, 10, 3600)).toBe(3600);
    expect(outboxBackoffSeconds(3, 0, 3600)).toBe(0);
  });
});
