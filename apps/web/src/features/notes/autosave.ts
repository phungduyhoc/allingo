/**
 * Lưu tự động có debounce cho ghi chú (thuần – có test với fake timers): mỗi lần gõ `schedule(value)` hẹn lưu sau
 * `delay` ms (gõ tiếp → hẹn lại); các lần lưu chạy NỐI TIẾP (lần đầu POST tạo ghi chú, lần sau PATCH cần id) và chỉ
 * lưu giá trị mới nhất; lỗi → trạng thái `error`, giữ giá trị chờ để `retry()`; `flush()` lưu ngay (rời trang, bấm Xong).
 */

export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface AutosaveOptions<T> {
  delay: number;
  save: (value: T) => Promise<void>;
  onStatus?: (status: AutosaveStatus, error?: unknown) => void;
  /** So sánh để bỏ qua lần lưu trùng giá trị đã lưu (mặc định ===) */
  equals?: (a: T, b: T) => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface Autosave<T> {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
  retry: () => Promise<void>;
  /** Đặt giá trị đã lưu (dữ liệu server ban đầu) – không gây lưu */
  reset: (saved: T) => void;
  cancel: () => void;
  readonly status: AutosaveStatus;
  readonly hasPending: boolean;
}

export function createAutosave<T>(opts: AutosaveOptions<T>, initialSaved?: T): Autosave<T> {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const equals = opts.equals ?? ((a, b) => a === b);
  let timer: unknown = null;
  let pending: { value: T } | null = null;
  let saved: { value: T } | null = initialSaved === undefined ? null : { value: initialSaved };
  let running: Promise<void> | null = null;
  let status: AutosaveStatus = 'idle';

  const setStatus = (s: AutosaveStatus, err?: unknown) => {
    status = s;
    opts.onStatus?.(s, err);
  };

  const clear = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const run = async (): Promise<void> => {
    // Nối tiếp: đợi lần lưu đang chạy rồi mới lưu giá trị mới nhất
    while (running) await running;
    if (!pending) return;
    const next = pending;
    pending = null;
    if (saved && equals(saved.value, next.value)) {
      setStatus('saved');
      return;
    }
    setStatus('saving');
    const job = (async () => {
      try {
        await opts.save(next.value);
        saved = next;
        setStatus(pending ? 'dirty' : 'saved');
      } catch (err) {
        // Giữ lại để thử lại (trừ khi đã có giá trị mới hơn)
        pending ??= next;
        setStatus('error', err);
        throw err;
      }
    })();
    running = job
      .finally(() => {
        running = null;
      })
      .catch(() => undefined);
    await job;
    if (pending && status !== 'error') await run();
  };

  const flush = async () => {
    clear();
    try {
      await run();
    } catch {
      /* trạng thái error đã báo qua onStatus */
    }
  };

  return {
    schedule(value: T) {
      pending = { value };
      clear();
      if (status !== 'saving') setStatus('dirty');
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, opts.delay);
    },
    flush,
    retry: flush,
    reset(value: T) {
      saved = { value };
      pending = null;
      clear();
      setStatus('idle');
    },
    cancel() {
      clear();
      pending = null;
    },
    get status() {
      return status;
    },
    get hasPending() {
      return pending !== null || timer !== null;
    },
  };
}
