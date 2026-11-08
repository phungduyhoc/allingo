'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@allingo/api-client';
import { queryKeys } from '@allingo/api-client/react';
import { getApi } from './api';
import { createGuestSession } from './auth';
import type { User } from './types';

/**
 * "Luyện thử miễn phí": dùng lại phiên hiện có (GET /me) hoặc tạo khách (POST /auth/guest). Tách khỏi `lib/queries.ts` (S10)
 * để landing không kéo theo Zod/@allingo/schemas của các hook khác (giảm JS + TBT trang đầu).
 */
export function useStartGuest() {
  const qc = useQueryClient();
  return useMutation<User, Error, void>({
    mutationFn: async () => {
      // Đã có phiên (khách hoặc thật) → dùng lại, không tạo khách mới
      const existing = qc.getQueryData<User>(queryKeys.me);
      if (existing) return existing;
      try {
        return unwrap(await getApi().GET('/me')) as unknown as User;
      } catch {
        return createGuestSession();
      }
    },
    onSuccess: (user) => {
      qc.setQueryData(queryKeys.me, user);
    },
  });
}
