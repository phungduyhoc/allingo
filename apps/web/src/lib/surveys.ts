/**
 * Khảo sát in-app (S12): `GET /me/surveys/pending` trả `beta_onboarding` (tester chưa làm khảo sát 5 câu) và NPS `nps_d7`
 * (hiển thị ngày 7–13 kể từ lúc đổi mã) / `nps_d14` (ngày 14–27) – SERVER quyết định khi nào đến hạn (A198). Web chỉ:
 *  - không hiện khi đang thi (Exam Mode – có attempt exam `in_progress`) hoặc trong màn làm bài;
 *  - "Để sau" → ẩn NPS đó 24 giờ (localStorage, bọc try/catch – lỗi lưu trữ thì chỉ ẩn trong phiên);
 *  - gửi xong → ẩn ngay (server không còn trả trong danh sách).
 */

export type SurveyKind = 'beta_onboarding' | 'nps_d7' | 'nps_d14';
export interface PendingSurvey {
  kind: SurveyKind;
  due_at: string;
  expires_at: string | null;
}

export const NPS_SNOOZE_MS = 24 * 3_600_000;
const SNOOZE_KEY = 'allingo.nps-snooze.v1';

const isNps = (k: SurveyKind): k is 'nps_d7' | 'nps_d14' => k === 'nps_d7' || k === 'nps_d14';

/** NPS đang trong khung hiển thị (due ≤ now < expires) – ưu tiên mốc muộn hơn (d14) khi trùng */
export function activeNps(pending: readonly PendingSurvey[] | null | undefined, now = Date.now()): (PendingSurvey & { kind: 'nps_d7' | 'nps_d14' }) | null {
  const list = (pending ?? []).filter((p): p is PendingSurvey & { kind: 'nps_d7' | 'nps_d14' } => isNps(p.kind) && Date.parse(p.due_at) <= now && (!p.expires_at || Date.parse(p.expires_at) > now));
  const rank = { nps_d14: 0, nps_d7: 1 } as const;
  list.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return list[0] ?? null;
}

export function npsToShow(input: {
  pending: readonly PendingSurvey[] | null | undefined;
  examLocked: boolean;
  snoozedUntil: Partial<Record<string, number>>;
  dismissed?: ReadonlySet<string>;
  now?: number;
}): (PendingSurvey & { kind: 'nps_d7' | 'nps_d14' }) | null {
  if (input.examLocked) return null;
  const now = input.now ?? Date.now();
  const nps = activeNps(input.pending, now);
  if (!nps) return null;
  if (input.dismissed?.has(nps.kind)) return null;
  const until = input.snoozedUntil[nps.kind];
  if (until && until > now) return null;
  return nps;
}

export function betaOnboardingPending(pending: readonly PendingSurvey[] | null | undefined): boolean {
  return (pending ?? []).some((p) => p.kind === 'beta_onboarding');
}

/** Nhóm NPS chuẩn: 0–6 chê, 7–8 trung lập, 9–10 giới thiệu */
export function npsBucket(score: number): 'detractor' | 'passive' | 'promoter' {
  return score >= 9 ? 'promoter' : score >= 7 ? 'passive' : 'detractor';
}

export function readNpsSnoozes(): Partial<Record<string, number>> {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== 'object') return {};
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'number')) as Record<string, number>;
  } catch {
    return {};
  }
}

export function snoozeNps(kind: string, now = Date.now()): Partial<Record<string, number>> {
  const next = { ...readNpsSnoozes(), [kind]: now + NPS_SNOOZE_MS };
  try {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage bị chặn – chỉ ẩn trong phiên (state của component) */
  }
  return next;
}
