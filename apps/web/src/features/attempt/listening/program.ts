import { asPublicContent, type QuestionPublic } from '@/lib/types';
import type { QuestionGroup } from '../attempt-state';

/**
 * "Chương trình phát" Listening ở Exam Mode (`listen_policy = 'once'`): danh sách bước phát liên tục theo thứ tự đề.
 * - Part 1/2 (câu đơn): audio câu → chờ `pause_ms` → câu kế.
 * - Part 3/4 (nhóm `audio_script`): audio nhóm (hội thoại/bài nói) → lần lượt audio câu hỏi (người dẫn đọc) + `pause_ms` mỗi câu.
 * Logic thuần (không DOM) để kiểm thử bằng Vitest; phần phát thật ở `use-exam-listening.ts`.
 */

/** Thời gian trả lời mặc định khi nội dung không ghi `pause_ms` (TOEIC: ~5 s Part 1–2, ~8 s Part 3–4) */
export const DEFAULT_PAUSE_MS: Readonly<Record<string, number>> = { part1: 5000, part2: 5000, part3: 8000, part4: 8000 };
export const FALLBACK_PAUSE_MS = 5000;

interface StepBase {
  /** Câu được đặt làm "câu đang nghe" ở bước này (chỉ số trong danh sách câu đã sắp xếp) */
  questionIndex: number;
  /** Khoảng câu của nhóm (câu đơn: start = end = questionIndex) – dùng để biết người học còn "theo" audio không */
  groupStart: number;
  groupEnd: number;
}

export interface AudioStep extends StepBase {
  kind: 'audio';
  role: 'group' | 'question';
  /** URL ban đầu (có thể hết hạn – phát bằng URL đã gia hạn theo `assetId`) */
  url: string;
  assetId: string | null;
  durationMs: number | null;
  /** question_id gửi kèm sự kiện audio_* (audio nhóm → câu đầu nhóm, như hợp đồng `audio_plays`) */
  eventQuestionId: string;
}

export interface PauseStep extends StepBase {
  kind: 'pause';
  ms: number;
}

export type ListeningStep = AudioStep | PauseStep;

export interface ListeningProgram {
  steps: ListeningStep[];
  /** Câu → bước đầu tiên "mở" câu (từ bước này người học chọn được đáp án) */
  unlockStep: ReadonlyMap<number, number>;
  /** Câu đầu/cuối thuộc chương trình (-1 khi rỗng) */
  firstIndex: number;
  lastIndex: number;
  /** Câu đầu tiên sau phần nghe (Reading của đề L&R) – null nếu không có */
  nextIndex: number | null;
}

export interface ListeningCursor {
  step: number;
  /** ms đã phát/đã chờ của bước hiện tại (khôi phục giữa chừng – không phát lại đoạn đã nghe) */
  offsetMs: number;
}

const audioOf = (q: QuestionPublic) => q.media.find((m) => m.kind === 'audio') ?? null;
const isAudioScript = (q: QuestionPublic) => q.passage?.kind === 'audio_script' && !!q.passage.media_url;

/** Câu Listening phát một lần: `content.media.listen_policy = 'once'` và có audio (của câu hoặc của nhóm) */
export function isListenOnce(q: QuestionPublic): boolean {
  const c = asPublicContent(q.content);
  const media = c && 'media' in c ? c.media : undefined;
  return media?.listen_policy === 'once' && (!!audioOf(q) || isAudioScript(q));
}

export function pauseMsOf(q: QuestionPublic): number {
  const c = asPublicContent(q.content);
  const ms = c && 'media' in c ? c.media?.pause_ms : undefined;
  return typeof ms === 'number' && ms >= 0 ? ms : (DEFAULT_PAUSE_MS[q.section_code] ?? FALLBACK_PAUSE_MS);
}

export function buildListeningProgram(questions: readonly QuestionPublic[], groups: readonly QuestionGroup[]): ListeningProgram {
  const steps: ListeningStep[] = [];
  const unlockStep = new Map<number, number>();
  const groupAt = (i: number) => groups.find((g) => i >= g.start && i <= g.end) ?? { key: `single:${i}`, start: i, end: i };
  const playedGroups = new Set<string>();
  let firstIndex = -1;
  let lastIndex = -1;

  questions.forEach((q, i) => {
    if (!isListenOnce(q)) return;
    if (firstIndex < 0) firstIndex = i;
    lastIndex = i;
    const g = groupAt(i);
    const range = { groupStart: g.start, groupEnd: g.end };
    if (isAudioScript(q) && !playedGroups.has(g.key)) {
      playedGroups.add(g.key);
      const p = q.passage!;
      steps.push({ kind: 'audio', role: 'group', url: p.media_url!, assetId: p.media_asset_id ?? null, durationMs: null, questionIndex: g.start, eventQuestionId: questions[g.start]!.question_id, ...range });
      // Cả nhóm mở từ lúc hội thoại bắt đầu (đọc trước câu hỏi, chọn đáp án khi đang nghe)
      for (let k = g.start; k <= g.end; k++) if (isListenOnce(questions[k]!)) unlockStep.set(k, steps.length - 1);
    }
    const audio = audioOf(q);
    if (audio) {
      steps.push({ kind: 'audio', role: 'question', url: audio.url, assetId: audio.id, durationMs: audio.duration_ms, questionIndex: i, eventQuestionId: q.question_id, ...range });
    }
    if (!unlockStep.has(i)) unlockStep.set(i, steps.length - (audio ? 1 : 0));
    steps.push({ kind: 'pause', ms: pauseMsOf(q), questionIndex: i, ...range });
  });

  let nextIndex: number | null = null;
  if (lastIndex >= 0) {
    for (let i = lastIndex + 1; i < questions.length; i++) {
      if (!unlockStep.has(i)) {
        nextIndex = i;
        break;
      }
    }
  }
  return { steps, unlockStep, firstIndex, lastIndex, nextIndex };
}

/** Các bước audio sắp phát (tính cả bước hiện tại nếu là audio) – để preload 2–3 tệp trước */
export function upcomingAudioSteps(program: ListeningProgram, fromStep: number, count: number): number[] {
  const out: number[] = [];
  for (let s = Math.max(0, fromStep); s < program.steps.length && out.length < count; s++) if (program.steps[s]!.kind === 'audio') out.push(s);
  return out;
}

/**
 * Câu chọn được đáp án: ngoài chương trình (Reading), đã nghe xong toàn bộ, hoặc audio của câu/nhóm đã bắt đầu
 * (`reachedStep` = bước cao nhất đã bắt đầu phát).
 */
export function isAnswerable(program: ListeningProgram, questionIndex: number, reachedStep: number): boolean {
  const unlock = program.unlockStep.get(questionIndex);
  if (unlock === undefined || reachedStep >= program.steps.length) return true;
  return unlock <= reachedStep;
}

/** Câu "đang nghe" ứng với bước (đã xong → câu đầu Reading hoặc câu cuối Listening) */
export function focusIndexAt(program: ListeningProgram, step: number): number | null {
  const s = program.steps[step];
  if (s) return s.questionIndex;
  return program.nextIndex ?? (program.lastIndex >= 0 ? program.lastIndex : null);
}

// ----------------------------------------------------------------------------- Khôi phục vị trí

const CURSOR_VERSION = 1;

/** Lưu vị trí (localStorage) kèm số bước để bỏ qua bản lưu không khớp chương trình (đề đổi) */
export function serializeCursor(cursor: ListeningCursor, stepsLength: number): string {
  return JSON.stringify({ v: CURSOR_VERSION, step: cursor.step, offset_ms: Math.max(0, Math.round(cursor.offsetMs)), n: stepsLength });
}

export function parseStoredCursor(raw: string | null | undefined, stepsLength: number): ListeningCursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { v?: unknown; step?: unknown; offset_ms?: unknown; n?: unknown };
    if (v.v !== CURSOR_VERSION || v.n !== stepsLength || typeof v.step !== 'number' || !Number.isInteger(v.step)) return null;
    const step = Math.max(0, Math.min(stepsLength, v.step));
    const offsetMs = typeof v.offset_ms === 'number' && v.offset_ms > 0 && step < stepsLength ? v.offset_ms : 0;
    return { step, offsetMs };
  } catch {
    return null;
  }
}

/**
 * Vị trí chuỗi phát đã lưu lên server (`attempt.ui_state.listening = { step, offset_ms }` – v1.1 S5, gửi kèm PUT /answers).
 * Sai dạng/ngoài phạm vi → null; bước ≥ số bước (đã nghe xong) → `stepsLength`, offset 0.
 */
export function parseServerCursor(raw: unknown, stepsLength: number): ListeningCursor | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as { step?: unknown; offset_ms?: unknown };
  if (typeof v.step !== 'number' || !Number.isInteger(v.step) || v.step < 0) return null;
  const step = Math.min(stepsLength, v.step);
  const offsetMs = step < stepsLength && typeof v.offset_ms === 'number' && Number.isFinite(v.offset_ms) && v.offset_ms > 0 ? v.offset_ms : 0;
  return { step, offsetMs };
}

/** Cursor dạng gửi lên server (`ui_state.listening`): số nguyên không âm */
export function toServerCursor(c: ListeningCursor): { step: number; offset_ms: number } {
  return { step: Math.max(0, Math.trunc(c.step)), offset_ms: Math.max(0, Math.round(c.offsetMs)) };
}

/**
 * Chọn bản MỚI HƠN giữa bản cục bộ (localStorage – lớp nhanh, lưu mỗi giây) và bản server (ui_state – theo nhịp lưu nháp).
 * Chuỗi phát chỉ đi tới nên "mới hơn" = xa hơn (bước lớn hơn, cùng bước thì offset lớn hơn); thiếu một bên → bên còn lại.
 */
export function newerCursor(a: ListeningCursor | null, b: ListeningCursor | null): ListeningCursor | null {
  if (!a) return b;
  if (!b) return a;
  if (a.step !== b.step) return a.step > b.step ? a : b;
  return a.offsetMs >= b.offsetMs ? a : b;
}

/**
 * Vị trí theo server: `attempt.audio_plays[question_id]` (số lần audio_started). Đi theo thứ tự bước audio, "tiêu" một lượt
 * cho mỗi bước đã bắt đầu; vị trí tiếp theo = sau bước audio cuối cùng đã bắt đầu (không phát lại đoạn đã nghe; phần còn lại
 * của bước bị gián đoạn bỏ qua vì server không biết vị trí).
 */
export function cursorFromAudioPlays(program: ListeningProgram, audioPlays: Readonly<Record<string, number>> | undefined): ListeningCursor {
  if (!audioPlays) return { step: 0, offsetMs: 0 };
  const left: Record<string, number> = { ...audioPlays };
  let last = -1;
  for (let s = 0; s < program.steps.length; s++) {
    const step = program.steps[s]!;
    if (step.kind !== 'audio') continue;
    const n = left[step.eventQuestionId] ?? 0;
    if (n <= 0) break;
    left[step.eventQuestionId] = n - 1;
    last = s;
  }
  return { step: last + 1, offsetMs: 0 };
}

/**
 * Vị trí khôi phục: bản cục bộ (chính xác tới ms, kể cả giữa một audio) trừ khi server cho thấy đã nghe xa hơn
 * (thiết bị khác / xoá dữ liệu trình duyệt). Bản cục bộ đang ở chính bước audio cuối server đã ghi nhận vẫn được dùng.
 */
export function resumeCursor(program: ListeningProgram, local: ListeningCursor | null, audioPlays?: Readonly<Record<string, number>>): ListeningCursor {
  const server = cursorFromAudioPlays(program, audioPlays);
  if (local && local.step >= server.step - 1) return local;
  return server;
}
