import { describe, expect, it } from 'vitest';
import { readSse } from '@allingo/api-client';

function streamOf(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

describe('readSse (parser SSE của api-client, dùng cho /ai/explain)', () => {
  it('tách event/data kể cả khi chunk cắt giữa dòng', async () => {
    const res = streamOf(['event: start\ndata: {"ai_task_id":"t1","cached":false}\n\nevent: del', 'ta\ndata: {"text":"Vì sao "}\n\nevent: delta\ndata: {"te', 'xt":"đáp án đúng"}\n\nevent: result\ndata: {"data":{"correct_option":"B"}}\n\nevent: done\ndata: {}\n\n']);
    const events = [];
    for await (const e of readSse(res)) events.push(e);
    expect(events.map((e) => e.event)).toEqual(['start', 'delta', 'delta', 'result', 'done']);
    expect(events[1]!.data).toEqual({ text: 'Vì sao ' });
    expect(events[3]!.data).toEqual({ data: { correct_option: 'B' } });
  });

  it('data nhiều dòng được nối bằng \\n; data không phải JSON giữ nguyên chuỗi', async () => {
    const res = streamOf(['event: note\ndata: line1\ndata: line2\n\n', ': comment\n\ndata: {"a":1}\n\n']);
    const events = [];
    for await (const e of readSse(res)) events.push(e);
    expect(events).toEqual([
      { event: 'note', data: 'line1\nline2' },
      { event: 'message', data: { a: 1 } },
    ]);
  });

  it('error event mang mã lỗi envelope', async () => {
    const res = streamOf(['event: error\ndata: {"code":"quota_exceeded","message":"Daily quota reached"}\n\n']);
    const events = [];
    for await (const e of readSse(res)) events.push(e);
    expect(events[0]).toEqual({ event: 'error', data: { code: 'quota_exceeded', message: 'Daily quota reached' } });
  });
});
