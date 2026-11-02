/**
 * Client Socket.IO tối giản (giao thức Engine.IO v4 + Socket.IO v5) qua WebSocket gốc của trình duyệt – đủ cho kênh một chiều
 * server → client của API (`/ws`: order.updated, credits.changed, entitlements.changed, notification.new…). Không thêm thư viện
 * `socket.io-client` (chỉ cần nhận sự kiện; không ack/binary). Xác thực: cookie `allingo_at` (path `/`, cùng site
 * localhost/allingo.vn) gửi kèm handshake; server ngắt (`41`) khi token hết hạn → client gọi refresh rồi kết nối lại.
 *
 * Khung Engine.IO: `0{open}` · `2` ping → `3` pong · `4<socket.io packet>`; packet Socket.IO: `0` CONNECT, `1` DISCONNECT,
 * `2` EVENT `["tên", dữ liệu]`, `4` CONNECT_ERROR; namespace `/ws,` đứng trước dữ liệu, id ack (chữ số) tuỳ chọn.
 */

export type SocketFrame =
  | { kind: 'open'; pingInterval: number; pingTimeout: number }
  | { kind: 'ping' }
  | { kind: 'close' }
  | { kind: 'connect'; nsp: string }
  | { kind: 'disconnect'; nsp: string }
  | { kind: 'connect_error'; nsp: string; message: string | null }
  | { kind: 'event'; nsp: string; event: string; data: unknown }
  | { kind: 'other' };

/** Phân tích một khung văn bản Engine.IO/Socket.IO (thuần, có test) */
export function parseSocketFrame(frame: string): SocketFrame {
  const eio = frame.charAt(0);
  if (eio === '0') {
    try {
      const o = JSON.parse(frame.slice(1)) as { pingInterval?: number; pingTimeout?: number };
      return { kind: 'open', pingInterval: o.pingInterval ?? 25_000, pingTimeout: o.pingTimeout ?? 20_000 };
    } catch {
      return { kind: 'open', pingInterval: 25_000, pingTimeout: 20_000 };
    }
  }
  if (eio === '1') return { kind: 'close' };
  if (eio === '2') return { kind: 'ping' };
  if (eio !== '4') return { kind: 'other' };
  const type = frame.charAt(1);
  let rest = frame.slice(2);
  let nsp = '/';
  if (rest.startsWith('/')) {
    const comma = rest.indexOf(',');
    if (comma < 0) {
      nsp = rest;
      rest = '';
    } else {
      nsp = rest.slice(0, comma);
      rest = rest.slice(comma + 1);
    }
  }
  // id ack (chữ số trước JSON) – bỏ qua
  rest = rest.replace(/^\d+/, '');
  const json = (): unknown => {
    if (!rest) return null;
    try {
      return JSON.parse(rest);
    } catch {
      return null;
    }
  };
  if (type === '0') return { kind: 'connect', nsp };
  if (type === '1') return { kind: 'disconnect', nsp };
  if (type === '4') {
    const d = json() as { message?: unknown } | null;
    return { kind: 'connect_error', nsp, message: typeof d?.message === 'string' ? d.message : null };
  }
  if (type === '2') {
    const arr = json();
    if (Array.isArray(arr) && typeof arr[0] === 'string') return { kind: 'event', nsp, event: arr[0], data: arr[1] ?? null };
  }
  return { kind: 'other' };
}

/** URL WebSocket của Socket.IO từ base URL API (`http://host:4000/v1` → `ws://host:4000/socket.io/?EIO=4&transport=websocket`) */
export function socketUrl(apiUrl: string): string {
  const u = new URL(apiUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = '/socket.io/';
  u.search = '?EIO=4&transport=websocket';
  return u.toString();
}

/** Thời gian chờ kết nối lại (lũy thừa 2, tối đa 30 s, ±20 % ngẫu nhiên) */
export function reconnectDelay(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';
type Listener = (data: unknown) => void;

export interface RealtimeClientOptions {
  url: string;
  namespace?: string;
  /**
   * Gọi khi server ngắt/không nhận namespace (token hết hạn) – trả true nếu phiên còn hợp lệ. Nên đi qua API client chung
   * (vd. GET /me) để dùng chung cơ chế refresh đã khử trùng lặp – tránh hai lần refresh xoay vòng cùng lúc.
   */
  refreshSession?: () => Promise<boolean>;
  onStatus?: (s: RealtimeStatus) => void;
  WebSocketImpl?: typeof WebSocket;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly nsp: string;
  status: RealtimeStatus = 'idle';

  constructor(private readonly opts: RealtimeClientOptions) {
    this.nsp = opts.namespace ?? '/ws';
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.open();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= 1) ws.close();
    this.setStatus('idle');
  }

  private setStatus(s: RealtimeStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private clearTimers(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearTimeout(this.pingTimer);
    this.timer = null;
    this.pingTimer = null;
  }

  private emit(event: string, data: unknown): void {
    for (const fn of this.listeners.get(event) ?? []) {
      try {
        fn(data);
      } catch {
        /* lỗi của listener không làm đứt kết nối */
      }
    }
  }

  private open(): void {
    if (this.stopped) return;
    const WS = this.opts.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WS(this.opts.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // Bị đóng trước khi vào được namespace (server từ chối token) → làm mới phiên trước khi thử lại
    let refreshNeeded = true;
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      const f = parseSocketFrame(ev.data);
      switch (f.kind) {
        case 'open':
          ws.send(`40${this.nsp},`);
          this.armPing(f.pingInterval + f.pingTimeout);
          break;
        case 'ping':
          ws.send('3');
          this.armPing();
          break;
        case 'connect':
          if (f.nsp === this.nsp) {
            refreshNeeded = false;
            this.attempt = 0;
            this.setStatus('connected');
            this.emit('connect', null);
          }
          break;
        case 'disconnect':
        case 'connect_error':
          // Server ngắt namespace: chưa đăng nhập / token hết hạn → làm mới phiên rồi kết nối lại
          refreshNeeded = true;
          ws.close();
          break;
        case 'event':
          if (f.nsp === this.nsp) this.emit(f.event, f.data);
          break;
        case 'close':
          ws.close();
          break;
        default:
          break;
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      if (this.stopped) return;
      this.setStatus('disconnected');
      this.emit('disconnect', null);
      if (refreshNeeded && this.opts.refreshSession) {
        void this.opts.refreshSession().finally(() => this.scheduleReconnect());
      } else this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose xử lý kết nối lại */
    };
  }

  private lastPingWindow = 45_000;
  private armPing(windowMs?: number): void {
    if (windowMs) this.lastPingWindow = windowMs;
    if (this.pingTimer) clearTimeout(this.pingTimer);
    // Không nhận ping trong pingInterval + pingTimeout → coi như mất kết nối
    this.pingTimer = setTimeout(() => this.ws?.close(), this.lastPingWindow + 1_000);
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = reconnectDelay(this.attempt++);
    this.timer = setTimeout(() => this.open(), delay);
  }
}

/** Sự kiện window mà API giả lập (NEXT_PUBLIC_API_MOCK=1) phát thay cho Socket.IO */
export const MOCK_REALTIME_EVENT = 'allingo:mock-realtime';
export interface MockRealtimeDetail {
  event: string;
  data: unknown;
}
