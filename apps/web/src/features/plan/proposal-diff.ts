import type { PlanAdjustProposal, PlanTask } from '@allingo/schemas';

/**
 * So sánh trước/sau của đề xuất điều chỉnh (thuần, có test): mỗi task thay đổi → một dòng (bỏ / dời ngày / giảm phút / thêm).
 * Dựa trên `before`/`after` đầy đủ của server (nguồn sự thật), `changes` chỉ dùng để giữ thứ tự khi có.
 */

export type DiffKind = 'removed' | 'moved' | 'reduced' | 'increased' | 'added' | 'restored';

export interface DiffItem {
  task_id: string;
  task: PlanTask;
  kinds: DiffKind[];
  date_before: string | null;
  date_after: string | null;
  minutes_before: number | null;
  minutes_after: number | null;
}

const active = (t: PlanTask | undefined) => !!t && t.status !== 'skipped' && t.status !== 'expired';

export function proposalDiff(p: Pick<PlanAdjustProposal, 'before' | 'after' | 'changes'>): DiffItem[] {
  const before = new Map(p.before.map((t) => [t.id, t]));
  const after = new Map(p.after.map((t) => [t.id, t]));
  const ids = [...new Set([...p.changes.map((c) => c.task_id), ...after.keys(), ...before.keys()])];
  const out: DiffItem[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const kinds: DiffKind[] = [];
    if (!b && a) kinds.push('added');
    else if (b && (!a || (active(b) && !active(a)))) kinds.push('removed');
    else if (b && a && !active(b) && active(a)) kinds.push('restored');
    if (b && a && active(a)) {
      if (b.due_date !== a.due_date) kinds.push('moved');
      if (a.est_minutes < b.est_minutes) kinds.push('reduced');
      else if (a.est_minutes > b.est_minutes) kinds.push('increased');
    }
    if (!kinds.length) continue;
    const task = a ?? b!;
    out.push({ task_id: id, task, kinds, date_before: b?.due_date ?? null, date_after: a && active(a) ? a.due_date : null, minutes_before: b ? b.est_minutes : null, minutes_after: a && active(a) ? a.est_minutes : null });
  }
  return out.sort((x, y) => (x.date_before ?? x.date_after ?? '').localeCompare(y.date_before ?? y.date_after ?? ''));
}

/** Đề xuất `ready` đã quá `expires_at` (server sẽ chuyển `expired` khi đọc/áp dụng) → coi như hết hạn ở UI */
export function effectiveStatus(p: Pick<PlanAdjustProposal, 'status' | 'expires_at'>, now: number = Date.now()): PlanAdjustProposal['status'] {
  if ((p.status === 'ready' || p.status === 'pending' || p.status === 'needs_clarification') && Date.parse(p.expires_at) <= now) return 'expired';
  return p.status;
}

/** Tóm tắt số lượng theo loại thay đổi (hiển thị "Bỏ 5 · Dời 2 · Giảm 1") */
export function diffSummary(items: readonly DiffItem[]): Record<DiffKind, number> {
  const s: Record<DiffKind, number> = { removed: 0, moved: 0, reduced: 0, increased: 0, added: 0, restored: 0 };
  for (const i of items) for (const k of i.kinds) s[k] += 1;
  return s;
}
