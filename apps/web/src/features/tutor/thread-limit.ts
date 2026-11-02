import type { AiStreamError } from '@/lib/ai-stream';
import type { Turns } from './chat-state';

/**
 * Hết lượt của MỘT hội thoại (khác hạn mức ngày `ai_tutor`): 429 `quota_exceeded` với `details.quota.scope = 'thread'`
 * (API: billing.quotas `ai_tutor_thread_turns`) hoặc bộ đếm lượt của thread đã về 0. Hàm thuần (có test).
 */
export function threadLimitOf(
  error: AiStreamError | null,
  turns: Turns | null,
): { reached: boolean; limit: number | null } {
  const raw: unknown = error?.details?.quota;
  const quota = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (error?.code === 'quota_exceeded' && quota?.scope === 'thread') {
    return { reached: true, limit: typeof quota.limit === 'number' ? quota.limit : (turns?.limit ?? null) };
  }
  if (turns && turns.limit !== null) {
    const remaining = turns.remaining ?? Math.max(0, turns.limit - turns.used);
    if (remaining <= 0) return { reached: true, limit: turns.limit };
  }
  return { reached: false, limit: turns?.limit ?? null };
}
