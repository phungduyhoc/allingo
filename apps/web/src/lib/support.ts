import { SUPPORT_FIRST_RESPONSE_SLA_HOURS } from '@allingo/schemas';

/**
 * Hỗ trợ (S12): SLA phản hồi đầu 24 giờ (`first_response_due_at`), trạng thái open → waiting_user (admin trả lời) → open (người
 * học trả lời) → resolved/closed (A202). Hàm thuần dựng nhãn SLA cho người học và admin – mốc giờ do server tính.
 */

export { SUPPORT_FIRST_RESPONSE_SLA_HOURS };

export interface SlaInput {
  status: 'open' | 'waiting_user' | 'resolved' | 'closed';
  first_response_due_at: string | null;
  first_responded_at: string | null;
}

export type SlaState =
  | { state: 'responded'; at: string }
  | { state: 'pending'; dueAt: string; hoursLeft: number }
  | { state: 'overdue'; dueAt: string; hoursOver: number }
  | { state: 'none' };

export function ticketSla(t: SlaInput, now = Date.now()): SlaState {
  if (t.first_responded_at) return { state: 'responded', at: t.first_responded_at };
  if (t.status === 'resolved' || t.status === 'closed' || !t.first_response_due_at) return { state: 'none' };
  const due = Date.parse(t.first_response_due_at);
  if (!Number.isFinite(due)) return { state: 'none' };
  const diffH = (due - now) / 3_600_000;
  if (diffH >= 0) return { state: 'pending', dueAt: t.first_response_due_at, hoursLeft: Math.max(1, Math.ceil(diffH)) };
  return { state: 'overdue', dueAt: t.first_response_due_at, hoursOver: Math.max(1, Math.ceil(-diffH)) };
}

/** Người học trả lời được (closed → 409 `ticket_closed`) */
export function canReply(status: SlaInput['status']): boolean {
  return status !== 'closed';
}

export const TICKET_STATUS_VARIANT: Record<SlaInput['status'], 'gold' | 'secondary' | 'success' | 'muted'> = {
  open: 'gold',
  waiting_user: 'secondary',
  resolved: 'success',
  closed: 'muted',
};
