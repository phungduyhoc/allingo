import type { ExamFormat } from '@allingo/schemas/api/attempt';
import { numberMarks } from '@allingo/schemas/question/marks';
import { IELTS_CBT, programDef, skillOfSection } from '@allingo/schemas/program/registry';
import type { MockQuestion, MockSegment, MockTestSet } from './fixtures';
import type { MockAttemptRecord } from './state';

/**
 * C3 – phần định dạng thi IELTS của web mock (bám hợp đồng Attempt v1.1 C3 – API thật tính ở AttemptsService):
 * đánh số "Questions 1–40" theo mục, `exam_format` (Listening liên tục theo part, đọc trước/xem lại), đồng hồ theo section (kỹ năng),
 * "nghe một lần" phía server (không cấp lại URL audio part đã nghe xong ở Exam Mode), dòng transcript chứa đáp án.
 */

/** Dung sai sau thời lượng audio trước khi coi là đã nghe xong (mock không biết thời lượng → theo sự kiện audio_ended) */
const PLAY_WINDOW_SLACK_MS = 60_000;

export function mockNumbering(program: string, qs: readonly MockQuestion[]): Map<string, { number_start: number; mark_count: number }> {
  const marking = programDef(program)?.marking ?? 'per_question';
  const nums = numberMarks(qs.map((q) => q.content), marking);
  return new Map(qs.map((q, i) => [q.question_id, nums[i]!]));
}

const isIelts = (a: Pick<MockAttemptRecord, 'program'>) => a.program === 'ielts';

/** Asset audio của part (passage audio_script của câu đầu tiên có audio trong section) */
function partAudio(qs: readonly MockQuestion[], code: string): { assetId: string | null; durationMs: number | null } {
  const q = qs.find((x) => x.section_code === code && x.passage?.kind === 'audio_script' && !!x.passage.media_url);
  const last = q?.passage?.segments?.at(-1);
  return { assetId: q?.passage?.media_asset_id ?? null, durationMs: last ? last.end_ms : null };
}

export function mockExamFormat(a: MockAttemptRecord, ts: MockTestSet | undefined, qs: readonly MockQuestion[]): ExamFormat | null {
  if (!isIelts(a)) return null;
  const codes = [...new Set(qs.map((q) => q.section_code))].filter((c) => skillOfSection('ielts', c) === 'listening');
  const level = ts?.level;
  const hasReading = qs.some((q) => skillOfSection('ielts', q.section_code) === 'reading');
  const exam = a.mode === 'exam';
  return {
    kind: 'ielts_cbt',
    module: hasReading ? (level === 'general_training' ? 'general_training' : 'academic') : null,
    preread_sec: IELTS_CBT.preread_sec,
    review_sec: IELTS_CBT.review_sec,
    listening_parts: codes.map((code) => {
      const { assetId, durationMs } = partAudio(qs, code);
      const started = assetId ? a.events.find((e) => e.type === 'audio_started' && e.meta?.asset_id === assetId) : undefined;
      const ended = assetId ? a.events.some((e) => e.type === 'audio_ended' && e.meta?.asset_id === assetId) : false;
      const windowOver = !!started && durationMs !== null && Date.now() > Date.parse(started.at) + durationMs + PLAY_WINDOW_SLACK_MS;
      return { section_code: code, media_asset_id: assetId, duration_ms: durationMs, started_at: exam && started ? started.at : null, played: exam && (ended || windowOver) };
    }),
  };
}

/**
 * Đồng hồ theo kỹ năng (như API: chỉ Exam Mode + đề `full`; mini/drill một đồng hồ chung): kỹ năng đầu bắt đầu lúc tạo bài, kỹ năng
 * kế bắt đầu khi client gửi `part_switch` (meta.section_code thuộc kỹ năng đó) – kỹ năng trước bị khoá; hạn = bắt đầu + Σ thời lượng
 * section của kỹ năng (kỹ năng cuối / không khai báo thời lượng → `expires_at`). Kỹ năng chưa bắt đầu → `ends_at` null.
 */
export function mockSectionClock(a: MockAttemptRecord, ts: MockTestSet | undefined, qs: readonly MockQuestion[]): Map<string, { skill: string | null; ends_at: string | null; locked: boolean }> {
  const out = new Map<string, { skill: string | null; ends_at: string | null; locked: boolean }>();
  const codes = [...new Set(qs.map((q) => q.section_code))];
  const skillOf = (c: string) => skillOfSection(a.program, c);
  if (!isIelts(a) || a.mode !== 'exam' || !a.expires_at || !ts || ts.kind !== 'full') {
    for (const c of codes) out.set(c, { skill: skillOf(c), ends_at: null, locked: false });
    return out;
  }
  const skills = [...new Set(codes.map(skillOf))];
  const startOf = (skill: string | null, i: number): number | null => {
    if (i === 0) return Date.parse(a.started_at);
    const ev = a.events.find((e) => e.type === 'part_switch' && typeof e.meta?.section_code === 'string' && skillOf(e.meta.section_code) === skill);
    return ev ? Date.parse(ev.at) : null;
  };
  const info = new Map<string | null, { ends: string | null; locked: boolean }>();
  skills.forEach((skill, i) => {
    const start = startOf(skill, i);
    const sec = ts.sections.filter((s) => s.skill === skill).reduce((n, s) => n + (s.duration_sec ?? 0), 0);
    const nextStarted = i < skills.length - 1 && startOf(skills[i + 1]!, i + 1) !== null;
    const ends = start === null ? null : i === skills.length - 1 || !sec ? a.expires_at! : new Date(Math.min(start + sec * 1000, Date.parse(a.expires_at!))).toISOString();
    info.set(skill, { ends, locked: nextStarted || (!!ends && ends !== a.expires_at && Date.now() > Date.parse(ends)) });
  });
  for (const c of codes) {
    const s = info.get(skillOf(c));
    out.set(c, { skill: skillOf(c), ends_at: s?.ends ?? null, locked: s?.locked ?? false });
  }
  return out;
}

/** Asset audio part đã nghe xong ở Exam Mode – /media không cấp lại URL (nghe một lần phía server) */
export function playedAssets(format: ExamFormat | null): Set<string> {
  return new Set((format?.listening_parts ?? []).filter((p) => p.played && p.media_asset_id).map((p) => p.media_asset_id!));
}

/**
 * Chỉ số segment chứa trích đoạn đáp án (so khớp không phân biệt hoa thường, bỏ khoảng trắng thừa). `evidence` có thể gồm nhiều dòng
 * (câu nhiều mục – mỗi mục một trích đoạn, nối bằng xuống dòng) → khớp từng dòng.
 */
export function evidenceSegmentsOf(segments: readonly MockSegment[] | undefined, evidence: string | null | undefined): number[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const needles = (evidence ?? '').split('\n').map(norm).filter((e) => e.length >= 2);
  if (!segments?.length || !needles.length) return [];
  return segments.flatMap((s, i) => {
    const t = norm(s.text);
    return needles.some((e) => t.includes(e) || (e.length > 12 && e.includes(t) && t.length > 8)) ? [i] : [];
  });
}
