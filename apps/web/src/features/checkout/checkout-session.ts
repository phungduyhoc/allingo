import { randomKey } from '@/lib/random';
/**
 * Idempotency-Key ổn định cho MỘT phiên checkout (sessionStorage `allingo.checkout.<price_id>`): bấm "Thanh toán" lại / quay về từ
 * cổng / tải lại trang gửi cùng khoá + cùng body → API trả lại đơn cũ (200) thay vì tạo đơn mới. Đổi body (mã khác, thông tin hoá
 * đơn khác) → API 409 `idempotency_key_reused` → xoay khoá rồi gửi lại. Đơn đã thanh toán → xoá mọi khoá (lần mua sau là phiên mới).
 */

const PREFIX = 'allingo.checkout.';

function newKey(): string {
  return randomKey();
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const memory = new Map<string, string>();

export function checkoutKey(priceId: string): string {
  const s = store();
  try {
    const existing = s?.getItem(PREFIX + priceId) ?? memory.get(priceId);
    if (existing) return existing;
  } catch {
    /* bỏ qua */
  }
  const key = newKey();
  try {
    s?.setItem(PREFIX + priceId, key);
  } catch {
    /* bỏ qua */
  }
  memory.set(priceId, key);
  return key;
}

export function rotateCheckoutKey(priceId: string): string {
  const key = newKey();
  try {
    store()?.setItem(PREFIX + priceId, key);
  } catch {
    /* bỏ qua */
  }
  memory.set(priceId, key);
  return key;
}

export function clearCheckoutKeys(): void {
  memory.clear();
  const s = store();
  if (!s) return;
  try {
    for (const k of Object.keys(s)) if (k.startsWith(PREFIX)) s.removeItem(k);
  } catch {
    /* bỏ qua */
  }
}
