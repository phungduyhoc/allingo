import type { AttemptAnswersPut } from '@/lib/types';
import type { DraftEntry } from './draft-queue';

/**
 * Nơi giữ nháp bài làm CHƯA gửi được lên server (mất mạng, lỗi, tải lại trang trước khi flush):
 * - IndexedDB (`allingo-drafts` / store `drafts`, key = attempt_id) – bền qua tải lại/đóng tab;
 * - fallback bộ nhớ khi IndexedDB không dùng được (SSR, chế độ riêng tư chặn, SecurityError, mở bị treo/chặn).
 * Mọi lỗi được nuốt ở đây: lưu nháp cục bộ không bao giờ được làm hỏng luồng làm bài.
 */

export interface PersistedDraft {
  entries: Record<string, DraftEntry>;
  section_elapsed_sec?: Record<string, number>;
  ui_state?: AttemptAnswersPut['ui_state'];
  /** epoch ms lần ghi cuối */
  updated_at: number;
}

export type DraftStoreKind = 'indexeddb' | 'memory';

export interface DraftStore {
  readonly kind: DraftStoreKind;
  load(attemptId: string): Promise<PersistedDraft | null>;
  save(attemptId: string, data: PersistedDraft): Promise<void>;
  remove(attemptId: string): Promise<void>;
}

export const DRAFT_DB_NAME = 'allingo-drafts';
export const DRAFT_DB_STORE = 'drafts';
const OPEN_TIMEOUT_MS = 3000;

/** Bản sao sâu kiểu JSON để store bộ nhớ không chia sẻ tham chiếu với hàng đợi */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export function createMemoryDraftStore(): DraftStore {
  const map = new Map<string, PersistedDraft>();
  return {
    kind: 'memory',
    load: async (id) => {
      const v = map.get(id);
      return v ? copy(v) : null;
    },
    save: async (id, data) => {
      map.set(id, copy(data));
    },
    remove: async (id) => {
      map.delete(id);
    },
  };
}

/** Mở DB ở version hiện có (tạo mới = v1 + onupgradeneeded); `version` chỉ dùng khi cần nâng để tạo store */
function openDatabase(factory: IDBFactory, timeoutMs: number, version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let state: 'pending' | 'settled' = 'pending';
    const fail = (err: unknown) => {
      if (state !== 'pending') return;
      state = 'settled';
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error('IndexedDB unavailable'));
    };
    // Mở có thể treo (bị tab khác chặn, trình duyệt lỗi) → hết giờ thì dùng bộ nhớ
    const timer = setTimeout(() => fail(new Error('IndexedDB open timed out')), timeoutMs);
    let req: IDBOpenDBRequest;
    try {
      req = version ? factory.open(DRAFT_DB_NAME, version) : factory.open(DRAFT_DB_NAME);
    } catch (err) {
      fail(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_DB_STORE)) db.createObjectStore(DRAFT_DB_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (state !== 'pending') {
        // Mở xong sau khi đã bỏ cuộc (timeout/blocked) → đóng kết nối thừa
        db.close();
        return;
      }
      state = 'settled';
      clearTimeout(timer);
      // Tab khác nâng version → đóng kết nối để không chặn họ
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => fail(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => fail(new Error('IndexedDB open blocked'));
  });
}

export async function createIndexedDbDraftStore(factory: IDBFactory, timeoutMs = OPEN_TIMEOUT_MS): Promise<DraftStore> {
  let db = await openDatabase(factory, timeoutMs);
  if (!db.objectStoreNames.contains(DRAFT_DB_STORE)) {
    // DB đã có nhưng thiếu store (tạo bởi công cụ khác/phiên bản lỗi) → nâng version để tạo store
    const next = db.version + 1;
    db.close();
    db = await openDatabase(factory, timeoutMs, next);
  }
  const run = <T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(DRAFT_DB_STORE, mode);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('IndexedDB transaction failed'));
        return;
      }
      const req = op(tx.objectStore(DRAFT_DB_STORE));
      // Đọc: trả ngay khi request xong; ghi: chờ transaction commit (bền trước khi báo xong)
      req.onsuccess = () => {
        if (mode === 'readonly') resolve(req.result);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  return {
    kind: 'indexeddb',
    load: async (id) => ((await run('readonly', (s) => s.get(id))) as PersistedDraft | undefined) ?? null,
    save: async (id, data) => {
      await run('readwrite', (s) => s.put(data, id));
    },
    remove: async (id) => {
      await run('readwrite', (s) => s.delete(id));
    },
  };
}

let memorySingleton: DraftStore | null = null;
/** Một store bộ nhớ dùng chung trong trang (StrictMode mount 2 lần vẫn thấy cùng dữ liệu) */
export function sharedMemoryDraftStore(): DraftStore {
  memorySingleton ??= createMemoryDraftStore();
  return memorySingleton;
}

/**
 * Mở store tốt nhất có thể: IndexedDB nếu có và mở được trong `timeoutMs`, nếu không → bộ nhớ.
 * `factory` mặc định là `globalThis.indexedDB` (undefined trên server/Node).
 */
export async function openDraftStore(factory: IDBFactory | undefined | null = typeof indexedDB === 'undefined' ? undefined : indexedDB, timeoutMs = OPEN_TIMEOUT_MS): Promise<DraftStore> {
  if (!factory) return sharedMemoryDraftStore();
  try {
    return await createIndexedDbDraftStore(factory, timeoutMs);
  } catch {
    return sharedMemoryDraftStore();
  }
}

let browserStore: Promise<DraftStore> | null = null;
/** Store của trình duyệt, mở một lần mỗi trang */
export function browserDraftStore(): Promise<DraftStore> {
  browserStore ??= openDraftStore();
  return browserStore;
}
