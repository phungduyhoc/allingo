'use client';

import * as React from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@allingo/api-client';
import { notifyQuotaExceeded } from './quota';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    // 429 quota_exceeded ở bất kỳ query/mutation nào → toast chung (QuotaToastListener) với thời điểm reset + CTA nâng cấp
    queryCache: new QueryCache({ onError: notifyQuotaExceeded }),
    mutationCache: new MutationCache({ onError: notifyQuotaExceeded }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // Không retry lỗi nghiệp vụ (401/402/403/404/429); retry 2 lần cho lỗi mạng/5xx
          if (error instanceof ApiError && [401, 402, 403, 404, 429].includes(error.status)) return false;
          return failureCount < 2;
        },
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
