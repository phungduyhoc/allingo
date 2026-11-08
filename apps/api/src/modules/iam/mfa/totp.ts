import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) / HOTP (RFC 4226) tự cài – không thêm thư viện (S12, pentest-1). Base32 theo RFC 4648 (không padding).
 * Test vector chính thức RFC 4226 Phụ lục D và RFC 6238 Phụ lục B nằm trong test/unit/s12-mfa-password.test.ts.
 */
export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP: HMAC(secret, counter 8 byte big-endian) → dynamic truncation → `digits` chữ số */
export function hotp(secret: Buffer, counter: number | bigint, digits = 6, algorithm: TotpAlgorithm = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
  period?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
}

export function totpStep(timeMs: number, period = 30): number {
  return Math.floor(timeMs / 1000 / period);
}

export function totp(secret: Buffer, timeMs: number, opts: TotpOptions = {}): string {
  return hotp(secret, totpStep(timeMs, opts.period ?? 30), opts.digits ?? 6, opts.algorithm ?? 'sha1');
}

/**
 * Xác minh mã trong cửa sổ ±window bước (lệch đồng hồ). `lastUsedStep` chống dùng lại: bước ≤ bước đã dùng bị từ chối.
 * So sánh hằng thời gian; trả bước khớp để lưu lại.
 */
export function verifyTotp(secret: Buffer, code: string, timeMs: number, opts: TotpOptions & { window?: number; lastUsedStep?: number | null } = {}): { ok: true; step: number } | { ok: false; reason: 'invalid' | 'replayed' } {
  const digits = opts.digits ?? 6;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) return { ok: false, reason: 'invalid' };
  const current = totpStep(timeMs, opts.period ?? 30);
  const window = opts.window ?? 1;
  let replayed = false;
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (step < 0) continue;
    const expected = hotp(secret, step, digits, opts.algorithm ?? 'sha1');
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(code))) {
      if (opts.lastUsedStep !== null && opts.lastUsedStep !== undefined && step <= opts.lastUsedStep) {
        replayed = true;
        continue;
      }
      return { ok: true, step };
    }
  }
  return { ok: false, reason: replayed ? 'replayed' : 'invalid' };
}

export function newTotpSecret(bytes = 20): Buffer {
  return randomBytes(bytes);
}

/** otpauth://totp/<issuer>:<account>?secret=…&issuer=…&algorithm=SHA1&digits=6&period=30 (Key Uri Format) */
export function otpauthUrl(input: { issuer: string; account: string; secretBase32: string; digits?: number; period?: number }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const q = new URLSearchParams({ secret: input.secretBase32, issuer: input.issuer, algorithm: 'SHA1', digits: String(input.digits ?? 6), period: String(input.period ?? 30) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Mã khôi phục dạng XXXXX-XXXXX (base32, 50 bit) */
export function newRecoveryCode(): string {
  const s = base32Encode(randomBytes(7)).slice(0, 10);
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}
