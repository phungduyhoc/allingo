/**
 * Sinh ngẫu nhiên mật mã cho id/khoá phía trình duyệt (Web Crypto `getRandomValues` – có cả trên http không bảo mật
 * và Node ≥ 19; `randomUUID` chỉ có trong ngữ cảnh bảo mật). Không dùng Math.random cho id/khoá idempotency.
 */
export function randomHex(bytes = 16): string {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** UUID v4 khi trình duyệt hỗ trợ, ngược lại 32 ký tự hex ngẫu nhiên (cùng độ entropy 128 bit) */
export function randomKey(): string {
  return typeof globalThis.crypto.randomUUID === 'function' ? globalThis.crypto.randomUUID() : randomHex(16);
}
