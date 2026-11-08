/**
 * TOTP RFC 6238 (SHA1, 6 số, 30 s) cho "máy chủ" giả lập (S12 – MFA admin). Web Crypto HMAC-SHA1 (bất đồng bộ). Chỉ dev/e2e mock;
 * API thật tự cài TOTP ở `apps/api/src/modules/iam/mfa/totp.ts`. E2E tự tính mã bằng `node:crypto` từ khoá base32 hiển thị.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function randomBase32(len = 32): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => B32[b % 32]).join('');
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function totpAt(secret: string, step: number, digits = 6): Promise<string> {
  const counter = new Uint8Array(8);
  let x = step;
  for (let i = 7; i >= 0; i--) {
    counter[i] = x & 0xff;
    x = Math.floor(x / 256);
  }
  const key = await crypto.subtle.importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const off = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Mã đúng trong cửa sổ ±1 bước → trả bước khớp (chống replay ở nơi gọi), sai → null */
export async function verifyTotp(secret: string, code: string, now = Date.now(), window = 1): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30_000);
  for (let d = -window; d <= window; d++) if ((await totpAt(secret, step + d)) === code) return step + d;
  return null;
}
