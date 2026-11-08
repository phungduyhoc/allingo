'use client';

import * as React from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
// S11: Zod không thử eval (CSP không có 'unsafe-eval') – phải nạp trước mọi lần parse
import './zod-csp';
import { notifyApiError, shouldRetryQuery } from './api-error-events';

/** `meta.inlineErrors` – màn tự hiện lỗi giới hạn tốc độ tại chỗ (form đăng nhập/OTP) → không phát toast chung */
type Meta = Record<string, unknown> | undefined;
const onError = (error: unknown, meta: Meta) => {
  if (meta?.inlineErrors) return;
  notifyApiError(error);
};

function makeQueryClient(): QueryClient {
  return new QueryClient({
    // Lỗi chung ở bất kỳ query/mutation nào → một toast (layout gốc): 429 quota_exceeded (QuotaToastListener – reset + CTA), S11:
    // 429 rate_limited (thời gian chờ), 503 feature_disabled (kill-switch → làm mới cờ ngay)
    queryCache: new QueryCache({ onError: (error, query) => onError(error, query.meta) }),
    mutationCache: new MutationCache({ onError: (error, _v, _c, mutation) => onError(error, mutation.meta) }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Không retry lỗi nghiệp vụ (401/402/403/404), 429, kill-switch 503; retry 2 lần cho lỗi mạng/5xx khác – không vòng lặp
        retry: shouldRetryQuery,
      },
      mutations: { retry: 0 },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
