'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bot, Headset, UserRound } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Alert, AlertDescription, Badge, Button, cn, Label, Spinner, Textarea } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { getErrorCode } from '@/lib/errors';
import { getMyTicket, replyMyTicket, s12Keys, type SupportTicket } from '@/lib/s12-api';
import { canReply, TICKET_STATUS_VARIANT } from '@/lib/support';
import { CardSkeleton, ErrorState } from '@/components/states';
import { SlaChip } from './support-page';

/**
 * Luồng tin nhắn ticket `/support/tickets/{id}` (S12 – đích thông báo `support.reply`): hội thoại 2 chiều, trạng thái, SLA,
 * trả lời (`POST /support/tickets/{id}/messages` – ticket resolved/waiting_user mở lại; closed → 409 `ticket_closed`). Tự làm
 * mới 30 s khi tab hiện để thấy trả lời của đội hỗ trợ (kèm thông báo realtime ở chuông).
 */
export function TicketPage({ ticketId }: { ticketId: string }) {
  const t = useTranslations('support');
  const fmt = useFormatter();
  const ticket = useQuery({ queryKey: s12Keys.myTicket(ticketId), queryFn: () => getMyTicket(ticketId), refetchInterval: 30_000, refetchOnWindowFocus: true });
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="ticket-page">
      <Link href="/support" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        {t('backToList')}
      </Link>
      {ticket.isPending ? (
        <CardSkeleton lines={5} />
      ) : ticket.isError ? (
        <ErrorState error={ticket.error} onRetry={() => void ticket.refetch()} />
      ) : (
        <>
          <header className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight break-words" data-testid="ticket-subject">
              {ticket.data.subject}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={TICKET_STATUS_VARIANT[ticket.data.status]} data-testid="ticket-status" data-status={ticket.data.status}>
                {t(`status.${ticket.data.status}`)}
              </Badge>
              <span>{t(`categories.${ticket.data.category}`)}</span>
              <span>· {t('createdAt', { date: fmt.dateTime(new Date(ticket.data.created_at), { dateStyle: 'medium', timeStyle: 'short' }) })}</span>
              <span>
                · <code className="font-mono text-xs">#{ticket.data.id.slice(0, 8)}</code>
              </span>
              <SlaChip ticket={ticket.data} />
            </div>
          </header>
          <Thread ticket={ticket.data} />
          <ReplyBox ticket={ticket.data} />
        </>
      )}
    </div>
  );
}

function Thread({ ticket }: { ticket: SupportTicket }) {
  const t = useTranslations('support');
  const fmt = useFormatter();
  const messages = ticket.messages ?? [];
  return (
    <ol className="space-y-3" aria-label={t('threadLabel')} aria-live="polite" data-testid="ticket-thread">
      {messages.map((m) => {
        const mine = m.author === 'user';
        const Icon = m.author === 'agent' ? Headset : m.author === 'system' ? Bot : UserRound;
        return (
          <li key={m.id} className={cn('flex gap-3', mine && 'flex-row-reverse')} data-testid="ticket-message" data-author={m.author}>
            <span className={cn('mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full', mine ? 'bg-secondary' : m.author === 'agent' ? 'bg-navy text-navy-foreground' : 'bg-muted')} aria-hidden>
              <Icon className="size-4" />
            </span>
            <div className={cn('max-w-[85%] min-w-0 rounded-xl border px-4 py-3', mine ? 'border-border bg-secondary/40' : m.author === 'agent' ? 'border-navy/30 bg-card' : 'border-dashed border-border bg-muted/40')}>
              <p className="mb-1 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{t(`author.${m.author}`)}</span> · {fmt.dateTime(new Date(m.created_at), { dateStyle: 'short', timeStyle: 'short' })}
              </p>
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ReplyBox({ ticket }: { ticket: SupportTicket }) {
  const t = useTranslations('support');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const id = React.useId();
  const [text, setText] = React.useState('');
  const reply = useMutation({
    mutationFn: () => replyMyTicket(ticket.id, text.trim()),
    onSuccess: (updated) => {
      setText('');
      qc.setQueryData(s12Keys.myTicket(ticket.id), updated);
      void qc.invalidateQueries({ queryKey: s12Keys.myTickets });
    },
  });
  if (!canReply(ticket.status)) {
    return (
      <Alert data-testid="ticket-closed">
        <AlertDescription>
          {t('closedNote')}{' '}
          <Link href="/support" className="font-semibold text-primary underline-offset-4 hover:underline">
            {t('newTicketLink')}
          </Link>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && !reply.isPending) reply.mutate();
      }}
    >
      <Label htmlFor={`${id}-reply`}>{t('replyLabel')}</Label>
      <Textarea id={`${id}-reply`} rows={4} value={text} onChange={(e) => setText(e.target.value.slice(0, 8000))} data-testid="ticket-reply-input" />
      {ticket.status === 'resolved' ? <p className="text-xs text-muted-foreground">{t('reopenNote')}</p> : null}
      {reply.isError ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {getErrorCode(reply.error) === 'conflict' ? t('closedNote') : te(`codes.${getErrorCode(reply.error)}`)}
        </p>
      ) : null}
      <Button type="submit" variant="navy" disabled={!text.trim() || reply.isPending} data-testid="ticket-reply-submit">
        {reply.isPending ? <Spinner aria-hidden /> : null}
        {t('send')}
      </Button>
    </form>
  );
}
