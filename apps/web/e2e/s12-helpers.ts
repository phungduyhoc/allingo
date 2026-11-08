import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { resolve } from 'node:path';
import { expect, type Browser, type Page } from '@playwright/test';
import { REAL } from './helpers';
import { adminApi, ADMIN, loginViaUi, logoutViaUi, PASSWORD } from './billing-helpers';

/**
 * Tiện ích E2E Sprint 12 (beta kín, hỗ trợ, admin vận hành, MFA). Chạy được với API giả lập (mặc định) và API thật (E2E_REAL_API=1).
 *  - Hook mock: `window.__ALLINGO_MOCK__.<tên>(...)` (mã mời trong "hộp thư giả", bật step-up MFA, ép NPS, thêm DLQ, đặt cờ).
 *  - API thật: cờ qua admin API (luôn khôi phục), mã mời đọc từ email thật bằng SMTP sink cục bộ (:1025 – SMTP_HOST/PORT dev),
 *    SQL dev qua psql (cấp vai trò admin tạm cho tài khoản E2E để thử MFA – không đụng tài khoản demo).
 *  - TOTP RFC 6238 tính bằng `node:crypto` (độc lập với mã của web/API).
 */

export async function mockHook<T = unknown>(page: Page, name: string, ...args: unknown[]): Promise<T> {
  await page.waitForFunction((n) => typeof (window as unknown as { __ALLINGO_MOCK__?: Record<string, unknown> }).__ALLINGO_MOCK__?.[n] === 'function', name);
  return page.evaluate(([n, a]) => (window as unknown as { __ALLINGO_MOCK__: Record<string, (...x: unknown[]) => unknown> }).__ALLINGO_MOCK__[n]!(...(a)), [name, args] as const) as Promise<T>;
}

// ----------------------------------------------------------------------------- cờ (luôn trả lại trạng thái cũ)
export interface FlagState {
  enabled: boolean;
  rules: Record<string, unknown>;
}

export async function getFlagReal(key: string): Promise<FlagState> {
  const admin = await adminApi();
  try {
    const res = await admin.get(`admin/flags/${key}`);
    expect(res.status(), await res.text()).toBe(200);
    const b = (await res.json()) as { enabled: boolean; rules?: Record<string, unknown> };
    return { enabled: b.enabled, rules: b.rules ?? {} };
  } finally {
    await admin.dispose();
  }
}

export async function putFlagReal(key: string, body: FlagState): Promise<void> {
  const admin = await adminApi();
  try {
    const res = await admin.put(`admin/flags/${key}`, { data: body });
    expect(res.status(), await res.text()).toBe(200);
  } finally {
    await admin.dispose();
  }
}

/** Bật/tắt cờ; API thật giữ `rules` (mock: hook setFlag) */
export async function setFlag(page: Page, key: string, enabled: boolean, rules?: Record<string, unknown>): Promise<void> {
  if (REAL) {
    const prev = await getFlagReal(key);
    await putFlagReal(key, { enabled, rules: rules ?? prev.rules });
    return;
  }
  await mockHook(page, 'setFlag', key, enabled);
}

// ----------------------------------------------------------------------------- SQL dev (chỉ API thật)
function repoEnv(): Record<string, string> {
  const file = resolve(process.cwd(), '../../.env');
  if (!existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]!] = m[2]!.replace(/\s+#.*$/, '').replace(/^"|"$/g, '');
  }
  return out;
}

/** Chạy một câu SQL trên DB dev (E2E_DATABASE_URL hoặc DATABASE_URL của .env gốc) – trả stdout dạng không căn lề */
export function psql(sql: string): string {
  const url = process.env.E2E_DATABASE_URL ?? repoEnv().DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
  return execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { stdio: 'pipe' }).toString().trim();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(id: string): string {
  if (!UUID.test(id)) throw new Error(`bad uuid ${id}`);
  return id;
}

// ----------------------------------------------------------------------------- TOTP RFC 6238 (node:crypto)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32ToBuffer(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=]/g, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secret: string, at = Date.now(), stepSec = 30, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / stepSec)));
  const mac = createHmac('sha1', base32ToBuffer(secret)).update(counter).digest();
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Mã của bước 30 s kế tiếp chưa dùng (API chống replay theo bước) – chờ sang bước mới nếu cần */
export async function freshTotp(secret: string, usedSteps: Set<number>): Promise<string> {
  for (;;) {
    const step = Math.floor(Date.now() / 30_000);
    // Tránh sát biên bước (đồng hồ lệch vài trăm ms)
    if (!usedSteps.has(step) && Date.now() % 30_000 < 27_000) {
      usedSteps.add(step);
      return totp(secret);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ----------------------------------------------------------------------------- SMTP sink (API thật gửi email mời qua SMTP_HOST:SMTP_PORT dev)
export interface SmtpSink {
  messages: Array<{ to: string[]; raw: string; text: string }>;
  waitFor: (pred: (m: { to: string[]; text: string }) => boolean, timeoutMs?: number) => Promise<{ to: string[]; text: string }>;
  close: () => Promise<void>;
}

/** Giải mã MIME đơn giản (quoted-printable / base64 từng phần) để tìm mã mời trong email */
export function decodeMime(raw: string): string {
  const parts = raw.split(/\r?\n--[^\r\n]+\r?\n/);
  const out: string[] = [];
  for (const part of parts) {
    const [head, ...bodyLines] = part.split(/\r?\n\r?\n/);
    const body = bodyLines.join('\n\n');
    const cte = /content-transfer-encoding:\s*([\w-]+)/i.exec(head ?? '')?.[1]?.toLowerCase();
    if (cte === 'base64') out.push(Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8'));
    else if (cte === 'quoted-printable') out.push(Buffer.from(body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8'));
    else out.push(body);
  }
  return out.join('\n');
}

export async function startSmtpSink(port = Number(process.env.E2E_SMTP_PORT ?? 1025)): Promise<SmtpSink> {
  const messages: SmtpSink['messages'] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    let buf = '';
    let inData = false;
    let data = '';
    let rcpt: string[] = [];
    const reply = (s: string) => sock.write(`${s}\r\n`);
    reply('220 allingo-e2e-sink ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('latin1');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          data += buf.slice(0, end);
          buf = buf.slice(end + 5);
          inData = false;
          const raw = Buffer.from(data, 'latin1').toString('utf8');
          messages.push({ to: rcpt, raw, text: decodeMime(raw) });
          data = '';
          rcpt = [];
          reply('250 OK queued');
          continue;
        }
        const nl = buf.indexOf('\r\n');
        if (nl < 0) return;
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') {
          reply('250-allingo-e2e-sink');
          reply('250 8BITMIME');
        } else if (cmd === 'HELO') reply('250 allingo-e2e-sink');
        else if (cmd === 'MAIL') reply('250 OK');
        else if (cmd === 'RCPT') {
          const m = /<([^>]+)>/.exec(line);
          if (m) rcpt.push(m[1]!.toLowerCase());
          reply('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          reply('354 End data with <CR><LF>.<CR><LF>');
        } else if (cmd === 'RSET') {
          rcpt = [];
          reply('250 OK');
        } else if (cmd === 'QUIT') {
          reply('221 Bye');
          sock.end();
        } else reply('250 OK');
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(port, '127.0.0.1', () => res());
  });
  return {
    messages,
    waitFor: async (pred, timeoutMs = 20_000) => {
      const t0 = Date.now();
      for (;;) {
        const hit = messages.find((m) => pred(m));
        if (hit) return hit;
        if (Date.now() - t0 > timeoutMs) throw new Error(`SMTP sink: không thấy email (đã nhận ${messages.length})`);
        await new Promise((r) => setTimeout(r, 300));
      }
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export const INVITE_RE = /ALG-[A-Z0-9]{4}-[A-Z0-9]{4}/;

// ----------------------------------------------------------------------------- phiên admin song song (API thật) / đổi tài khoản (mock)
/**
 * Chạy bước admin: API thật → context trình duyệt riêng đã đăng nhập admin (phiên người học không đổi); mock → "máy chủ" giả nằm
 * trong localStorage của từng context nên đổi tài khoản ngay trên trang (đăng xuất → admin → làm → đăng xuất → đăng nhập lại).
 */
export async function asAdmin<T>(browser: Browser, page: Page, back: { email: string; password?: string } | null, fn: (admin: Page) => Promise<T>): Promise<T> {
  if (REAL) {
    const ctx = await browser.newContext({ locale: 'vi-VN' });
    const admin = await ctx.newPage();
    try {
      await loginViaUi(admin, ADMIN.email, ADMIN.password);
      return await fn(admin);
    } finally {
      await ctx.close();
    }
  }
  if (back) await logoutViaUi(page);
  await loginViaUi(page, ADMIN.email, ADMIN.password);
  try {
    return await fn(page);
  } finally {
    await logoutViaUi(page);
    if (back) await loginBack(page, back.email, back.password ?? PASSWORD);
  }
}

/** Đăng nhập lại (không chờ dashboard – có thể bị chuyển tới /beta khi gate bật) */
export async function loginBack(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto('/vi/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
}

/** Ảnh PNG 1×1 hợp lệ (ảnh màn hình đính kèm góp ý) */
export const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
