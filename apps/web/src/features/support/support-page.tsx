'use client';

import * as React from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Clock, LifeBuoy, MessageSquareText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { SUPPORT_CATEGORIES, supportTicketInputSchema, type SupportTicketInput } from '@allingo/schemas/api/s12';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Spinner, Textarea } from '@allingo/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import { feedbackPagePath } from '@/lib/feedback';
import { createSupportTicket, listMyTickets, s12Keys, type SupportTicket } from '@/lib/s12-api';
import { SUPPORT_FIRST_RESPONSE_SLA_HOURS, TICKET_STATUS_VARIANT, ticketSla } from '@/lib/support';
import { latestTraceId } from '@/lib/telemetry/last-trace';
import { useClientValue } from '@/lib/use-mounted';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState } from '@/components/states';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trung tâm hỗ trợ `/support` (S12): tạo ticket (`POST /support/tickets` – không bị beta gate chặn, SLA phản hồi đầu 24 giờ) và
 * danh sách ticket của tôi (`GET /me/support/tickets`, cursor). Ngữ cảnh kỹ thuật tuỳ chọn: trace gần nhất, `?attempt=` (từ màn
 * kết quả/bài làm), trang đến từ `?from=` (chỉ đường dẫn, không query). Tài khoản khách cần đăng ký (API yêu cầu tài khoản).
 */
export function SupportPage() {
  const t = useTranslations('support');
  const me = useMe();
  return (
    <div className="space-y-8" data-testid="support-page">
      <PageHeader title={t('title')} description={t('subtitle', { hours: SUPPORT_FIRST_RESPONSE_SLA_HOURS })} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0 space-y-6">
          {me.data?.is_guest ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('guestTitle')}</CardTitle>
                <CardDescription>{t('guestDesc')}</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <NewTicketForm />
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('otherChannels')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>{t('hintFeedback')}</p>
              <p>{t('hintReport')}</p>
              <p>
                <Link href="/legal/refund" className="font-medium text-primary underline-offset-4 hover:underline">
                  {t('refundLink')}
                </Link>
                {' · '}
                <Link href="/legal/privacy" className="font-medium text-primary underline-offset-4 hover:underline">
                  {t('privacyLink')}
                </Link>
              </p>
            </CardContent>
          </Card>
        </div>
        <MyTickets />
      </div>
    </div>
  );
}

function NewTicketForm() {
  const t = useTranslations('support');
  const te = useTranslations('errors');
  const router = useRouter();
  const qc = useQueryClient();
  const id = React.useId();
  const search = useClientValue<string>(() => window.location.search, '');
  const params = React.useMemo(() => new URLSearchParams(search), [search]);
  const attemptId = UUID.test(params.get('attempt') ?? '') ? params.get('attempt')! : undefined;
  const fromPage = feedbackPagePath(params.get('from'));
  const [category, setCategory] = React.useState<SupportTicketInput['category']>(attemptId ? 'exam' : 'technical');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [attachTrace, setAttachTrace] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [trace] = React.useState(() => latestTraceId());

  const create = useMutation({
    mutationFn: createSupportTicket,
    onSuccess: (ticket) => {
      void qc.invalidateQueries({ queryKey: s12Keys.myTickets });
      router.push(`/support/tickets/${ticket.id}`);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const input = {
      subject: subject.trim(),
      message: message.trim(),
      category,
      ...(attachTrace && trace ? { trace_id: trace } : {}),
      ...(attemptId ? { attempt_id: attemptId } : {}),
      ...(fromPage ? { page_url: fromPage } : {}),
    };
    const parsed = supportTicketInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? 'form');
        errs[k] ??= k === 'subject' ? t('errors.subject') : k === 'message' ? t('errors.message') : t('errors.form');
      }
      setErrors(errs);
      return;
    }
    setErrors({});
    create.mutate(parsed.data);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <LifeBuoy className="size-5" aria-hidden />
          {t('newTitle')}
        </CardTitle>
        <CardDescription>{t('newDesc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit} noValidate data-testid="support-new-form">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-cat`}>{t('category')}</Label>
            <NativeSelect id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value as SupportTicketInput['category'])} data-testid="support-category">
              {SUPPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-subject`}>{t('subject')}</Label>
            <Input id={`${id}-subject`} value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 200))} aria-invalid={errors.subject ? true : undefined} aria-describedby={errors.subject ? `${id}-subject-err` : undefined} data-testid="support-subject" />
            {errors.subject ? (
              <p id={`${id}-subject-err`} role="alert" className="text-sm text-destructive">
                {errors.subject}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-msg`}>{t('message')}</Label>
            <Textarea id={`${id}-msg`} rows={6} value={message} onChange={(e) => setMessage(e.target.value.slice(0, 8000))} placeholder={t('messagePlaceholder')} aria-invalid={errors.message ? true : undefined} aria-describedby={errors.message ? `${id}-msg-err` : undefined} data-testid="support-message" />
            {errors.message ? (
              <p id={`${id}-msg-err`} role="alert" className="text-sm text-destructive">
                {errors.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1 text-sm">
            {trace ? (
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4 accent-[var(--color-navy)]" checked={attachTrace} onChange={(e) => setAttachTrace(e.target.checked)} />
                {t('attachTrace', { trace: trace.slice(0, 8) })}
              </label>
            ) : null}
            {attemptId ? <p className="text-muted-foreground">{t('attachAttempt', { id: attemptId.slice(0, 8) })}</p> : null}
          </div>
          {create.isError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {te(`codes.${getErrorCode(create.error)}`)}
            </p>
          ) : null}
          <Button type="submit" variant="navy" disabled={create.isPending} data-testid="support-submit">
            {create.isPending ? <Spinner aria-hidden /> : null}
            {t('submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function MyTickets() {
  const t = useTranslations('support');
  const tc = useTranslations('common');
  const list = useInfiniteQuery({
    queryKey: s12Keys.myTickets,
    queryFn: ({ pageParam }) => listMyTickets(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next_cursor,
  });
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <section aria-labelledby="my-tickets" className="min-w-0 space-y-3">
      <h2 id="my-tickets" className="text-lg font-semibold">
        {t('myTickets')}
      </h2>
      {list.isPending ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('emptyDesc')} />
      ) : (
        <ul className="space-y-2" data-testid="my-tickets">
          {rows.map((tk) => (
            <TicketRow key={tk.id} ticket={tk} />
          ))}
        </ul>
      )}
      {list.hasNextPage ? (
        <Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
          {list.isFetchingNextPage ? <Spinner aria-hidden /> : null}
          {tc('next')}
        </Button>
      ) : null}
    </section>
  );
}

function TicketRow({ ticket }: { ticket: SupportTicket }) {
  const t = useTranslations('support');
  const fmt = useFormatter();
  return (
    <li>
      <Link href={`/support/tickets/${ticket.id}`} className="flex items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/60" data-testid="my-ticket" data-status={ticket.status}>
        <MessageSquareText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{ticket.subject}</span>
          <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={TICKET_STATUS_VARIANT[ticket.status]}>{t(`status.${ticket.status}`)}</Badge>
            <span>{t(`categories.${ticket.category}`)}</span>
            <span>· {fmt.relativeTime(new Date(ticket.last_message_at ?? ticket.updated_at))}</span>
          </span>
        </span>
        <SlaChip ticket={ticket} />
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

/** Nhãn SLA phản hồi đầu (24 giờ) – mốc từ server */
export function SlaChip({ ticket, admin = false }: { ticket: Pick<SupportTicket, 'status' | 'first_response_due_at' | 'first_responded_at'>; admin?: boolean }) {
  const t = useTranslations('support');
  const sla = ticketSla(ticket);
  if (sla.state === 'none') return null;
  if (sla.state === 'responded') return <span className="hidden text-xs text-success sm:inline">{t('sla.responded')}</span>;
  return (
    <span className={sla.state === 'overdue' ? 'inline-flex items-center gap-1 text-xs font-medium text-destructive' : 'inline-flex items-center gap-1 text-xs text-muted-foreground'} data-testid="sla-chip" data-state={sla.state}>
      <Clock className="size-3.5" aria-hidden />
      {sla.state === 'pending' ? t('sla.pending', { hours: sla.hoursLeft }) : admin ? t('sla.overdueAdmin', { hours: sla.hoursOver }) : t('sla.overdue')}
    </span>
  );
}
