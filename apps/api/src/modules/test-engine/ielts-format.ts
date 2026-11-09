import { IELTS_CBT } from '@allingo/schemas';

/**
 * C3 – định dạng thi IELTS Reading/Listening trên máy tính (hàm thuần, không I/O):
 * - đồng hồ theo kỹ năng (Listening → Reading…) khi làm đề đầy đủ ở Exam Mode;
 * - cửa sổ "nghe một lần" của audio từng part (server chỉ cấp lại URL trong cửa sổ);
 * - khớp trích đoạn đáp án (`evidence`) với segment transcript để tô và tua tới mốc thời gian ở Review.
 */

/** Dung sai sau khi audio phát hết (mạng chậm, buffer) trước khi coi là đã nghe xong – không cấp lại URL nữa */
export const LISTEN_SLACK_MS = 60_000;

export interface FormatSection {
  code: string;
  skill: string;
  /** test_set_sections.duration_sec ?? catalog.sections.duration_sec */
  duration_sec: number | null;
  rules: Record<string, unknown>;
}

export interface SkillPlan {
  skill: string;
  sections: string[];
  duration_sec: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/** Thời gian đọc trước mỗi part Listening và thời gian xem lại cuối bài – từ rules của section (seed core) hoặc hằng IELTS_CBT */
export function listeningTimings(sections: readonly FormatSection[]): { preread_sec: number; review_sec: number } {
  const listening = sections.filter((s) => s.skill === 'listening');
  const preread = listening.map((s) => num(s.rules.preread_sec)).find((x) => x !== null);
  const review = [...listening].reverse().map((s) => num(s.rules.review_sec)).find((x) => x !== null);
  return { preread_sec: preread ?? IELTS_CBT.preread_sec, review_sec: review ?? IELTS_CBT.review_sec };
}

/**
 * Kế hoạch thời gian theo kỹ năng, theo thứ tự xuất hiện trong đề. Listening = Σ (đọc trước + thời lượng audio part) + xem lại khi
 * biết thời lượng mọi part, ngược lại Σ thời lượng section + xem lại; kỹ năng khác = Σ thời lượng section (Reading đủ 3 passage:
 * 3 × 20′ = 60′).
 */
export function skillPlan(sections: readonly FormatSection[], partAudioMs: ReadonlyMap<string, number | null>): SkillPlan[] {
  const { preread_sec, review_sec } = listeningTimings(sections);
  const order: string[] = [];
  const bySkill = new Map<string, FormatSection[]>();
  for (const s of sections) {
    if (!bySkill.has(s.skill)) {
      bySkill.set(s.skill, []);
      order.push(s.skill);
    }
    bySkill.get(s.skill)!.push(s);
  }
  return order.map((skill) => {
    const secs = bySkill.get(skill)!;
    let duration: number;
    if (skill === 'listening') {
      const audio = secs.map((s) => partAudioMs.get(s.code) ?? null);
      duration = audio.every((ms) => ms !== null)
        ? secs.length * preread_sec + audio.reduce<number>((t, ms) => t + Math.ceil((ms ?? 0) / 1000), 0) + review_sec
        : secs.reduce((t, s) => t + (s.duration_sec ?? 0), 0) + review_sec;
    } else {
      duration = secs.reduce((t, s) => t + (s.duration_sec ?? 0), 0);
      if (skill === 'reading' && duration === 0) duration = IELTS_CBT.reading_duration_sec;
    }
    return { skill, sections: secs.map((s) => s.code), duration_sec: duration };
  });
}

export interface SkillWindow {
  skill: string;
  sections: string[];
  start: Date;
  end: Date;
}

/**
 * Cửa sổ thời gian từng kỹ năng: kỹ năng đầu bắt đầu cùng attempt; kỹ năng sau bắt đầu ở thời điểm người học chuyển sang (ghi trong
 * `skill_started_at`) hoặc muộn nhất khi kỹ năng trước hết giờ. Chuyển sớm → kỹ năng trước khoá (như thi máy tính: nộp phần nghe).
 */
export function skillWindows(plan: readonly SkillPlan[], attemptStart: Date, skillStarted: Readonly<Record<string, string>>): SkillWindow[] {
  const out: SkillWindow[] = [];
  let prevEnd = attemptStart.getTime();
  plan.forEach((p, i) => {
    const recorded = skillStarted[p.skill] ? Date.parse(skillStarted[p.skill]!) : Number.NaN;
    const start = i === 0 ? attemptStart.getTime() : Number.isFinite(recorded) ? Math.min(recorded, prevEnd) : prevEnd;
    const end = start + p.duration_sec * 1000;
    out.push({ skill: p.skill, sections: p.sections, start: new Date(start), end: new Date(end) });
    prevEnd = end;
  });
  return out;
}

/** Kỹ năng đã khoá: quá hạn (cộng thời gian ân hạn) hoặc kỹ năng sau đã bắt đầu */
export function lockedSkills(windows: readonly SkillWindow[], now: number, graceSec: number): Set<string> {
  const locked = new Set<string>();
  windows.forEach((w, i) => {
    const next = windows[i + 1];
    if (now > w.end.getTime() + graceSec * 1000 || (next && next.start.getTime() <= now)) locked.add(w.skill);
  });
  return locked;
}

/** Tổng thời lượng đề (giây) khi chưa chuyển kỹ năng sớm – hạn chung `expires_at` của attempt */
export const planTotalSec = (plan: readonly SkillPlan[]): number => plan.reduce((t, p) => t + p.duration_sec, 0);

/**
 * Audio đã hết cửa sổ phát (Exam Mode): bắt đầu lúc `startedAt`, cửa sổ = thời lượng + LISTEN_SLACK_MS (thời lượng chưa biết →
 * `fallbackMs`). Chưa bắt đầu → còn mở.
 */
export function listenWindowClosed(startedAt: string | undefined, durationMs: number | null, now: number, fallbackMs: number): boolean {
  if (!startedAt) return false;
  const t = Date.parse(startedAt);
  if (!Number.isFinite(t)) return false;
  return now > t + (durationMs ?? fallbackMs) + LISTEN_SLACK_MS;
}

const norm = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim();

/** Đoạn ngắn hơn ngưỡng này không dùng để khớp ngược (segment nằm trong evidence) – tránh khớp "yes", "okay" */
const MIN_REVERSE_MATCH = 12;

/**
 * Chỉ số segment transcript chứa trích đoạn đáp án. `evidence` có thể gồm nhiều đoạn (mỗi dòng hoặc ngăn bằng `|` – câu nhiều mục):
 * khớp khi segment chứa đoạn đó hoặc đoạn đó chứa trọn segment (≥ 12 ký tự); không phân biệt hoa thường/khoảng trắng/dấu câu.
 */
export function evidenceSegments(evidence: string | null | undefined, segments: ReadonlyArray<{ text: string }> | undefined): number[] {
  if (!evidence || !segments?.length) return [];
  const pieces = evidence
    .split(/\n|\|/)
    .map(norm)
    .filter((p) => p.length > 0);
  if (!pieces.length) return [];
  const hits = new Set<number>();
  segments.forEach((seg, i) => {
    const t = norm(seg.text);
    if (!t) return;
    if (pieces.some((p) => t.includes(p) || (t.length >= MIN_REVERSE_MATCH && p.includes(t)))) hits.add(i);
  });
  return [...hits].sort((a, b) => a - b);
}
