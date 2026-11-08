'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { env } from '@/env';
import { getApiFetch } from '@/lib/api';
import { FEATURE_DISABLED_EVENT } from '@/lib/api-error-events';
import { DEFAULT_FLAGS_TTL_SEC, fetchPublicFlags, isFlagOn, markFlagDisabled, type FeatureDisabledInfo, type FlagKey, type PublicFlags } from '@/lib/flags';

/** Khoá cache cờ – ngoài nhánh `['me']` để đăng nhập/nộp bài (invalidate `['me']`) không làm mới cờ thừa */
export const FLAGS_QUERY_KEY = ['flags'] as const;

const FlagsContext = React.createContext<PublicFlags | null>(null);

function sameFlags(a: PublicFlags, b: PublicFlags): boolean {
  if (a.ttlSec !== b.ttlSec) return false;
  const ka = Object.keys(a.flags);
  return ka.length === Object.keys(b.flags).length && ka.every((k) => a.flags[k] === b.flags[k]);
}

/**
 * Cờ công khai cho toàn ứng dụng (S11). MỘT observer TanStack duy nhất (tránh mỗi `useFlag` tự đặt interval):
 *  - lần đầu: bản SSR (ẩn danh, Data Cache 30 s) nếu có → hiển thị đúng ngay; coi là cũ (updatedAt 0) nên tải lại với cookie để
 *    server đánh giá theo người dùng;
 *  - làm mới mỗi `ttl_sec` (30 s) khi tab đang hiện + khi quay lại tab (đã cũ) – không dày hơn TTL;
 *  - 503 `feature_disabled` ở bất kỳ request nào → tắt cờ đó ngay trong cache, toast `errors.feature_disabled`, tải lại cờ ngay.
 * Tắt `ff.ai.explain` ở admin → API xoá cache (< 1 s) → web ẩn nút trong ≤ ~35 s (tiêu chí S11: < 60 s).
 */
export function FlagsProvider({ initial, children }: { initial: PublicFlags | null; children: React.ReactNode }) {
  const qc = useQueryClient();
  const t = useTranslations('errors');
  const ttlMs = (initial?.ttlSec ?? DEFAULT_FLAGS_TTL_SEC) * 1000;
  const query = useQuery<PublicFlags, Error>({
    queryKey: FLAGS_QUERY_KEY,
    queryFn: ({ signal }) => fetchPublicFlags(env.apiUrl, { fetch: getApiFetch(), signal }),
    ...(initial ? { initialData: initial, initialDataUpdatedAt: 0 } : {}),
    // Mỗi lần làm mới `evaluated_at` đổi → giữ nguyên object cũ khi giá trị cờ không đổi (không dựng lại các component dùng cờ mỗi 30 s)
    structuralSharing: (old, next) => (old && next && sameFlags(old as PublicFlags, next as PublicFlags) ? old : next),
    staleTime: (q) => (q.state.data?.ttlSec ?? DEFAULT_FLAGS_TTL_SEC) * 1000,
    refetchInterval: (q) => (q.state.data?.ttlSec ?? DEFAULT_FLAGS_TTL_SEC) * 1000 || ttlMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
    // Lỗi tải cờ không phải lỗi của người dùng → không toast (giữ bản cũ / mặc định)
    meta: { inlineErrors: true },
  });

  React.useEffect(() => {
    const onDisabled = (e: Event) => {
      const info = (e as CustomEvent<FeatureDisabledInfo>).detail;
      if (!info?.flag) return;
      qc.setQueryData<PublicFlags>(FLAGS_QUERY_KEY, (old) => markFlagDisabled(old, info.flag));
      void qc.invalidateQueries({ queryKey: FLAGS_QUERY_KEY });
      toast.info(t('feature_disabled'), { id: `feature-disabled-${info.flag}`, duration: 6000 });
    };
    window.addEventListener(FEATURE_DISABLED_EVENT, onDisabled);
    return () => window.removeEventListener(FEATURE_DISABLED_EVENT, onDisabled);
  }, [qc, t]);

  return <FlagsContext.Provider value={query.data ?? initial}>{children}</FlagsContext.Provider>;
}

/** Cờ đã đánh giá cho người dùng hiện tại; ngoài provider/chưa tải → mặc định (`FLAG_DEFAULTS`) */
export function useFlag(key: FlagKey): boolean {
  return isFlagOn(React.useContext(FlagsContext), key);
}

/** Toàn bộ bản cờ (hoặc null khi chưa có) – cho trang admin/chẩn đoán */
export function useFlags(): PublicFlags | null {
  return React.useContext(FlagsContext);
}

/** Chỉ hiện `children` khi cờ bật; tắt → `fallback` (mặc định không gì) */
export function FeatureGate({ flag, children, fallback = null }: { flag: FlagKey; children: React.ReactNode; fallback?: React.ReactNode }) {
  return <>{useFlag(flag) ? children : fallback}</>;
}
