import { describe, expect, it } from 'vitest';
import { ApiError, readSse } from '@allingo/api-client';
import {
  INCOMPLETE_STREAM,
  aiStreamReducer,
  consumeAiResponse,
  extractJsonStrings,
  initialAiStream,
  sseToAction,
  streamPreview,
  toAiStreamError,
  type AiStreamAction,
  type AiStreamState,
} from './ai-stream';

interface Out {
  answer: string;
}
const parse = (d: unknown): Out | null => (d && typeof d === 'object' && typeof (d as Out).answer === 'string' ? (d as Out) : null);

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x));
      c.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function run(chunks: string[]): Promise<{ state: AiStreamState<Out>; actions: AiStreamAction<Out>[] }> {
  let state = aiStreamReducer(initialAiStream<Out>(), { type: 'request' });
  const actions: AiStreamAction<Out>[] = [];
  await consumeAiResponse({ kind: 'sse', events: readSse(sseResponse(chunks)) }, parse, (a) => {
    actions.push(a);
    state = aiStreamReducer(state, a);
  });
  return { state, actions };
}

describe('sseToAction – định dạng SSE AI Gateway v1.1', () => {
  it('ánh xạ start/delta/result/error/done; bỏ qua sự kiện lạ', () => {
    expect(sseToAction<Out>({ event: 'start', data: { ai_task_id: 't1', cached: false } }, parse)).toEqual({ type: 'start', aiTaskId: 't1', cached: false });
    expect(sseToAction<Out>({ event: 'delta', data: { text: 'abc' } }, parse)).toEqual({ type: 'delta', text: 'abc' });
    expect(sseToAction<Out>({ event: 'result', data: { data: { answer: 'B' }, ai_task_id: 't1', cached: true } }, parse)).toEqual({ type: 'result', data: { answer: 'B' }, aiTaskId: 't1', cached: true });
    expect(sseToAction<Out>({ event: 'error', data: { code: 'ai_timeout', message: 'timeout' } }, parse)).toEqual({ type: 'error', error: { code: 'ai_timeout', status: null, message: 'timeout' } });
    expect(sseToAction<Out>({ event: 'done', data: {} }, parse)).toEqual({ type: 'done' });
    expect(sseToAction<Out>({ event: 'message', data: 'ping' }, parse)).toBeNull();
  });

  it('result sai dạng (Zod không qua) → lỗi ai_failed, không hiển thị dữ liệu chưa kiểm', () => {
    const a = sseToAction<Out>({ event: 'result', data: { data: { wrong: 1 }, ai_task_id: 't1', cached: false } }, parse);
    expect(a).toMatchObject({ type: 'error', error: { code: 'ai_failed' } });
  });

  it('start thiếu ai_task_id → null; error thiếu code → ai_failed', () => {
    expect(sseToAction<Out>({ event: 'start', data: { cached: true } }, parse)).toEqual({ type: 'start', aiTaskId: null, cached: true });
    expect(sseToAction<Out>({ event: 'error', data: {} }, parse)).toMatchObject({ error: { code: 'ai_failed' } });
  });
});

describe('consumeAiResponse + aiStreamReducer', () => {
  it('luồng đầy đủ: start → delta* → result → done; chunk cắt giữa sự kiện', async () => {
    const { state, actions } = await run([
      'event: start\ndata: {"ai_task_id":"t1","cached":false}\n\nevent: del',
      'ta\ndata: {"text":"{\\"answer\\": \\"B"}\n\n: ping\n\nevent: delta\ndata: {"text":"\\"}"}\n\n',
      'event: result\ndata: {"data":{"answer":"B"},"ai_task_id":"t1","cached":false}\n\nevent: done\ndata: {}\n\n',
    ]);
    expect(actions.map((a) => a.type)).toEqual(['start', 'delta', 'delta', 'result', 'done']);
    expect(state).toMatchObject({ status: 'done', aiTaskId: 't1', cached: false, data: { answer: 'B' }, error: null });
    expect(state.text).toBe('{"answer": "B"}');
  });

  it('chẩn đoán đã có: start{cached:true} → result → done (không delta)', async () => {
    const { state } = await run(['event: start\ndata: {"ai_task_id":"t9","cached":true}\n\nevent: result\ndata: {"data":{"answer":"C"},"ai_task_id":"t9","cached":true}\n\nevent: done\ndata: {}\n\n']);
    expect(state).toMatchObject({ status: 'done', cached: true, aiTaskId: 't9', data: { answer: 'C' } });
  });

  it('lỗi AI giữa chừng: error → done giữ lỗi (quota đã hoàn ở server), bỏ phần chữ đã stream khỏi data', async () => {
    const { state } = await run(['event: start\ndata: {"ai_task_id":"t2","cached":false}\n\nevent: delta\ndata: {"text":"Vì"}\n\nevent: error\ndata: {"code":"ai_timeout","message":"timeout"}\n\nevent: done\ndata: {}\n\n']);
    expect(state.status).toBe('error');
    expect(state.error).toEqual({ code: 'ai_timeout', status: null, message: 'timeout' });
    expect(state.data).toBeNull();
  });

  it('kết nối đóng trước result (không có done) → lỗi luồng dở', async () => {
    const { state } = await run(['event: start\ndata: {"ai_task_id":"t3","cached":false}\n\nevent: delta\ndata: {"text":"abc"}\n\n']);
    expect(state.status).toBe('error');
    expect(state.error).toEqual(INCOMPLETE_STREAM);
  });

  it('JSON (cache hit của /ai/explain) → loaded, cached mặc định true', async () => {
    let state = aiStreamReducer(initialAiStream<Out>(), { type: 'request' });
    await consumeAiResponse<Out>({ kind: 'json', data: { answer: 'A', ai_task_id: 't4', cached: true } }, parse, (a) => (state = aiStreamReducer(state, a)));
    expect(state).toMatchObject({ status: 'done', cached: true, aiTaskId: 't4', data: { answer: 'A', ai_task_id: 't4', cached: true } });
  });

  it('reducer bỏ qua sự kiện sau khi đã xong và trước request; request xoá trạng thái cũ', () => {
    const done = aiStreamReducer(initialAiStream<Out>({ data: { answer: 'A' }, aiTaskId: 'x', cached: true }), { type: 'delta', text: 'zzz' });
    expect(done).toMatchObject({ status: 'done', text: '', data: { answer: 'A' } });
    const idle = aiStreamReducer(initialAiStream<Out>(), { type: 'delta', text: 'x' });
    expect(idle.status).toBe('idle');
    const again = aiStreamReducer(done, { type: 'request' });
    expect(again).toEqual({ status: 'connecting', aiTaskId: null, cached: false, text: '', data: null, error: null });
    expect(aiStreamReducer(again, { type: 'reset' }).status).toBe('idle');
  });
});

describe('toAiStreamError', () => {
  it('ApiError giữ status/code/details; TypeError → network; AbortError → null', () => {
    const e = toAiStreamError(new ApiError(429, { error: { code: 'quota_exceeded', message: 'x', details: { upgrade: true } } }));
    expect(e).toEqual({ code: 'quota_exceeded', status: 429, message: 'x', details: { upgrade: true } });
    expect(toAiStreamError(new TypeError('Failed to fetch'))).toMatchObject({ code: 'network' });
    expect(toAiStreamError(new DOMException('aborted', 'AbortError'))).toBeNull();
  });
});

describe('extractJsonStrings / streamPreview – chữ hiện dần từ JSON đang sinh', () => {
  it('trích giá trị chuỗi theo đường dẫn, kể cả mảng và object lồng nhau', () => {
    const raw = '{"correct_option":"B","why_correct":"Vì \\"invoice\\" là danh từ","why_others_wrong":{"A":"sai từ loại"},"steps":["Một","Hai"],"check_question":{"stem":"S?","options":["x","y"]},"n":3}';
    expect(extractJsonStrings(raw)).toEqual([
      { path: 'correct_option', value: 'B', complete: true },
      { path: 'why_correct', value: 'Vì "invoice" là danh từ', complete: true },
      { path: 'why_others_wrong.A', value: 'sai từ loại', complete: true },
      { path: 'steps', value: 'Một', complete: true },
      { path: 'steps', value: 'Hai', complete: true },
      { path: 'check_question.stem', value: 'S?', complete: true },
      { path: 'check_question.options', value: 'x', complete: true },
      { path: 'check_question.options', value: 'y', complete: true },
    ]);
  });

  it('chuỗi dở ở cuối vẫn hiện; escape/unicode dở bị bỏ; khoá dở chưa tính', () => {
    expect(extractJsonStrings('{"why":"Đang vi')).toEqual([{ path: 'why', value: 'Đang vi', complete: false }]);
    expect(extractJsonStrings('{"why":"a\\')).toEqual([{ path: 'why', value: 'a', complete: false }]);
    expect(extractJsonStrings('{"why":"\\u00e9\\u00')).toEqual([{ path: 'why', value: 'é', complete: false }]);
    expect(extractJsonStrings('{"why":"x","ste')).toEqual([{ path: 'why', value: 'x', complete: true }]);
    expect(extractJsonStrings('')).toEqual([]);
  });

  it('streamPreview: văn xuôi giữ nguyên; JSON chỉ lấy trường văn bản cho người học, mỗi giá trị một dòng; bọc ```json', () => {
    expect(streamPreview('Đáp án B đúng vì', ['why_correct'])).toEqual({ kind: 'text', text: 'Đáp án B đúng vì' });
    const fields = ['why_correct', 'why_others_wrong', 'how_to_spot'];
    expect(streamPreview('{"correct_option":"B","why_correct":"Danh từ sau mạo từ","why_others_wrong":{"A":"Động t', fields)).toEqual({ kind: 'json', text: 'Danh từ sau mạo từ\nĐộng t' });
    expect(streamPreview('```json\n{"why_correct":"OK"}', fields)).toEqual({ kind: 'json', text: 'OK' });
    expect(streamPreview('  {"locale":"vi"', fields)).toEqual({ kind: 'json', text: '' });
    expect(streamPreview('', fields)).toEqual({ kind: 'text', text: '' });
  });
});
