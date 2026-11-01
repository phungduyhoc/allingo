import type { AnswerInput, AttemptAnswersPut } from '@/lib/types';

/**
 * Hàng đợi lưu nháp bài làm:
 * - gộp thay đổi theo question_id (upsert), đẩy theo lô bằng PUT /attempts/{id}/answers;
 * - debounce khi đổi câu, flush định kỳ (10 s) và khi rời trang;
 * - mất mạng/lỗi → giữ trong bộ nhớ + localStorage, tự gửi lại khi online (banner "Đang lưu lại…").
 * Không phụ thuộc React để test được bằng Vitest.
 */

export interface DraftEntry {
  question_id: string;
  answer: AnswerInput;
  time_spent_ms?: number;
  flagged?: boolean;
}

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

export interface DraftQueueOptions {
  attemptId: string;
  flush: (body: AttemptAnswersPut) => Promise<void>;
  /** localStorage hoặc tương đương; bỏ qua nếu không có */
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  isOnline?: () => boolean;
  onStatus?: (status: DraftStatus, info: { pending: number; lastSavedAt: number | null; error?: unknown }) => void;
  now?: () => number;
  /** Số lô tối đa mỗi lần PUT (API giới hạn 100) */
  batchMax?: number;
}

interface PersistedDraft {
  entries: Record<string, DraftEntry>;
  section_elapsed_sec?: Record<string, number>;
  ui_state?: AttemptAnswersPut['ui_state'];
}

export const draftStorageKey = (attemptId: string) => `allingo.draft.${attemptId}`;

export class DraftQueue {
  private entries = new Map<string, DraftEntry>();
  private sectionElapsed: Record<string, number> | undefined;
  private uiState: AttemptAnswersPut['ui_state'];
  private inflight: Promise<void> | null = null;
  private dirtyMeta = false;
  private _status: DraftStatus = 'idle';
  private _lastSavedAt: number | null = null;
  private readonly opts: Required<Pick<DraftQueueOptions, 'isOnline' | 'now' | 'batchMax'>> & DraftQueueOptions;

  constructor(opts: DraftQueueOptions) {
    this.opts = { isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine), now: () => Date.now(), batchMax: 100, ...opts };
    this.restore();
  }

  get status(): DraftStatus {
    return this._status;
  }
  get pendingCount(): number {
    return this.entries.size;
  }
  get lastSavedAt(): number | null {
    return this._lastSavedAt;
  }
  get hasPending(): boolean {
    return this.entries.size > 0 || this.dirtyMeta;
  }

  /** Bản nháp chưa gửi (để khôi phục khi tải lại trang trước khi server kịp nhận) */
  pendingEntries(): DraftEntry[] {
    return [...this.entries.values()];
  }

  enqueue(entry: DraftEntry): void {
    const prev = this.entries.get(entry.question_id);
    this.entries.set(entry.question_id, { ...prev, ...entry, time_spent_ms: (prev?.time_spent_ms ?? 0) + (entry.time_spent_ms ?? 0) || entry.time_spent_ms });
    this.persist();
    this.setStatus(this.opts.isOnline() ? 'idle' : 'offline');
  }

  setMeta(meta: { section_elapsed_sec?: Record<string, number>; ui_state?: AttemptAnswersPut['ui_state'] }): void {
    if (meta.section_elapsed_sec) this.sectionElapsed = { ...this.sectionElapsed, ...meta.section_elapsed_sec };
    if (meta.ui_state) this.uiState = { ...this.uiState, ...meta.ui_state };
    this.dirtyMeta = true;
    this.persist();
  }

  /** Gửi mọi thay đổi đang chờ; an toàn khi gọi nhiều lần (gộp vào lượt đang chạy) */
  flush(): Promise<void> {
    if (this.inflight) return this.inflight;
    if (!this.hasPending) return Promise.resolve();
    if (!this.opts.isOnline()) {
      this.setStatus('offline');
      return Promise.resolve();
    }
    this.inflight = this.send().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async send(): Promise<void> {
    const batch = [...this.entries.values()].slice(0, this.opts.batchMax);
    const body: AttemptAnswersPut = { answers: batch };
    if (this.sectionElapsed) body.section_elapsed_sec = this.sectionElapsed;
    if (this.uiState) body.ui_state = this.uiState;
    this.setStatus('saving');
    try {
      await this.opts.flush(body);
      // Chỉ xoá các mục đã gửi và chưa bị ghi đè trong lúc chờ
      for (const e of batch) if (this.entries.get(e.question_id) === e) this.entries.delete(e.question_id);
      this.dirtyMeta = false;
      this._lastSavedAt = this.opts.now();
      this.persist();
      if (this.entries.size > 0) {
        await this.send();
        return;
      }
      this.setStatus('saved');
    } catch (err) {
      this.setStatus(this.opts.isOnline() ? 'error' : 'offline', err);
      throw err;
    }
  }

  clear(): void {
    this.entries.clear();
    this.dirtyMeta = false;
    this.sectionElapsed = undefined;
    this.uiState = undefined;
    try {
      this.opts.storage?.removeItem(draftStorageKey(this.opts.attemptId));
    } catch {
      /* ignore */
    }
  }

  private setStatus(status: DraftStatus, error?: unknown): void {
    this._status = status;
    this.opts.onStatus?.(status, { pending: this.entries.size, lastSavedAt: this._lastSavedAt, error });
  }

  private persist(): void {
    try {
      const key = draftStorageKey(this.opts.attemptId);
      if (!this.hasPending) {
        this.opts.storage?.removeItem(key);
        return;
      }
      const data: PersistedDraft = { entries: Object.fromEntries(this.entries), section_elapsed_sec: this.sectionElapsed, ui_state: this.uiState };
      this.opts.storage?.setItem(key, JSON.stringify(data));
    } catch {
      /* localStorage đầy hoặc bị chặn – vẫn giữ trong bộ nhớ */
    }
  }

  private restore(): void {
    try {
      const raw = this.opts.storage?.getItem(draftStorageKey(this.opts.attemptId));
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedDraft;
      for (const [k, v] of Object.entries(data.entries ?? {})) this.entries.set(k, v);
      this.sectionElapsed = data.section_elapsed_sec;
      this.uiState = data.ui_state;
      this.dirtyMeta = this.entries.size > 0;
    } catch {
      /* dữ liệu hỏng → bỏ qua */
    }
  }
}
