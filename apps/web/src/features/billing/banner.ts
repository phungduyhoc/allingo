import type { Subscription } from '@allingo/schemas';

const EXPIRING_DAYS = 7;
const ENDED_RECENT_MS = 3 * 86_400_000;

export type BannerKind = 'trialing' | 'expiring' | 'trial_ended' | 'expired';

/**
 * Chọn banner gói (thuần, có test): đang dùng thử → "còn N ngày"; gói có hạn còn ≤ 7 ngày và chưa mua kỳ nối tiếp → sắp hết hạn;
 * không còn gói hiệu lực mà gói gần nhất vừa kết thúc ≤ 3 ngày → hết dùng thử (không có đơn nguồn) / hết hạn.
 */
export function pickBanner(subs: readonly Subscription[], now: number): { kind: BannerKind; sub: Subscription } | null {
  const current = subs.filter((s) => s.is_current);
  const trial = current.find((s) => s.status === 'trialing');
  if (trial) return { kind: 'trialing', sub: trial };
  const hasLifetime = current.some((s) => s.status === 'lifetime' || !s.current_period_end);
  if (hasLifetime) return null;
  const expiring = current
    .filter((s) => s.current_period_end && (s.days_left ?? Infinity) <= EXPIRING_DAYS)
    .find((s) => !subs.some((u) => u.upcoming && u.program === s.program && u.id !== s.id));
  if (expiring) return { kind: 'expiring', sub: expiring };
  if (current.length > 0) return null;
  const ended = subs
    .filter((s) => s.current_period_end && Date.parse(s.current_period_end) <= now && now - Date.parse(s.current_period_end) <= ENDED_RECENT_MS)
    .sort((a, b) => Date.parse(b.current_period_end!) - Date.parse(a.current_period_end!))[0];
  if (!ended) return null;
  return { kind: ended.source_order_id ? 'expired' : 'trial_ended', sub: ended };
}
