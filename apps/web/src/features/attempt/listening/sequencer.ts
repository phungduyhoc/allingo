/**
 * Máy trạng thái chuỗi phát Listening (Exam Mode). Thuần – hook `use-exam-listening` nối với <audio> và hẹn giờ.
 *
 *   gate ──start──▶ loading ──playing──▶ playing ──ended──▶ (bước kế: loading | pause | done)
 *                    ▲  │ stalled          │ stalled
 *                    │  ▼                  ▼
 *                    └─ stalled ◀──────────┘ (playing → playing)
 *   pause ──pauseElapsed──▶ bước kế
 *   loading/playing/stalled ──blocked (trình duyệt chặn autoplay)──▶ gate (giữ bước + vị trí)
 *
 * Không có hành động tạm dừng/tua/lùi bước: mọi chuyển trạng thái chỉ đi tới. Hành động mang `step` – sự kiện trễ của
 * phần tử audio cũ (bước trước) bị bỏ qua.
 */

export type SeqPhase = 'gate' | 'loading' | 'playing' | 'stalled' | 'pause' | 'done';
export type StepKind = 'audio' | 'pause';

export interface SeqState {
  kinds: readonly StepKind[];
  phase: SeqPhase;
  step: number;
  /** Vị trí bắt đầu (ms) của bước hiện tại khi (re)start – khôi phục sau tải lại / bị chặn autoplay */
  offsetMs: number;
}

export type SeqAction =
  | { type: 'start' }
  | { type: 'blocked'; offsetMs: number }
  | { type: 'playing'; step: number }
  | { type: 'stalled'; step: number }
  | { type: 'ended'; step: number }
  | { type: 'pauseElapsed'; step: number }
  /** Audio hỏng hẳn (thử lại nhiều lần với URL mới vẫn lỗi) → bỏ qua để không kẹt cả bài */
  | { type: 'skip'; step: number };

const AUDIO_PHASES: ReadonlySet<SeqPhase> = new Set(['loading', 'playing', 'stalled']);

function phaseAt(kinds: readonly StepKind[], step: number): SeqPhase {
  if (step >= kinds.length) return 'done';
  return kinds[step] === 'audio' ? 'loading' : 'pause';
}

export function initSequencer(kinds: readonly StepKind[], cursor: { step: number; offsetMs: number }): SeqState {
  const step = Math.max(0, Math.min(kinds.length, cursor.step));
  return { kinds, step, offsetMs: step < kinds.length ? Math.max(0, cursor.offsetMs) : 0, phase: step >= kinds.length ? 'done' : 'gate' };
}

const advance = (s: SeqState): SeqState => {
  const step = s.step + 1;
  return { ...s, step, offsetMs: 0, phase: phaseAt(s.kinds, step) };
};

export function sequencerReducer(state: SeqState, action: SeqAction): SeqState {
  switch (action.type) {
    case 'start':
      return state.phase === 'gate' ? { ...state, phase: phaseAt(state.kinds, state.step) } : state;
    case 'blocked':
      return AUDIO_PHASES.has(state.phase) ? { ...state, phase: 'gate', offsetMs: Math.max(0, action.offsetMs) } : state;
    case 'playing':
      return action.step === state.step && (state.phase === 'loading' || state.phase === 'stalled') ? { ...state, phase: 'playing' } : state;
    case 'stalled':
      return action.step === state.step && (state.phase === 'loading' || state.phase === 'playing') ? { ...state, phase: 'stalled' } : state;
    case 'ended':
    case 'skip':
      return action.step === state.step && AUDIO_PHASES.has(state.phase) ? advance(state) : state;
    case 'pauseElapsed':
      return action.step === state.step && state.phase === 'pause' ? advance(state) : state;
  }
}

/** Bước cao nhất đã bắt đầu (câu của bước này trở về trước chọn được đáp án) */
export function reachedStep(state: SeqState): number {
  if (state.phase === 'done') return state.kinds.length;
  if (state.phase === 'gate' && state.offsetMs === 0) return state.step - 1;
  return state.step;
}
