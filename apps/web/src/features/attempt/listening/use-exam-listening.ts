'use client';

import * as React from 'react';
import { sendAttemptEvent } from '@/lib/queries';
import { ListeningEngine, listeningCursorKey, type EngineOptions } from './listening-engine';
import { isAnswerable, newerCursor, parseServerCursor, parseStoredCursor, resumeCursor, type ListeningCursor, type ListeningProgram, type ListeningStep } from './program';
import { initSequencer, reachedStep, sequencerReducer, type SeqPhase } from './sequencer';
import { audioTestRate } from './test-rate';

export interface ExamListeningOptions {
  attemptId: string;
  /** null/rỗng → không có Listening "nghe một lần" (Reading, Practice) */
  program: ListeningProgram | null;
  audioPlays?: Record<string, number>;
  /** URL gia hạn mới nhất theo asset (ổn định – `useMediaUrls().resolveLatest`) */
  resolveUrl: (assetId: string | null, fallback: string) => string;
  refreshUrls: () => Promise<void>;
  /** Đổi danh tính khi bảng URL đổi → preload đổi sang URL mới */
  urlsVersion: unknown;
  onFocus: (questionIndex: number) => void;
  onDone: () => void;
  /**
   * Vị trí đã lưu ở server (`attempt.ui_state.listening`, v1.1 S5) và bản chưa gửi trong hàng đợi nháp – dùng khi mất/khác
   * localStorage (thiết bị khác, xoá dữ liệu); bản nào tiến xa hơn được dùng.
   */
  serverCursor?: unknown;
  /** Đẩy vị trí lên server (ui_state.listening) – gọi khi đổi bước và tối đa mỗi SERVER_PUSH_MS */
  onCursor?: (cursor: ListeningCursor) => void;
}

/** Nhịp tối thiểu giữa hai lần ghi vị trí vào hàng đợi nháp (localStorage vẫn ghi mỗi giây) */
const SERVER_PUSH_MS = 3000;

export interface ExamListening {
  active: boolean;
  phase: SeqPhase;
  step: number;
  current: ListeningStep | null;
  totalSteps: number;
  /** Vào lại giữa chừng (tải lại trang) → màn "Tiếp tục nghe" */
  resumed: boolean;
  start: () => void;
  isAnswerable: (questionIndex: number) => boolean;
  readProgress: () => { elapsedMs: number; totalMs: number | null };
  mountAudio: (el: HTMLDivElement | null) => (() => void) | undefined;
}

/** Bộ giới hạn nhịp đẩy cursor (thuần, không dùng ref của React) */
function createCursorPusher(minGapMs: number) {
  let last = { step: -1, at: 0 };
  let target: ((c: ListeningCursor) => void) | undefined;
  return {
    setTarget: (fn: ((c: ListeningCursor) => void) | undefined) => {
      target = fn;
    },
    push: (c: ListeningCursor) => {
      const now = Date.now();
      if (c.step === last.step && now - last.at < minGapMs) return;
      last = { step: c.step, at: now };
      target?.(c);
    },
  };
}

function initialCursor(attemptId: string, program: ListeningProgram | null, audioPlays?: Record<string, number>, serverCursor?: unknown): ListeningCursor {
  if (!program || !program.steps.length) return { step: 0, offsetMs: 0 };
  let local: ListeningCursor | null = null;
  try {
    local = parseStoredCursor(window.localStorage.getItem(listeningCursorKey(attemptId)), program.steps.length);
  } catch {
    local = null;
  }
  // localStorage (lớp nhanh, chính xác tới giây) vs ui_state.listening của server → bản mới hơn; rồi đối chiếu audio_plays
  return resumeCursor(program, newerCursor(local, parseServerCursor(serverCursor, program.steps.length)), audioPlays);
}

/**
 * Chuỗi phát Listening Exam Mode: trạng thái (reducer thuần) + engine <audio> (DOM). `program` phải ổn định về cấu trúc
 * trong suốt bài làm (refetch attempt đổi danh tính nhưng giữ thứ tự câu/bước).
 */
export function useExamListening(opts: ExamListeningOptions): ExamListening {
  const { attemptId, program } = opts;
  const active = !!program && program.steps.length > 0;
  const [cursor] = React.useState(() => initialCursor(attemptId, program, opts.audioPlays, opts.serverCursor));
  // Đẩy vị trí lên server có nhịp (đổi bước → ngay; trong bước → tối đa mỗi SERVER_PUSH_MS); callback mới nhất gắn trong effect
  const [pusher] = React.useState(() => createCursorPusher(SERVER_PUSH_MS));
  React.useEffect(() => {
    pusher.setTarget(opts.onCursor);
  });
  const [state, dispatch] = React.useReducer(sequencerReducer, undefined, () => initSequencer(program ? program.steps.map((s) => s.kind) : [], cursor));
  const resumed = cursor.step > 0 || cursor.offsetMs > 0;

  const buildOptions = (): EngineOptions | null =>
    program && active
      ? {
          attemptId,
          program,
          dispatch,
          resolveUrl: opts.resolveUrl,
          refreshUrls: opts.refreshUrls,
          onFocus: opts.onFocus,
          onDone: opts.onDone,
          sendEvent: (type, meta) => sendAttemptEvent(attemptId, { type, meta }),
          rate: audioTestRate(),
          onCursor: pusher.push,
        }
      : null;
  const [engine] = React.useState(() => {
    const o = buildOptions();
    return o ? new ListeningEngine(o, initSequencer(o.program.steps.map((s) => s.kind), cursor)) : null;
  });

  // Callback mới nhất cho engine (onFocus/onDone đóng gói state của trang làm bài)
  React.useEffect(() => {
    const o = buildOptions();
    if (engine && o) engine.setOptions(o);
  });
  React.useEffect(() => {
    engine?.update(state);
  }, [engine, state]);
  React.useEffect(() => {
    engine?.refreshPool();
  }, [engine, opts.urlsVersion]);

  const mountAudio = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (!el || !engine) return undefined;
      engine.attach(el);
      return () => engine.detach();
    },
    [engine],
  );

  const reached = reachedStep(state);
  const answerable = React.useCallback((i: number) => (program && active ? isAnswerable(program, i, reached) : true), [active, program, reached]);
  const start = React.useCallback(() => engine?.start(), [engine]);
  const readProgress = React.useCallback(() => engine?.progress() ?? { elapsedMs: 0, totalMs: null }, [engine]);

  return {
    active,
    phase: state.phase,
    step: state.step,
    current: program?.steps[state.step] ?? null,
    totalSteps: program?.steps.length ?? 0,
    resumed,
    start,
    isAnswerable: answerable,
    readProgress,
    mountAudio,
  };
}
