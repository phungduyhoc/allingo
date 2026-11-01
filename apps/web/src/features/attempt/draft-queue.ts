import type { AnswerInput, AttemptAnswersPut } from '@/lib/types';
import type { DraftStore, DraftStoreKind, PersistedDraft } from './draft-store';

/**
 * Hàng đợi lưu nháp bài làm:
 * - gộp thay đổi theo question_id (upsert), đẩy theo lô bằng PUT /attempts/{id}/answers;
 * - debounce khi đổi câu, flush định kỳ (10 s) và khi rời trang (do use-draft-saver điều phối);
 * - mất mạng/lỗi → giữ trong bộ nhớ + DraftStore (IndexedDB, fallback bộ nhớ), tự gửi lại khi online.
 * Khôi phục từ store là bất đồng bộ: chờ `ready` trước khi đọc `pendingEntries()` để dựng trạng thái màn hình.
 * Không phụ thuộc React để test được bằng Vitest.
 */

export interface DraftEntry {
  question_id: string;
  answer: AnswerInput;
  time_spent_ms?: number;
  flagged?: boolean;
}

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline';

type UiState = NonNullable<AttemptAnswersPut['ui_state']>;

export interface DraftQueueOptions {
  attemptId: string;
  flush: (body: AttemptAnswersPut) => Promise<void>;
  /** Nơi giữ nháp chưa gửi (IndexedDB/bộ nhớ); có thể là Promise vì mở IndexedDB bất đồng bộ */
  store?: DraftStore | Promise<DraftStore> | null;
  /** localStorage của bản cũ (Sprint 0–2) – nháp còn sót được chuyển sang store rồi xoá */
  legacyStorage?: Pick<Storage, 'getItem' | 'removeItem'> | null;
  isOnline?: () => boolean;
  onStatus?: (status: DraftStatus, info: { pending: number; lastSavedAt: number | null; error?: unknown }) => void;
  now?: () => number;
  /** Số lô tối đa mỗi lần PUT (API giới hạn 100) */
  batchMax?: number;
  /**
   * Lỗi "bài đã đóng" (409: quá hạn + ân hạn hoặc đã nộp) → hàng đợi ngừng gửi (không thử lại vô ích),
   * báo `onClosed` một lần. Mặc định: không lỗi nào là đóng.
   */
  isClosedError?: (err: unknown) => boolean;
}

/** Khoá localStorage của bản cũ (chỉ để chuyển dữ liệu) */
export const legacyDraftStorageKey = (attemptId: string) => `allingo.draft.${attemptId}`;

export class DraftQueue {
  /** Xong khi đã khôi phục nháp từ store (không bao giờ reject) */
  readonly ready: Promise<void>;
  private entries = new Map<string, DraftEntry>();
  private sectionElapsed: Record<string, number> | undefined;
  private uiState: UiState | undefined;
  private inflight: Promise<void> | null = null;
  private dirtyMeta = false;
  private _status: DraftStatus = 'idle';
  private _lastSavedAt: number | null = null;
  private store: DraftStore | null = null;
  private writeChain: Promise<void>;
  private writeScheduled = false;
  private _closed = false;
  private closedListeners = new Set<(err: unknown) => void>();
  private readonly opts: Required<Pick<DraftQueueOptions, 'isOnline' | 'now' | 'batchMax'>> & DraftQueueOptions;

  constructor(opts: DraftQueueOptions) {
    this.opts = { isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine), now: () => Date.now(), batchMax: 100, ...opts };
    this.ready = this.restore();
    this.writeChain = this.ready;
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
  /** Server đã từ chối nhận nháp vĩnh viễn (409) – không gửi nữa */
  get closed(): boolean {
    return this._closed;
  }

  /** Đăng ký nhận báo "bài đã đóng"; trả hàm huỷ đăng ký */
  onClosed(listener: (err: unknown) => void): () => void {
    this.closedListeners.add(listener);
    return () => this.closedListeners.delete(listener);
  }

  /** Loại store đang dùng ('none' khi không cấu hình hoặc chưa mở xong) */
  get storeKind(): DraftStoreKind | 'none' {
    return this.store?.kind ?? 'none';
  }

  /** Bản nháp chưa gửi (để khôi phục khi tải lại trang trước khi server kịp nhận) */
  pendingEntries(): DraftEntry[] {
    return [...this.entries.values()];
  }

  /** ui_state chưa gửi (câu đang xem lúc mất mạng) – mới hơn bản của server */
  pendingUiState(): UiState | undefined {
    return this.dirtyMeta ? this.uiState : undefined;
  }

  /** Chờ mọi lần ghi xuống store hoàn tất (dùng trong test / trước khi rời trang) */
  persisted(): Promise<void> {
    return this.writeChain;
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
    if (this._closed || !this.hasPending) return Promise.resolve();
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
    const metaSnapshot = { sectionElapsed: this.sectionElapsed, uiState: this.uiState };
    this.setStatus('saving');
    try {
      await this.opts.flush(body);
      // Chỉ xoá các mục đã gửi và chưa bị ghi đè trong lúc chờ
      for (const e of batch) if (this.entries.get(e.question_id) === e) this.entries.delete(e.question_id);
      // Meta đổi trong lúc gửi → vẫn còn bẩn, gửi ở lượt sau
      if (this.sectionElapsed === metaSnapshot.sectionElapsed && this.uiState === metaSnapshot.uiState) this.dirtyMeta = false;
      this._lastSavedAt = this.opts.now();
      this.persist();
      if (this.hasPending && this.opts.isOnline()) {
        await this.send();
        return;
      }
      this.setStatus(this.hasPending ? 'offline' : 'saved');
    } catch (err) {
      if (this.opts.isClosedError?.(err) && !this._closed) {
        this._closed = true;
        this.setStatus('error', err);
        for (const l of this.closedListeners) l(err);
        throw err;
      }
      this.setStatus(this.opts.isOnline() ? 'error' : 'offline', err);
      throw err;
    }
  }

  /** Sau khi nộp bài: bỏ mọi nháp (cả trong store) */
  clear(): Promise<void> {
    this.entries.clear();
    this.dirtyMeta = false;
    this.sectionElapsed = undefined;
    this.uiState = undefined;
    this.persist();
    return this.writeChain;
  }

  private setStatus(status: DraftStatus, error?: unknown): void {
    this._status = status;
    this.opts.onStatus?.(status, { pending: this.entries.size, lastSavedAt: this._lastSavedAt, error });
  }

  /** Ghi xuống store theo chuỗi tuần tự, gộp các lần gọi dồn dập (ghi ảnh chụp mới nhất) */
  private persist(): void {
    if (this.writeScheduled) return;
    this.writeScheduled = true;
    this.writeChain = this.writeChain
      .then(async () => {
        this.writeScheduled = false;
        const store = this.store;
        if (!store) return;
        const id = this.opts.attemptId;
        if (!this.hasPending) {
          await store.remove(id);
          return;
        }
        const data: PersistedDraft = { entries: Object.fromEntries(this.entries), section_elapsed_sec: this.sectionElapsed, ui_state: this.uiState, updated_at: this.opts.now() };
        await store.save(id, data);
      })
      .catch(() => {
        /* store đầy hoặc bị chặn – vẫn giữ trong bộ nhớ, lần ghi sau thử lại */
        this.writeScheduled = false;
      });
  }

  private async restore(): Promise<void> {
    try {
      this.store = (await this.opts.store) ?? null;
    } catch {
      this.store = null;
    }
    const id = this.opts.attemptId;
    let data: PersistedDraft | null = null;
    try {
      data = this.store ? await this.store.load(id) : null;
    } catch {
      data = null;
    }
    // Nháp bản cũ trong localStorage → gộp (bản trong store ưu tiên hơn), sẽ ghi lại vào store rồi xoá
    let migrated = false;
    try {
      const raw = this.opts.legacyStorage?.getItem(legacyDraftStorageKey(id));
      if (raw) {
        const legacy = JSON.parse(raw) as Partial<PersistedDraft>;
        data = { entries: { ...legacy.entries, ...data?.entries }, section_elapsed_sec: data?.section_elapsed_sec ?? legacy.section_elapsed_sec, ui_state: data?.ui_state ?? legacy.ui_state, updated_at: data?.updated_at ?? 0 };
        this.opts.legacyStorage?.removeItem(legacyDraftStorageKey(id));
        migrated = true;
      }
    } catch {
      /* dữ liệu cũ hỏng → bỏ qua */
    }
    if (!data) return;
    // Mục đã enqueue trong lúc chờ store là mới hơn → không bị đè
    for (const [k, v] of Object.entries(data.entries ?? {})) if (!this.entries.has(k)) this.entries.set(k, v);
    this.sectionElapsed = { ...data.section_elapsed_sec, ...this.sectionElapsed };
    if (data.ui_state || this.uiState) this.uiState = { ...data.ui_state, ...this.uiState };
    this.dirtyMeta = true;
    // writeChain bắt đầu từ `ready` → lần ghi này chạy ngay sau khi khôi phục xong
    if (migrated) this.persist();
  }
}
