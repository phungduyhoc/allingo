import type { QuestionPublic } from '@/lib/types';

/**
 * URL ký của media (TTL 10′ – đề L&R 120′ dài hơn nhiều). Logic thuần: gom URL từ câu hỏi, gộp kết quả
 * `GET /attempts/{id}/media`, tính thời điểm gia hạn (còn ≤ 2′). Hook React ở `use-media-urls.ts`.
 */

export interface MediaUrlEntry {
  url: string;
  /** epoch ms; null = URL không hết hạn */
  expiresAt: number | null;
}

export type MediaUrlMap = ReadonlyMap<string, MediaUrlEntry>;

/** Gia hạn khi còn ≤ 2 phút (khuyến nghị của hợp đồng API) */
export const REFRESH_BEFORE_MS = 120_000;
/** Không gọi dồn: tối thiểu 5 s giữa hai lần hẹn gia hạn */
export const MIN_REFRESH_DELAY_MS = 5_000;

const toEpoch = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** URL ban đầu theo asset id: `media[].id` của câu + `passage.media_asset_id` */
export function collectMediaUrls(questions: readonly Pick<QuestionPublic, 'media' | 'passage'>[]): Map<string, MediaUrlEntry> {
  const out = new Map<string, MediaUrlEntry>();
  const put = (id: string, url: string, expiresAt: number | null) => {
    const prev = out.get(id);
    // Cùng asset xuất hiện ở nhiều câu (passage nhóm) → giữ URL hạn xa nhất (null = không hết hạn)
    if (!prev || (expiresAt ?? Infinity) > (prev.expiresAt ?? Infinity)) out.set(id, { url, expiresAt });
  };
  for (const q of questions) {
    for (const m of q.media) put(m.id, m.url, toEpoch((m as { expires_at?: string | null }).expires_at));
    const p = q.passage;
    if (p?.media_asset_id && p.media_url) put(p.media_asset_id, p.media_url, toEpoch(p.media_expires_at));
  }
  return out;
}

/** Gộp danh sách mới (GET /attempts/{id}/media hoặc attempt tải lại); chỉ thay khi URL mới hạn xa hơn hoặc không hết hạn */
export function mergeMediaUrls(map: MediaUrlMap, items: readonly { id: string; url: string; expires_at: string | null }[]): Map<string, MediaUrlEntry> {
  const out = new Map(map);
  for (const it of items) {
    const expiresAt = toEpoch(it.expires_at);
    const prev = out.get(it.id);
    if (!prev || expiresAt === null || prev.expiresAt === null || expiresAt >= prev.expiresAt) out.set(it.id, { url: it.url, expiresAt });
  }
  return out;
}

/** Ngưỡng thay URL khi attempt/review được tải lại: chỉ thay khi URL mới hạn xa hơn rõ rệt (tránh đổi src liên tục) */
export const REPLACE_ON_REFETCH_MS = 5 * 60_000;

/**
 * Gộp URL từ attempt/review vừa tải lại (practice tải lại attempt sau mỗi câu): thêm asset mới; asset đã có chỉ thay khi
 * URL mới hạn xa hơn ≥ 5′ (bản cũ sắp hết hạn) – không đổi `src` của audio đang nghe mỗi lần tải lại. Không đổi → trả `a`.
 */
export function mergeMediaMaps(a: MediaUrlMap, b: MediaUrlMap): MediaUrlMap {
  let out: Map<string, MediaUrlEntry> | null = null;
  for (const [id, e] of b) {
    const prev = a.get(id);
    const newer = prev && (e.expiresAt ?? Infinity) - (prev.expiresAt ?? Infinity) >= REPLACE_ON_REFETCH_MS;
    if (!prev || newer) (out ??= new Map(a)).set(id, e);
  }
  return out ?? a;
}

export function isStale(entry: MediaUrlEntry | undefined, now: number, before = REFRESH_BEFORE_MS): boolean {
  return !!entry && entry.expiresAt !== null && entry.expiresAt - before <= now;
}

/** Thời điểm (epoch ms) cần gia hạn: hạn sớm nhất − 2′; null khi không URL nào hết hạn */
export function nextRefreshAt(map: MediaUrlMap, before = REFRESH_BEFORE_MS): number | null {
  let min: number | null = null;
  for (const e of map.values()) if (e.expiresAt !== null && (min === null || e.expiresAt < min)) min = e.expiresAt;
  return min === null ? null : min - before;
}

/** Độ trễ hẹn giờ gia hạn (ms) tính từ `now`; đã tới hạn → MIN_REFRESH_DELAY_MS nếu vừa gọi, 0 nếu chưa */
export function refreshDelay(map: MediaUrlMap, now: number, lastRefreshAt: number | null, before = REFRESH_BEFORE_MS): number | null {
  const at = nextRefreshAt(map, before);
  if (at === null) return null;
  const delay = Math.max(0, at - now);
  if (lastRefreshAt !== null && now - lastRefreshAt < MIN_REFRESH_DELAY_MS) return Math.max(delay, MIN_REFRESH_DELAY_MS - (now - lastRefreshAt));
  return delay;
}

export function resolveMediaUrl(map: MediaUrlMap, assetId: string | null | undefined, fallback: string): string {
  return (assetId ? map.get(assetId)?.url : undefined) ?? fallback;
}
