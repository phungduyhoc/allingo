/**
 * Phân bổ credit theo "lô" từ ledger append-only (Sprint 7) – thuần, không I/O. Dùng cho:
 *  - job credit.expire: lô gói credit (purchase, expires_at = mua + 12 tháng) hết hạn → ghi `expire` đúng phần CÒN LẠI
 *  - hoàn tiền: thu hồi phần còn lại của lô do đơn cấp
 * Quy tắc tiêu (FIFO theo hạn – có lợi cho người học): tiêu lô sắp hết hạn trước, lô không hạn sau cùng, cùng hạn theo thứ tự cấp.
 * Lô đã quá hạn nhưng job chưa ghi `expire` chỉ bị tiêu khi lô còn hạn đã cạn (số dư vẫn tính lô đó).
 * Dòng âm có tham chiếu lô (`expire`/`refund` của đơn) trừ vào đúng lô đó trước.
 */
export interface LedgerLike {
  id: number;
  delta: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface CreditLot {
  ledgerId: number;
  amount: number;
  remaining: number;
  expiresAt: Date | null;
  refKey: string | null;
  reason: string;
}

const refKey = (r: Pick<LedgerLike, 'refType' | 'refId'>) => (r.refType && r.refId ? `${r.refType}:${r.refId}` : null);

function take(lots: CreditLot[], amount: number): number {
  let left = amount;
  for (const lot of lots) {
    if (left <= 0) break;
    const d = Math.min(lot.remaining, left);
    lot.remaining -= d;
    left -= d;
  }
  return left;
}

export function replayLots(rows: readonly LedgerLike[]): CreditLot[] {
  const lots: CreditLot[] = [];
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (r.delta > 0) {
      lots.push({ ledgerId: r.id, amount: r.delta, remaining: r.delta, expiresAt: r.expiresAt, refKey: refKey(r), reason: r.reason });
      continue;
    }
    if (r.delta === 0) continue;
    let need = -r.delta;
    const key = refKey(r);
    if (key && (r.reason === 'expire' || r.reason === 'refund')) {
      need = take(lots.filter((l) => l.refKey === key && l.remaining > 0), need);
    }
    if (need <= 0) continue;
    const at = r.createdAt.getTime();
    const order = (a: CreditLot, b: CreditLot) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity) || a.ledgerId - b.ledgerId;
    const active = lots.filter((l) => l.remaining > 0 && (!l.expiresAt || l.expiresAt.getTime() > at)).sort(order);
    need = take(active, need);
    if (need > 0) take(lots.filter((l) => l.remaining > 0).sort(order), need);
  }
  return lots;
}

/** Phần còn lại của các lô có tham chiếu `refType:refId` (vd `order:<id>`) */
export function remainingFor(rows: readonly LedgerLike[], ref: { refType: string; refId: string }): number {
  const key = `${ref.refType}:${ref.refId}`;
  return replayLots(rows)
    .filter((l) => l.refKey === key)
    .reduce((s, l) => s + l.remaining, 0);
}
