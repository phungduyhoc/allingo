'use client';

import * as React from 'react';
import { fetchAttemptMedia } from '@/lib/queries';
import type { QuestionPublic } from '@/lib/types';
import { collectMediaUrls, isStale, mergeMediaMaps, mergeMediaUrls, nextRefreshAt, refreshDelay, resolveMediaUrl, type MediaUrlMap } from './media-urls';

export interface MediaUrls {
  /** URL hiện hành theo asset id (đã gia hạn nếu có); không biết id → `fallback` */
  resolve: (assetId: string | null | undefined, fallback: string) => string;
  /**
   * Như `resolve` nhưng đọc bảng mới nhất ngay cả trước khi React render lại (gọi từ mã mệnh lệnh – engine audio –
   * ngay sau `await refresh()`); hàm ổn định, không đổi danh tính.
   */
  resolveLatest: (assetId: string | null | undefined, fallback: string) => string;
  /** Gọi GET /attempts/{id}/media ngay (audio lỗi 403/hết hạn); gộp các lời gọi đồng thời */
  refresh: () => Promise<void>;
  /** URL của asset sắp hết hạn (≤ 2′) – phần tử chưa phát nên thay src */
  isStale: (assetId: string | null | undefined) => boolean;
}

const RETRY_MS = 15_000;

type MediaSource = readonly Pick<QuestionPublic, 'media' | 'passage'>[];

/**
 * Gia hạn ngầm URL ký (TTL 10′) cho màn làm bài và Xem lại: hẹn giờ gọi `GET /attempts/{id}/media` khi URL sớm nhất còn ≤ 2′,
 * gọi lại khi tab hiện lại sau thời gian dài, khi có mạng lại, hoặc khi phần tử audio báo lỗi. Thất bại → thử lại sau 15 s.
 */
export function useMediaUrls(attemptId: string, questions: MediaSource, opts: { enabled?: boolean } = {}): MediaUrls {
  const enabled = opts.enabled ?? true;
  const [map, setMap] = React.useState<MediaUrlMap>(() => collectMediaUrls(questions));
  // Attempt/review được tải lại (refetch) → gộp URL mới hơn, không làm mất URL đã gia hạn
  const [source, setSource] = React.useState(questions);
  if (source !== questions) {
    setSource(questions);
    setMap((m) => mergeMediaMaps(m, collectMediaUrls(questions)));
  }

  const inflightRef = React.useRef<Promise<void> | null>(null);
  const lastRefreshRef = React.useRef<number | null>(null);
  const [retryTick, setRetryTick] = React.useState(0);
  const mapRef = React.useRef(map);
  React.useEffect(() => {
    mapRef.current = map;
  }, [map]);

  const refresh = React.useCallback(async () => {
    if (inflightRef.current) return inflightRef.current;
    const p = (async () => {
      try {
        const list = await fetchAttemptMedia(attemptId);
        lastRefreshRef.current = Date.now();
        const merged = mergeMediaUrls(mapRef.current, list.data);
        mapRef.current = merged;
        setMap(merged);
      } catch {
        // Mất mạng / API khởi động lại → thử lại sau (effect hẹn giờ theo retryTick)
        window.setTimeout(() => setRetryTick((n) => n + 1), RETRY_MS);
      } finally {
        inflightRef.current = null;
      }
    })();
    inflightRef.current = p;
    return p;
  }, [attemptId]);

  React.useEffect(() => {
    if (!enabled) return;
    const delay = refreshDelay(map, Date.now(), lastRefreshRef.current);
    if (delay === null) return;
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [enabled, map, refresh, retryTick]);

  React.useEffect(() => {
    if (!enabled) return;
    // Hẹn giờ ở tab nền bị trình duyệt giãn – khi quay lại/có mạng lại kiểm tra ngay
    const check = () => {
      const at = nextRefreshAt(mapRef.current);
      if (document.visibilityState === 'visible' && at !== null && at <= Date.now()) void refresh();
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('online', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('online', check);
    };
  }, [enabled, refresh]);

  const resolve = React.useCallback((assetId: string | null | undefined, fallback: string) => resolveMediaUrl(map, assetId, fallback), [map]);
  const resolveLatest = React.useCallback((assetId: string | null | undefined, fallback: string) => resolveMediaUrl(mapRef.current, assetId, fallback), []);
  const stale = React.useCallback((assetId: string | null | undefined) => !!assetId && isStale(map.get(assetId), Date.now()), [map]);
  return React.useMemo(() => ({ resolve, resolveLatest, refresh, isStale: stale }), [refresh, resolve, resolveLatest, stale]);
}
