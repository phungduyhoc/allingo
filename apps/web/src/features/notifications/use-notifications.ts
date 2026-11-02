'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { growthKeys, listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/growth-api';
import { realtimeHub } from '@/lib/realtime-hub';
import { EMPTY_FEED, feedReducer, type FeedAction, type NotificationFeed } from './feed';

/** Trạng thái realtime (connected → không cần polling dự phòng) */
export function useRealtimeStatus() {
  return React.useSyncExternalStore(realtimeHub.subscribeStatus, realtimeHub.getStatus, () => 'idle' as const);
}

/** Hộp thông báo in-app dùng chung chuông + trang /notifications; mất realtime → làm mới mỗi 60 s */
export function useNotificationFeed(enabled = true) {
  const status = useRealtimeStatus();
  return useQuery<NotificationFeed, Error>({
    queryKey: growthKeys.notifications,
    queryFn: async () => feedReducer(EMPTY_FEED, { type: 'loaded', page: await listNotifications({ limit: 20 }) }),
    staleTime: 30_000,
    enabled,
    refetchInterval: status === 'connected' ? false : 60_000,
  });
}

export function useFeedDispatch(): (action: FeedAction) => void {
  const qc = useQueryClient();
  return React.useCallback(
    (action: FeedAction) => qc.setQueryData<NotificationFeed>(growthKeys.notifications, (old) => feedReducer(old ?? EMPTY_FEED, action)),
    [qc],
  );
}

export function useNotificationActions() {
  const qc = useQueryClient();
  const dispatch = useFeedDispatch();
  const markRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id) => dispatch({ type: 'read', id, at: new Date().toISOString() }),
    onError: () => void qc.invalidateQueries({ queryKey: growthKeys.notifications }),
  });
  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: (r) => dispatch({ type: 'readAll', at: new Date().toISOString(), unread_count: r.unread_count }),
  });
  const loadMore = useMutation({
    mutationFn: async (cursor: string) => listNotifications({ cursor, limit: 20 }),
    onSuccess: (page) => dispatch({ type: 'appended', page }),
  });
  return { markRead, markAll, loadMore };
}
