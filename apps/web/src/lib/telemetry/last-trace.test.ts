import { afterEach, describe, expect, it } from 'vitest';
import { latestTraceId, recordResponseTrace, recordTrace, resetTracesForTest, TRACE_MAX_AGE_MS } from './last-trace';

describe('trace_id gần nhất cho góp ý (S12)', () => {
  afterEach(() => resetTracesForTest());

  it('ưu tiên trace của phản hồi LỖI gần nhất còn mới; không thì trace gần nhất; quá cũ → null', () => {
    const t0 = 1_000_000;
    recordTrace('aaaaaaaaaaaaaaaa', true, t0);
    expect(latestTraceId(t0 + 1)).toBe('aaaaaaaaaaaaaaaa');
    recordTrace('bbbbbbbbbbbbbbbb', false, t0 + 10);
    recordTrace('cccccccccccccccc', true, t0 + 20);
    expect(latestTraceId(t0 + 30)).toBe('bbbbbbbbbbbbbbbb');
    expect(latestTraceId(t0 + 20 + TRACE_MAX_AGE_MS + 1)).toBeNull();
  });

  it('đọc header x-trace-id; bỏ giá trị sai định dạng (chống chèn)', () => {
    recordResponseTrace(new Response(null, { status: 500, headers: { 'x-trace-id': '4bf92f3577b34da6a3ce929d0e0e4736' } }), 5);
    expect(latestTraceId(6)).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    recordTrace('bad id with spaces', false, 7);
    recordTrace('short', false, 7);
    expect(latestTraceId(8)).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });
});
