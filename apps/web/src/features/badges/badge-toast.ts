import { type NotificationItem } from '@allingo/schemas/api/billing';
import { pickLocalized, type LocalizedText } from '@allingo/schemas/common';

/**
 * Tên huy hiệu trong thông báo `learning.badge_awarded` (payload `badge_name` {vi,en} hoặc chuỗi; ưu tiên `payload.data`) –
 * dùng cho toast "Huy hiệu mới: …". Không có → null (toast chung).
 */
export function badgeNameOf(item: Pick<NotificationItem, 'payload'>, locale: string): string | null {
  const p: Record<string, unknown> = item.payload ?? {};
  const d = p.data && typeof p.data === 'object' ? (p.data as Record<string, unknown>) : {};
  const raw = d.badge_name ?? p.badge_name;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    const name = pickLocalized(raw as LocalizedText, locale);
    return name ? name : null;
  }
  return null;
}
