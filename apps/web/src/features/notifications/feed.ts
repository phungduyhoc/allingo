import type { NotificationItem } from '@allingo/schemas/api/billing';

/**
 * Trạng thái hộp thông báo in-app (S8) – reducer thuần, có test. Lưu trong cache TanStack Query (khoá growthKeys.notifications)
 * để chuông ở header và trang /notifications dùng chung; Socket.IO `notification.new` → `received` (không tải lại).
 */

export interface NotificationFeed {
  items: NotificationItem[];
  unread: number;
  next_cursor: string | null;
}

export type FeedAction =
  | { type: 'loaded'; page: { data: NotificationItem[]; next_cursor: string | null; unread_count: number } }
  | { type: 'appended'; page: { data: NotificationItem[]; next_cursor: string | null; unread_count?: number } }
  | { type: 'received'; item: NotificationItem }
  | { type: 'read'; id: string; at: string }
  | { type: 'readAll'; at: string; unread_count?: number };

export const EMPTY_FEED: NotificationFeed = { items: [], unread: 0, next_cursor: null };

/** Chỉ hiển thị thông báo kênh in-app (API có thể trả hàng của kênh khác cho cùng mẫu) */
export const isInapp = (n: NotificationItem) => !n.channel || n.channel === 'inapp';

const byNewest = (a: NotificationItem, b: NotificationItem) => (b.sent_at ?? b.scheduled_at).localeCompare(a.sent_at ?? a.scheduled_at);

export function feedReducer(state: NotificationFeed, action: FeedAction): NotificationFeed {
  switch (action.type) {
    case 'loaded':
      return { items: action.page.data.filter(isInapp), unread: Math.max(0, action.page.unread_count), next_cursor: action.page.next_cursor };
    case 'appended': {
      const seen = new Set(state.items.map((n) => n.id));
      const more = action.page.data.filter((n) => isInapp(n) && !seen.has(n.id));
      return { items: [...state.items, ...more], unread: action.page.unread_count ?? state.unread, next_cursor: action.page.next_cursor };
    }
    case 'received': {
      if (!isInapp(action.item)) return state;
      const existing = state.items.find((n) => n.id === action.item.id);
      if (existing) {
        // Đã có (vd. tải trang xong rồi mới nhận sự kiện) → cập nhật nội dung, không đếm lại
        return { ...state, items: state.items.map((n) => (n.id === action.item.id ? { ...action.item, read_at: n.read_at ?? action.item.read_at } : n)) };
      }
      const items = [action.item, ...state.items].sort(byNewest);
      return { ...state, items, unread: state.unread + (action.item.read_at ? 0 : 1) };
    }
    case 'read': {
      let changed = false;
      const items = state.items.map((n) => {
        if (n.id !== action.id || n.read_at) return n;
        changed = true;
        return { ...n, read_at: action.at };
      });
      return changed ? { ...state, items, unread: Math.max(0, state.unread - 1) } : state;
    }
    case 'readAll':
      return { ...state, items: state.items.map((n) => (n.read_at ? n : { ...n, read_at: action.at })), unread: Math.max(0, action.unread_count ?? 0) };
    default:
      return state;
  }
}

/** Chuỗi hiển thị trên huy hiệu chuông (99+) */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}
