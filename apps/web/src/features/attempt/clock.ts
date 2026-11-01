/**
 * Đồng hồ Exam Mode: tính thời gian còn lại từ `expires_at` của server, hiệu chỉnh lệch giờ
 * giữa client và server bằng `server_time` trả về cùng response (không tin đồng hồ máy khách).
 */

/** offset = serverNow − clientNow (ms). Dương nếu đồng hồ client chậm hơn server. */
export function computeClockOffset(serverTimeIso: string, clientNowMs: number = Date.now()): number {
  const server = Date.parse(serverTimeIso);
  if (Number.isNaN(server)) return 0;
  return server - clientNowMs;
}

/** Thời gian còn lại (ms, không âm); null khi không giới hạn giờ */
export function remainingMs(expiresAtIso: string | null | undefined, offsetMs: number, clientNowMs: number = Date.now()): number | null {
  if (!expiresAtIso) return null;
  const expires = Date.parse(expiresAtIso);
  if (Number.isNaN(expires)) return null;
  const serverNow = clientNowMs + offsetMs;
  return Math.max(0, expires - serverNow);
}

/** mm:ss, hoặc h:mm:ss khi ≥ 1 giờ */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export type ClockTone = 'normal' | 'warning' | 'danger';

/** Màu đồng hồ: < 1 phút đỏ, < 5 phút vàng */
export function clockTone(ms: number | null): ClockTone {
  if (ms === null) return 'normal';
  if (ms < 60_000) return 'danger';
  if (ms < 5 * 60_000) return 'warning';
  return 'normal';
}

/** Mốc cần thông báo bằng aria-live (phút còn lại) – trả mốc vừa vượt qua, nếu có */
export function crossedAnnouncement(prevMs: number | null, nextMs: number | null, marksMin: readonly number[] = [10, 5, 1]): number | null {
  if (prevMs === null || nextMs === null) return null;
  for (const m of marksMin) {
    const mark = m * 60_000;
    if (prevMs > mark && nextMs <= mark) return m;
  }
  return null;
}
