import { describe, expect, it } from 'vitest';
import { canReply, ticketSla } from './support';

const NOW = Date.parse('2026-11-08T05:00:00Z');
const at = (h: number) => new Date(NOW + h * 3_600_000).toISOString();

describe('SLA ticket hỗ trợ (24 giờ – S12)', () => {
  it('đã phản hồi / còn hạn / quá hạn / đã đóng', () => {
    expect(ticketSla({ status: 'waiting_user', first_response_due_at: at(10), first_responded_at: at(-1) }, NOW)).toEqual({ state: 'responded', at: at(-1) });
    expect(ticketSla({ status: 'open', first_response_due_at: at(5.2), first_responded_at: null }, NOW)).toEqual({ state: 'pending', dueAt: at(5.2), hoursLeft: 6 });
    expect(ticketSla({ status: 'open', first_response_due_at: at(-3.5), first_responded_at: null }, NOW)).toEqual({ state: 'overdue', dueAt: at(-3.5), hoursOver: 4 });
    expect(ticketSla({ status: 'closed', first_response_due_at: at(-3), first_responded_at: null }, NOW)).toEqual({ state: 'none' });
    expect(ticketSla({ status: 'open', first_response_due_at: null, first_responded_at: null }, NOW)).toEqual({ state: 'none' });
  });
  it('ticket đã đóng không trả lời được (API 409 ticket_closed)', () => {
    expect(canReply('closed')).toBe(false);
    expect(canReply('resolved')).toBe(true);
  });
});
