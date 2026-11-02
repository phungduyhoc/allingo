import { serializeCursor, upcomingAudioSteps, type AudioStep, type ListeningCursor, type ListeningProgram } from './program';
import type { SeqAction, SeqPhase, SeqState } from './sequencer';

/**
 * Bộ phát Listening Exam Mode (mệnh lệnh, gắn với DOM): nhóm 3 phần tử <audio> xoay vòng = bước đang phát + preload 2 tệp kế,
 * hẹn giờ `pause_ms`, chống tạm dừng/tua (kể cả phím media, tiện ích), xử lý mất mạng/stalled/URL hết hạn, lưu vị trí.
 * Trạng thái chuyển bước nằm ở `sequencerReducer` (thuần); engine chỉ phát theo trạng thái và báo sự kiện qua `dispatch`.
 */

const POOL_SIZE = 3;
/** 'waiting' kéo dài quá mức này mới coi là stalled (tránh nháy trạng thái khi đệm ngắn) */
const STALL_DELAY_MS = 1200;
/** Stalled lâu mà vẫn có mạng → nạp lại phần tử (URL mới) tại vị trí đang nghe */
const STALL_RELOAD_MS = 8000;
const STALL_EVENT_THROTTLE_MS = 15_000;
/** Lỗi liên tiếp khi CÓ mạng (URL mới vẫn hỏng) → bỏ qua bước để không kẹt cả bài */
const MAX_FAILURES = 4;
const SAVE_EVERY_MS = 1000;
const PRELOAD_REFRESH_GAP_MS = 10_000;
const MEDIA_ACTIONS = ['play', 'pause', 'stop', 'seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as const;

type AudioEventType = 'audio_started' | 'audio_ended' | 'audio_stalled';

export interface EngineOptions {
  attemptId: string;
  program: ListeningProgram;
  dispatch: (action: SeqAction) => void;
  resolveUrl: (assetId: string | null, fallback: string) => string;
  refreshUrls: () => Promise<void>;
  onFocus: (questionIndex: number) => void;
  onDone: () => void;
  sendEvent: (type: AudioEventType, meta: Record<string, unknown>) => void;
  /** Hệ số tốc độ (1 ở production; E2E tăng tốc) */
  rate: number;
  /** Mỗi lần lưu vị trí (≈ 1 s/lần + khi đổi bước) – trang làm bài đẩy lên server qua ui_state.listening */
  onCursor?: (cursor: ListeningCursor) => void;
}

interface Slot {
  el: HTMLAudioElement;
  step: number | null;
  src: string | null;
  detach: () => void;
}

export const listeningCursorKey = (attemptId: string) => `allingo.listening.${attemptId}`;

const AUDIO_PHASES: ReadonlySet<SeqPhase> = new Set(['loading', 'playing', 'stalled']);

export class ListeningEngine {
  private opts: EngineOptions;
  private state: SeqState;
  private slots: Slot[] = [];
  private container: HTMLElement | null = null;
  private initialized = false;
  private lastStep = -1;
  private lastPhase: SeqPhase | null = null;
  /** Vị trí trong bước hiện tại (ms nội dung): audio = currentTime, pause = đã chờ */
  private offsetMs = 0;
  private pauseBaseMs = 0;
  private pauseStartedAt = 0;
  private pauseEndsAt = 0;
  private pauseTimer: number | null = null;
  private stallTimer: number | null = null;
  private stallReloadTimer: number | null = null;
  private retryTimer: number | null = null;
  private saveTimer: number | null = null;
  private failures = 0;
  private waitingOnline = false;
  private lastStallEventAt = 0;
  private lastPreloadRefreshAt = 0;
  private allowSeek = false;
  private lastTimeAt = 0;
  private readonly started = new Set<number>();

  constructor(opts: EngineOptions, initial: SeqState) {
    this.opts = opts;
    this.state = initial;
    this.offsetMs = initial.offsetMs;
  }

  setOptions(opts: EngineOptions): void {
    this.opts = opts;
  }

  // --------------------------------------------------------------------------- vòng đời DOM

  attach(container: HTMLElement): void {
    if (this.container === container) return;
    this.detach();
    this.container = container;
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = document.createElement('audio');
      el.preload = 'auto';
      el.setAttribute('data-testid', 'exam-audio');
      el.setAttribute('data-active', 'false');
      container.appendChild(el);
      const slot: Slot = { el, step: null, src: null, detach: () => undefined };
      slot.detach = this.listen(slot);
      this.slots.push(slot);
    }
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.persist);
    this.saveTimer = window.setInterval(() => {
      if (AUDIO_PHASES.has(this.state.phase) || this.state.phase === 'pause') this.persist();
    }, SAVE_EVERY_MS);
    this.lockMediaSession(true);
    this.syncPool();
    if (AUDIO_PHASES.has(this.state.phase)) this.playCurrent();
    else if (this.state.phase === 'pause') this.startPause();
  }

  detach(): void {
    if (!this.container) return;
    // Lưu vị trí trước khi gỡ (đổi trang/nộp bài/StrictMode gắn lại)
    this.offsetMs = this.currentOffset();
    this.persist();
    for (const s of this.slots) {
      s.detach();
      s.el.pause();
      s.el.removeAttribute('src');
      s.el.load();
      s.el.remove();
    }
    this.slots = [];
    this.container = null;
    this.clearTimers();
    if (this.saveTimer !== null) window.clearInterval(this.saveTimer);
    this.saveTimer = null;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.persist);
    this.lockMediaSession(false);
  }

  // --------------------------------------------------------------------------- trạng thái

  /** Gọi sau mỗi lần reducer đổi trạng thái (effect) */
  update(next: SeqState): void {
    const prevPhase = this.lastPhase;
    this.state = next;
    const stepChanged = next.step !== this.lastStep;
    const phaseChanged = next.phase !== prevPhase;
    this.lastStep = next.step;
    this.lastPhase = next.phase;
    const first = !this.initialized;
    this.initialized = true;

    if (stepChanged) {
      this.offsetMs = next.offsetMs;
      this.lastTimeAt = 0;
      this.failures = 0;
      this.clearTimers();
      if (next.phase !== 'done') {
        const index = this.opts.program.steps[next.step]!.questionIndex;
        // Lần đầu (mount): để trang làm bài gắn xong điều hướng rồi mới đặt câu đang nghe
        if (first) window.setTimeout(() => this.opts.onFocus(index), 0);
        else this.opts.onFocus(index);
      }
    }
    if (next.phase === 'gate') this.offsetMs = next.offsetMs;
    this.syncPool();
    if (stepChanged || phaseChanged) this.persist();

    switch (next.phase) {
      case 'loading': {
        const slot = this.slotFor(next.step);
        if ((stepChanged || phaseChanged) && !(slot && !slot.el.paused)) this.playCurrent();
        break;
      }
      case 'pause':
        if (stepChanged || phaseChanged) this.startPause();
        break;
      case 'gate':
        this.pauseAll();
        break;
      case 'done':
        if (phaseChanged) this.pauseAll();
        if (phaseChanged && !first) this.opts.onDone();
        break;
      default:
        break;
    }
  }

  /** "Bắt đầu nghe" – PHẢI gọi trong trình xử lý cử chỉ người dùng (click) để trình duyệt cho phát */
  start(): void {
    if (this.state.phase !== 'gate') return;
    const cur = this.state.step;
    this.syncPool();
    // Safari chỉ cho play() ngoài cử chỉ trên phần tử đã từng phát trong cử chỉ → "mở khoá" cả nhóm (tắt tiếng, dừng ngay)
    for (const slot of this.slots) if (slot.step !== cur && slot.src) this.unlock(slot);
    if (this.opts.program.steps[cur]?.kind === 'audio') this.playCurrent();
    this.opts.dispatch({ type: 'start' });
  }

  /** URL vừa được gia hạn → phần tử preload chưa đệm xong đổi sang URL mới */
  refreshPool(): void {
    this.syncPool();
  }

  progress(): { elapsedMs: number; totalMs: number | null } {
    const s = this.opts.program.steps[this.state.step];
    if (!s) return { elapsedMs: 0, totalMs: null };
    if (s.kind === 'pause') return { elapsedMs: Math.min(s.ms, this.currentOffset()), totalMs: s.ms };
    const el = this.slotFor(this.state.step)?.el;
    const duration = el && Number.isFinite(el.duration) && el.duration > 0 ? el.duration * 1000 : s.durationMs;
    return { elapsedMs: this.offsetMs, totalMs: duration };
  }

  // --------------------------------------------------------------------------- phát

  private audioStep(step: number): AudioStep | null {
    const s = this.opts.program.steps[step];
    return s?.kind === 'audio' ? s : null;
  }

  private slotFor(step: number): Slot | undefined {
    return this.slots.find((s) => s.step === step);
  }

  private isActive(slot: Slot): boolean {
    return slot.step === this.state.step && AUDIO_PHASES.has(this.state.phase);
  }

  private setSrc(slot: Slot, url: string, force = false): void {
    if (!force && slot.src === url) return;
    slot.src = url;
    // Gán src chạy lại thuật toán nạp (preload="auto" → đệm sẵn)
    slot.el.src = url;
  }

  private fullyBuffered(el: HTMLAudioElement): boolean {
    if (!Number.isFinite(el.duration) || el.duration <= 0 || el.buffered.length === 0) return false;
    return el.buffered.end(el.buffered.length - 1) >= el.duration - 0.1;
  }

  /** Giữ nhóm phần tử khớp các bước audio sắp tới; phần tử chưa phát có URL sắp hết hạn → đổi URL gia hạn */
  private syncPool(): void {
    if (!this.slots.length) return;
    const { program } = this.opts;
    const st = this.state;
    const wanted = st.phase === 'done' ? [] : upcomingAudioSteps(program, st.step, POOL_SIZE);
    for (const slot of this.slots) if (slot.step !== null && !wanted.includes(slot.step)) slot.step = null;
    for (const s of wanted) {
      const step = program.steps[s] as AudioStep;
      const url = this.opts.resolveUrl(step.assetId, step.url);
      const slot = this.slotFor(s);
      if (!slot) {
        const free = this.slots.find((x) => x.step === null);
        if (!free) continue;
        free.step = s;
        this.setSrc(free, url);
        continue;
      }
      // Bước đang phát giữ nguyên src (không gián đoạn); lỗi/403 sẽ nạp lại bằng URL mới ở recover()
      const playing = s === st.step && AUDIO_PHASES.has(st.phase);
      if (slot.src !== url && !playing && !this.fullyBuffered(slot.el)) this.setSrc(slot, url);
    }
    for (const slot of this.slots) slot.el.setAttribute('data-active', String(this.isActive(slot)));
  }

  private playCurrent(): void {
    const st = this.state;
    const step = this.audioStep(st.step);
    if (!step) return;
    let slot = this.slotFor(st.step);
    if (!slot) {
      this.syncPool();
      slot = this.slotFor(st.step);
    }
    if (!slot) return;
    const s = slot;
    const el = s.el;
    el.muted = false;
    el.defaultPlaybackRate = this.opts.rate;
    el.playbackRate = this.opts.rate;
    for (const x of this.slots) x.el.setAttribute('data-active', String(x === s));
    const startAt = this.offsetMs / 1000;
    if (startAt > 0.05 && Math.abs(el.currentTime - startAt) > 0.25) {
      const seek = () => {
        if (s.step !== this.state.step) return;
        this.allowSeek = true;
        el.currentTime = this.offsetMs / 1000;
      };
      if (el.readyState >= 1) seek();
      else el.addEventListener('loadedmetadata', seek, { once: true });
    }
    el.play().catch((err: unknown) => this.onPlayRejected(s, err));
  }

  private onPlayRejected(slot: Slot, err: unknown): void {
    if (slot.step !== this.state.step) return;
    const name = err instanceof DOMException ? err.name : (err as { name?: string } | null)?.name;
    // Trình duyệt chặn tự phát (tải lại trang, Safari…) → về màn "Bắt đầu nghe", giữ vị trí
    if (name === 'NotAllowedError') this.opts.dispatch({ type: 'blocked', offsetMs: this.offsetMs });
    else if (name !== 'AbortError') this.recover(slot, 'play_failed');
  }

  private unlock(slot: Slot): void {
    const el = slot.el;
    el.muted = true;
    el.play().then(() => {
      if (this.isActive(slot)) {
        el.muted = false;
        return;
      }
      el.pause();
      el.currentTime = 0;
      el.muted = false;
    }).catch(() => {
      el.muted = false;
    });
  }

  private pauseAll(): void {
    for (const s of this.slots) if (!s.el.paused) s.el.pause();
  }

  // --------------------------------------------------------------------------- chờ trả lời (pause_ms)

  private startPause(): void {
    const step = this.state.step;
    const s = this.opts.program.steps[step];
    if (s?.kind !== 'pause') return;
    if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer);
    this.pauseBaseMs = Math.min(s.ms, this.offsetMs);
    this.pauseStartedAt = Date.now();
    const remaining = Math.max(0, (s.ms - this.pauseBaseMs) / this.opts.rate);
    this.pauseEndsAt = this.pauseStartedAt + remaining;
    this.pauseTimer = window.setTimeout(() => this.checkPause(step), remaining);
  }

  private checkPause(step: number): void {
    this.pauseTimer = null;
    if (this.state.step !== step || this.state.phase !== 'pause') return;
    const left = this.pauseEndsAt - Date.now();
    if (left > 5) {
      this.pauseTimer = window.setTimeout(() => this.checkPause(step), left);
      return;
    }
    this.offsetMs = 0;
    this.opts.dispatch({ type: 'pauseElapsed', step });
  }

  private currentOffset(): number {
    if (this.state.phase === 'pause' && this.pauseStartedAt > 0 && this.lastStep === this.state.step) {
      return this.pauseBaseMs + Math.max(0, Date.now() - this.pauseStartedAt) * this.opts.rate;
    }
    return this.state.phase === 'done' ? 0 : this.offsetMs;
  }

  // --------------------------------------------------------------------------- sự kiện phần tử

  private listen(slot: Slot): () => void {
    const el = slot.el;
    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
      el.addEventListener(type, fn);
      return () => el.removeEventListener(type, fn);
    };
    const offs = [
      on('playing', () => {
        if (!this.isActive(slot)) return;
        this.clearStall();
        this.failures = 0;
        this.waitingOnline = false;
        const step = this.state.step;
        this.opts.dispatch({ type: 'playing', step });
        if (!this.started.has(step)) {
          this.started.add(step);
          // Tiếp tục giữa chừng (offset > 0) → lượt nghe đã được ghi nhận trước khi tải lại
          if (this.state.offsetMs === 0) this.emit('audio_started', step);
        }
      }),
      on('timeupdate', () => {
        if (!this.isActive(slot) || el.seeking) return;
        this.offsetMs = el.currentTime * 1000;
        this.lastTimeAt = Date.now();
        if (!el.paused && el.readyState >= 3) {
          this.clearStall();
          if (this.state.phase === 'stalled') this.opts.dispatch({ type: 'playing', step: this.state.step });
        }
      }),
      on('waiting', () => this.isActive(slot) && this.scheduleStall(slot)),
      on('stalled', () => this.isActive(slot) && !this.fullyBuffered(el) && this.scheduleStall(slot)),
      on('ended', () => {
        if (!this.isActive(slot)) return;
        const step = this.state.step;
        this.clearStall();
        this.emit('audio_ended', step);
        this.offsetMs = 0;
        this.opts.dispatch({ type: 'ended', step });
      }),
      on('pause', () => {
        // Không cho tạm dừng (phím media, tai nghe, tiện ích): còn ở bước phát → phát tiếp
        if (!this.isActive(slot) || el.ended) return;
        window.setTimeout(() => {
          if (this.isActive(slot) && el.paused && !el.ended) el.play().catch((err: unknown) => this.onPlayRejected(slot, err));
        }, 0);
      }),
      on('seeking', () => {
        // Không cho tua: chỉ engine được đặt currentTime (khôi phục vị trí); tua từ nơi khác → trả về vị trí đang nghe
        // (ước lượng từ lần timeupdate gần nhất + thời gian đã trôi khi đang phát)
        if (this.allowSeek || !this.isActive(slot)) return;
        const expected = this.offsetMs + (this.state.phase === 'playing' && this.lastTimeAt > 0 ? (Date.now() - this.lastTimeAt) * this.opts.rate : 0);
        if (Math.abs(el.currentTime * 1000 - expected) > 150) {
          this.allowSeek = true;
          this.offsetMs = expected;
          el.currentTime = expected / 1000;
        }
      }),
      on('seeked', () => {
        this.allowSeek = false;
      }),
      on('ratechange', () => {
        if (this.isActive(slot) && el.playbackRate !== this.opts.rate) el.playbackRate = this.opts.rate;
      }),
      on('error', () => {
        if (this.isActive(slot)) {
          this.recover(slot, 'error');
          return;
        }
        // Phần tử preload lỗi (URL hết hạn/403/mất mạng) → gia hạn URL ngay (tối đa 1 lần/10 s); syncPool nạp lại bằng URL mới
        slot.src = null;
        if (navigator.onLine && Date.now() - this.lastPreloadRefreshAt > PRELOAD_REFRESH_GAP_MS) {
          this.lastPreloadRefreshAt = Date.now();
          void this.opts.refreshUrls().then(() => this.syncPool());
        }
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  private emit(type: AudioEventType, step: number, extra: Record<string, unknown> = {}): void {
    const s = this.audioStep(step);
    if (!s) return;
    this.opts.sendEvent(type, { question_id: s.eventQuestionId, ...(s.assetId ? { asset_id: s.assetId } : {}), position_ms: Math.max(0, Math.round(this.offsetMs)), ...extra });
  }

  private scheduleStall(slot: Slot): void {
    if (this.stallTimer !== null) return;
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      if (!this.isActive(slot) || (slot.el.readyState >= 3 && !slot.el.paused)) return;
      const step = this.state.step;
      this.opts.dispatch({ type: 'stalled', step });
      this.emitStall(step, navigator.onLine ? 'buffering' : 'offline');
      if (this.stallReloadTimer === null) {
        this.stallReloadTimer = window.setTimeout(() => {
          this.stallReloadTimer = null;
          if (this.isActive(slot) && this.state.phase === 'stalled') this.recover(slot, 'stalled');
        }, STALL_RELOAD_MS);
      }
    }, STALL_DELAY_MS);
  }

  private emitStall(step: number, reason: string): void {
    const now = Date.now();
    if (now - this.lastStallEventAt < STALL_EVENT_THROTTLE_MS) return;
    this.lastStallEventAt = now;
    this.emit('audio_stalled', step, { reason });
  }

  private clearStall(): void {
    if (this.stallTimer !== null) window.clearTimeout(this.stallTimer);
    if (this.stallReloadTimer !== null) window.clearTimeout(this.stallReloadTimer);
    this.stallTimer = null;
    this.stallReloadTimer = null;
  }

  /** Lỗi/403/stalled: chờ có mạng → gia hạn URL → nạp lại đúng vị trí đang nghe (lùi dần 1–8 s; quá MAX_FAILURES khi có mạng → bỏ qua) */
  private recover(slot: Slot, reason: string): void {
    if (this.retryTimer !== null) return;
    const step = this.state.step;
    this.clearStall();
    this.opts.dispatch({ type: 'stalled', step });
    this.emitStall(step, reason);
    const delay = this.failures === 0 ? 0 : Math.min(8000, 1000 * 2 ** (this.failures - 1));
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      if (this.state.step !== step || !AUDIO_PHASES.has(this.state.phase)) return;
      if (!navigator.onLine) {
        this.waitingOnline = true;
        return;
      }
      this.failures++;
      if (this.failures > MAX_FAILURES) {
        this.emit('audio_stalled', step, { reason: 'skipped' });
        this.opts.dispatch({ type: 'skip', step });
        return;
      }
      void this.opts
        .refreshUrls()
        .catch(() => undefined)
        .then(() => {
          if (this.state.step !== step || !this.slots.includes(slot) || slot.step !== step) return;
          const s = this.audioStep(step)!;
          this.setSrc(slot, this.opts.resolveUrl(s.assetId, s.url), true);
          this.playCurrent();
        });
    }, delay);
  }

  private readonly onOnline = (): void => {
    if (!this.waitingOnline) return;
    this.waitingOnline = false;
    const slot = this.slotFor(this.state.step);
    if (slot && this.isActive(slot)) this.recover(slot, 'reconnected');
  };

  private readonly onVisibility = (): void => {
    // Hẹn giờ ở tab nền bị giãn → khi quay lại kiểm tra ngay thời gian chờ
    if (document.visibilityState === 'visible' && this.state.phase === 'pause' && Date.now() >= this.pauseEndsAt) this.checkPause(this.state.step);
  };

  private readonly persist = (): void => {
    const cursor: ListeningCursor = { step: this.state.step, offsetMs: this.currentOffset() };
    try {
      const n = this.opts.program.steps.length;
      window.localStorage.setItem(listeningCursorKey(this.opts.attemptId), serializeCursor(cursor, n));
    } catch {
      /* localStorage không khả dụng → khôi phục theo ui_state.listening / audio_plays của server */
    }
    this.opts.onCursor?.(cursor);
  };

  private clearTimers(): void {
    this.clearStall();
    if (this.pauseTimer !== null) window.clearTimeout(this.pauseTimer);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.pauseTimer = null;
    this.retryTimer = null;
    this.pauseStartedAt = 0;
  }

  private lockMediaSession(lock: boolean): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    for (const action of MEDIA_ACTIONS) {
      try {
        // Handler rỗng ghi đè hành vi mặc định (phím tạm dừng/tua trên bàn phím, tai nghe, màn hình khoá)
        navigator.mediaSession.setActionHandler(action, lock ? () => undefined : null);
      } catch {
        /* action không hỗ trợ */
      }
    }
  }
}
