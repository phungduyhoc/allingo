'use client';

import * as React from 'react';
import { ApiError } from '@allingo/api-client';
import { explanationSchema } from '@allingo/schemas';
import { postJsonOrStream } from '@/lib/api';
import type { ExplainInput, Explanation } from '@/lib/types';

export interface ExplainState {
  status: 'idle' | 'streaming' | 'done' | 'error';
  /** Văn bản hiển thị dần từ các event `delta` */
  streamText: string;
  data: Explanation | null;
  cached: boolean;
  aiTaskId: string | null;
  error: unknown;
}

const INITIAL: ExplainState = { status: 'idle', streamText: '', data: null, cached: false, aiTaskId: null, error: null };

const STATUS_BY_CODE: Record<string, number> = { quota_exceeded: 429, insufficient_credits: 402, exam_mode_locked: 403, unauthorized: 401, rate_limited: 429 };

/**
 * POST /ai/explain: cache hit → JSON 200 (cached: true) hiển thị ngay; sinh mới → SSE
 * start → delta* → result → done (hoặc error). Validate `result` bằng Zod trước khi hiển thị.
 */
export function useExplain(initial?: Explanation | null) {
  const [state, setState] = React.useState<ExplainState>(() => (initial ? { ...INITIAL, status: 'done', data: initial, cached: true, aiTaskId: initial.ai_task_id } : INITIAL));
  const abortRef = React.useRef<AbortController | null>(null);

  const run = React.useCallback(async (input: ExplainInput) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setState({ ...INITIAL, status: 'streaming' });
    try {
      const res = await postJsonOrStream('/ai/explain', input, ac.signal);
      if (res.kind === 'json') {
        const parsed = explanationSchema.safeParse(res.data);
        if (!parsed.success) throw new ApiError(500, { error: { code: 'internal', message: 'Invalid explanation payload' } });
        setState({ status: 'done', streamText: '', data: parsed.data, cached: parsed.data.cached, aiTaskId: parsed.data.ai_task_id, error: null });
        return;
      }
      let text = '';
      let aiTaskId: string | null = null;
      let data: Explanation | null = null;
      for await (const ev of res.events) {
        if (ac.signal.aborted) return;
        const d = (ev.data ?? {}) as Record<string, unknown>;
        switch (ev.event) {
          case 'start':
            aiTaskId = typeof d.ai_task_id === 'string' ? d.ai_task_id : null;
            setState((s) => ({ ...s, aiTaskId }));
            break;
          case 'delta':
            text += typeof d.text === 'string' ? d.text : '';
            setState((s) => ({ ...s, streamText: text }));
            break;
          case 'result': {
            const parsed = explanationSchema.safeParse(d.data);
            if (!parsed.success) throw new ApiError(500, { error: { code: 'internal', message: 'Invalid explanation payload' } });
            data = parsed.data;
            aiTaskId = (typeof d.ai_task_id === 'string' ? d.ai_task_id : null) ?? data.ai_task_id;
            break;
          }
          case 'error': {
            const code = typeof d.code === 'string' ? d.code : 'internal';
            throw new ApiError(STATUS_BY_CODE[code] ?? 500, { error: { code, message: typeof d.message === 'string' ? d.message : 'AI error' } });
          }
          case 'done':
            break;
          default:
            break;
        }
      }
      if (!data) throw new ApiError(500, { error: { code: 'internal', message: 'Stream ended without result' } });
      setState({ status: 'done', streamText: text, data, cached: false, aiTaskId, error: null });
    } catch (err) {
      if (ac.signal.aborted) return;
      setState((s) => ({ ...s, status: 'error', error: err }));
    }
  }, []);

  React.useEffect(() => () => abortRef.current?.abort(), []);

  return { state, run };
}
