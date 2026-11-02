import { unwrap } from '@allingo/api-client';
import { env } from '@/env';
import { getApi } from './api';
import { MOCK_REALTIME_EVENT, RealtimeClient, socketUrl, type MockRealtimeDetail, type RealtimeStatus } from './realtime';

/**
 * Điểm kết nối realtime duy nhất của trang (singleton ngoài React): Socket.IO `/ws` của API, hoặc sự kiện window do API giả lập
 * phát khi NEXT_PUBLIC_API_MOCK=1. Component đăng ký bằng `realtimeHub.on(event, fn)`; trạng thái kết nối đọc qua
 * `useSyncExternalStore(realtimeHub.subscribeStatus, realtimeHub.getStatus)` để quyết định có cần polling dự phòng không.
 */

const USE_MOCK = process.env.NEXT_PUBLIC_API_MOCK === '1';
type Listener = (data: unknown) => void;

class RealtimeHub {
  private listeners = new Map<string, Set<Listener>>();
  private statusListeners = new Set<() => void>();
  private status: RealtimeStatus = 'idle';
  private client: RealtimeClient | null = null;
  private offs: (() => void)[] = [];
  private userId: string | null = null;

  getStatus = (): RealtimeStatus => this.status;

  subscribeStatus = (fn: () => void): (() => void) => {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  };

  private setStatus(s: RealtimeStatus): void {
    if (s === this.status) return;
    this.status = s;
    for (const fn of this.statusListeners) fn();
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Phát cục bộ (dùng cho mock và test) */
  emit(event: string, data: unknown): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(data);
      } catch {
        /* bỏ qua lỗi listener */
      }
    }
  }

  /** Kết nối cho người dùng hiện tại (đổi người dùng → kết nối lại) */
  start(userId: string): void {
    if (typeof window === 'undefined' || this.userId === userId) return;
    this.stop();
    this.userId = userId;
    if (USE_MOCK) {
      const onMock = (e: Event) => {
        const d = (e as CustomEvent<MockRealtimeDetail>).detail;
        if (d?.event) this.emit(d.event, d.data);
      };
      window.addEventListener(MOCK_REALTIME_EVENT, onMock);
      this.offs.push(() => window.removeEventListener(MOCK_REALTIME_EVENT, onMock));
      this.setStatus('connected');
      return;
    }
    const client = new RealtimeClient({
      url: socketUrl(env.apiUrl),
      namespace: '/ws',
      // Đi qua API client chung: access token hết hạn → middleware refresh (khử trùng lặp) rồi gọi lại
      refreshSession: async () => {
        try {
          unwrap(await getApi().GET('/me'));
          return true;
        } catch {
          return false;
        }
      },
      onStatus: (s) => this.setStatus(s),
    });
    for (const event of ['order.updated', 'credits.changed', 'entitlements.changed', 'notification.new', 'attempt.graded', 'ai_task.completed']) {
      this.offs.push(client.on(event, (data) => this.emit(event, data)));
    }
    this.client = client;
    client.start();
  }

  stop(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.client?.stop();
    this.client = null;
    this.userId = null;
    this.setStatus('idle');
  }
}

export const realtimeHub = new RealtimeHub();
