// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { ApiError } from '@allingo/api-client';
import { notifyApiError } from '@/lib/api-error-events';
import type { PublicFlags } from '@/lib/flags';
import { FLAGS_QUERY_KEY, FeatureGate, FlagsProvider, useFlag } from './flags-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const flagsBody = (flags: Record<string, boolean>) => new Response(JSON.stringify({ flags, ttl_sec: 30, evaluated_at: new Date().toISOString() }), { status: 200, headers: { 'Content-Type': 'application/json' } });

function Probe() {
  const explain = useFlag('ff.ai.explain');
  const tutor = useFlag('ff.ai.tutor');
  return React.createElement(
    'div',
    null,
    React.createElement('span', { id: 'explain' }, String(explain)),
    React.createElement('span', { id: 'tutor' }, String(tutor)),
    React.createElement(FeatureGate, { flag: 'ff.ai.explain', fallback: React.createElement('span', { id: 'off' }, 'off'), children: React.createElement('button', { id: 'explain-btn' }, 'x') }),
  );
}

const text = (id: string) => document.getElementById(id)?.textContent ?? null;
const flush = async (ms = 0) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

describe('FlagsProvider / useFlag (S11)', () => {
  let root: Root;
  let qc: QueryClient;
  let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
  let container: HTMLElement;

  const render = async (initial: PublicFlags | null) => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      const tree = React.createElement(QueryClientProvider, { client: qc, children: React.createElement(FlagsProvider, { initial, children: React.createElement(Probe) }) });
      root.render(React.createElement(NextIntlClientProvider, { locale: 'vi', messages: { errors: { feature_disabled: 'Tính năng này đang tạm tắt.' } }, children: tree }));
    });
  };

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => flagsBody({ 'ff.ai.explain': true, 'ff.ai.tutor': true }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    qc.clear();
    vi.unstubAllGlobals();
  });

  it('lần vẽ đầu dùng bản SSR (không nháy), rồi tải lại kèm cookie để đánh giá theo người dùng', async () => {
    fetchMock.mockImplementation(async () => flagsBody({ 'ff.ai.explain': false, 'ff.ai.tutor': true }));
    await render({ flags: { 'ff.ai.explain': true, 'ff.ai.tutor': true }, ttlSec: 30, evaluatedAt: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toMatch(/\/flags$/);
    expect(init.credentials).toBe('include');
    await flush(10);
    expect(text('explain')).toBe('false');
    expect(text('off')).toBe('off');
    expect(document.getElementById('explain-btn')).toBeNull();
  });

  it('chưa có bản nào → mặc định (kill-switch BẬT) trong lúc tải', async () => {
    let resolve!: (r: Response) => void;
    fetchMock.mockImplementation(() => new Promise<Response>((r) => (resolve = r)));
    await render(null);
    expect(text('explain')).toBe('true');
    expect(document.getElementById('explain-btn')).not.toBeNull();
    await act(async () => resolve(flagsBody({ 'ff.ai.explain': false })));
    await flush(10);
    expect(text('explain')).toBe('false');
  });

  it('503 feature_disabled ở request bất kỳ → tắt cờ ngay + tải lại cờ ngay (không chờ 30 s)', async () => {
    await render({ flags: { 'ff.ai.explain': true, 'ff.ai.tutor': true }, ttlSec: 30, evaluatedAt: null });
    await flush(10);
    expect(text('tutor')).toBe('true');
    const calls = fetchMock.mock.calls.length;
    // Server đã tắt ff.ai.tutor
    fetchMock.mockImplementation(async () => flagsBody({ 'ff.ai.explain': true, 'ff.ai.tutor': false }));
    await act(async () => {
      notifyApiError(new ApiError(503, { error: { code: 'feature_disabled', message: 'off', details: { flag: 'ff.ai.tutor', message_key: 'errors.feature_disabled', retry_after_sec: 60 } } }));
    });
    expect(text('tutor')).toBe('false');
    await flush(10);
    expect(fetchMock.mock.calls.length).toBe(calls + 1);
    expect(qc.getQueryData<PublicFlags>(FLAGS_QUERY_KEY)?.flags['ff.ai.tutor']).toBe(false);
  });

  it('làm mới định kỳ theo ttl_sec (≥ 30 s/lần), không dày hơn', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await render({ flags: { 'ff.ai.explain': true }, ttlSec: 30, evaluatedAt: null });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const afterMount = fetchMock.mock.calls.length;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      expect(fetchMock.mock.calls.length).toBe(afterMount);
      fetchMock.mockImplementation(async () => flagsBody({ 'ff.ai.explain': false }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(fetchMock.mock.calls.length).toBe(afterMount + 1);
      expect(text('explain')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });
});
