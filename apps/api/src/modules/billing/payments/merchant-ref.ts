import { randomBytes } from 'node:crypto';

/**
 * Mã tham chiếu gửi cổng: base36(order_id 128 bit, 25 ký tự) + nonce 6 ký tự [0-9a-z] = 31 ký tự chữ-số.
 * - Mỗi lần POST /orders/{id}/pay sinh mã mới (VNPay cấm trùng vnp_TxnRef trong ngày; MoMo cấm trùng orderId).
 * - Suy ra được order_id ngay cả khi hàng payments `initiated` chưa tồn tại (webhook đến trước khi /pay trả về).
 * - Vừa giới hạn: VNPay TxnRef ≤ 100, MoMo orderId ≤ 50, ZaloPay app_trans_id = `yymmdd_` + 31 = 38 ≤ 40.
 */
const ORDER_PART = 25;
const NONCE_PART = 6;
export const MERCHANT_REF_LENGTH = ORDER_PART + NONCE_PART;
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function encodeMerchantRef(orderId: string, nonce?: string): string {
  const hex = orderId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) throw new Error('invalid order id');
  const base36 = BigInt(`0x${hex}`).toString(36).padStart(ORDER_PART, '0');
  const n = nonce ?? randomNonce();
  if (!/^[0-9a-z]{6}$/.test(n)) throw new Error('invalid nonce');
  return `${base36}${n}`;
}

export function randomNonce(): string {
  const bytes = randomBytes(NONCE_PART);
  let out = '';
  for (let i = 0; i < NONCE_PART; i++) out += ALPHABET[bytes[i]! % 36];
  return out;
}

/** Giải mã → order_id (uuid) hoặc null nếu sai định dạng */
export function decodeMerchantRef(ref: string | null | undefined): string | null {
  if (!ref || ref.length !== MERCHANT_REF_LENGTH || !/^[0-9a-z]+$/.test(ref)) return null;
  let n = 0n;
  for (const ch of ref.slice(0, ORDER_PART)) n = n * 36n + BigInt(ALPHABET.indexOf(ch));
  if (n >= 1n << 128n) return null;
  const hex = n.toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
