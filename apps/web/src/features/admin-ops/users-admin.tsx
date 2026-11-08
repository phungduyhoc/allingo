'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, FileSearch, Lock, LockOpen, Trash2 } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle, Badge, Button, buttonVariants, Card, CardContent, CardHeader, CardTitle, cn, Spinner, Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { pickLocalized, type LocalizedText } from '@allingo/schemas/common';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { getErrorCode } from '@/lib/errors';
import { formatVnd } from '@/lib/billing';
import { getAdminUser, impersonatedGet, lockUser, requestUserDeletion, s12Keys, searchUsers, startImpersonation, unlockUser, type AdminImpersonation, type AdminUserSummary } from '@/lib/s12-api';
import { CardSkeleton, ErrorState } from '@/components/states';
import { DataTable, FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';
import { ConfirmDialog } from './confirm-dialog';
import { JsonBlock, StatTile, useInitialParam } from './admin-ops-shell';
import { maskPii } from '@/lib/admin-format';

const STATUS_VARIANT: Record<string, 'success' | 'destructive' | 'gold' | 'muted'> = { active: 'success', suspended: 'destructive', pending_deletion: 'gold', deleted: 'muted' };

/**
 * Người dùng (S12): tìm theo email (chính xác/tiền tố), tên hoặc id – kết quả che PII (`email_masked`, không SĐT); hồ sơ chi tiết
 * (phiên, MFA, beta, credit, gói, bài làm, đơn, ticket, yêu cầu xoá); khoá (thu hồi mọi phiên ngay) / mở khoá, yêu cầu xoá dữ liệu
 * (72 giờ), "Xem như người dùng" CHỈ ĐỌC 10 phút (token Bearer trong bộ nhớ trang, mọi request audit ở server). Thao tác phá huỷ
 * đều qua hộp xác nhận có lý do (ghi audit).
 */
export function UsersAdmin() {
  const t = useTranslations('adminOps');
  const initialUser = useInitialParam('user');
  const [filter, setFilter] = React.useState({ q: initialUser ?? '', status: '', role: '' });
  const enabled = filter.q.trim().length >= 2 || !!filter.status || !!filter.role;
  const { q, rows } = useCursorList(s12Keys.admin('users', filter), (cursor) => (enabled ? searchUsers({ ...filter, q: filter.q.trim() || undefined, cursor }) : Promise.resolve({ data: [], next_cursor: null })));
  const [selected, setSelected] = React.useState<string | null>(initialUser && /^[0-9a-f-]{36}$/i.test(initialUser) ? initialUser : null);
  return (
    <div className="space-y-4">
      <FilterBar
        value={filter}
        onApply={setFilter}
        testId="users-search"
        fields={[
          { name: 'q', label: t('users.query'), placeholder: t('users.queryPlaceholder') },
          { name: 'status', label: t('status'), type: 'select', options: ['active', 'suspended', 'pending_deletion', 'deleted'].map((s) => ({ value: s, label: t(`users.status.${s}`) })) },
          { name: 'role', label: t('users.role'), type: 'select', options: ['learner', 'beta_tester', 'teacher', 'editor', 'admin', 'superadmin'].map((r) => ({ value: r, label: r })) },
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('users.privacyNote')}</p>
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="min-w-0">
          <DataTable<AdminUserSummary>
            list={{ q }}
            rows={rows}
            rowKey={(r) => r.id}
            rowTestId="admin-user-row"
            rowAttrs={(r) => ({ 'data-id': r.id, 'data-status': r.status })}
            empty={enabled ? t('empty') : t('users.typeToSearch')}
            columns={[
              {
                key: 'name',
                header: t('users.name'),
                cell: (r) => (
                  <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => setSelected(r.id)} data-testid="admin-user-open">
                    {r.display_name}
                    {r.is_guest ? <Badge variant="muted" className="ml-1">{t('users.guest')}</Badge> : null}
                  </button>
                ),
              },
              { key: 'email', header: t('email'), cell: (r) => <span className="font-mono text-xs">{r.email_masked ?? '—'}</span> },
              { key: 'roles', header: t('users.role'), cell: (r) => <span className="text-xs">{r.roles.join(', ')}</span> },
              { key: 'status', header: t('status'), cell: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>{t(`users.status.${r.status}`)}</Badge> },
              { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
            ]}
          />
        </div>
        <div className="min-w-0">{selected ? <UserDetail key={selected} id={selected} /> : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('users.pick')}</p>}</div>
      </div>
    </div>
  );
}

type Action = 'lock' | 'unlock' | 'deletion' | 'impersonate';

function UserDetail({ id }: { id: string }) {
  const t = useTranslations('adminOps');
  const te = useTranslations('errors');
  const fmt = useFormatter();
  const locale = useLocale();
  const qc = useQueryClient();
  const me = useMe();
  const user = useQuery({ queryKey: s12Keys.admin('user', { id }), queryFn: () => getAdminUser(id) });
  const [action, setAction] = React.useState<Action | null>(null);
  const [imp, setImp] = React.useState<(AdminImpersonation & { until: number; name: string }) | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: s12Keys.admin('user', { id }) });
    void qc.invalidateQueries({ queryKey: ['admin', 's12', 'users'] });
  };
  const run = useMutation({
    mutationFn: async ({ a, reason }: { a: Action; reason: string }) => {
      if (a === 'lock') return { a, r: await lockUser(id, reason) };
      if (a === 'unlock') return { a, r: await unlockUser(id, reason || undefined) };
      if (a === 'deletion') return { a, r: await requestUserDeletion(id, reason) };
      return { a, r: await startImpersonation(id, reason) };
    },
    onSuccess: ({ a, r }) => {
      setAction(null);
      if (a === 'impersonate') {
        const tok = r;
        setImp({ ...tok, until: Date.now() + (tok.expires_in ?? 600) * 1000, name: user.data?.display_name ?? '' });
        return;
      }
      if (a === 'lock') toast.success(t('users.lockedToast', { sessions: (r as { sessions_revoked?: number }).sessions_revoked ?? 0 }));
      else if (a === 'unlock') toast.success(t('users.unlockedToast'));
      else toast.success(t('users.deletionToast', { date: (r as { due_at?: string }).due_at ? fmt.dateTime(new Date((r as { due_at: string }).due_at), { dateStyle: 'medium', timeStyle: 'short' }) : '—' }));
      refresh();
    },
  });

  if (user.isPending) return <CardSkeleton lines={8} />;
  if (user.isError) return <ErrorState error={user.error} onRetry={() => void user.refetch()} />;
  const u = user.data;
  const self = u.id === me.data?.id;
  const privileged = u.roles.some((r) => r === 'admin' || r === 'superadmin');
  const subs = (u.subscriptions ?? []) as unknown as Array<{ id: string; plan?: { name?: LocalizedText; code?: string }; status?: string; current_period_end?: string | null; is_current?: boolean }>;
  const attempts = (u.attempts ?? []) as unknown as Array<{ id: string; status?: string; mode?: string; scaled_score?: number | null; started_at?: string; submitted_at?: string | null; test_set_title?: LocalizedText | string | null }>;
  const orders = (u.orders ?? []) as unknown as Array<{ id: string; status?: string; total?: number; created_at?: string }>;

  if (imp) return <ImpersonationView imp={imp} onExit={() => setImp(null)} />;

  return (
    <Card data-testid="admin-user-detail" data-status={u.status}>
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {u.display_name}
          <Badge variant={STATUS_VARIANT[u.status] ?? 'outline'} data-testid="admin-user-status">
            {t(`users.status.${u.status}`)}
          </Badge>
          {u.mfa_enrolled ? <Badge variant="secondary">{t('users.mfa')}</Badge> : null}
          {u.beta?.tester ? <Badge variant="gold">{t('users.betaTester')}</Badge> : null}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{u.email_masked ?? '—'}</span> · {u.phone_masked ?? t('users.noPhone')} · <ShortId id={u.id} /> · {u.roles.join(', ')}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label={t('users.sessions')} value={u.active_sessions} testId="admin-user-sessions" />
          <StatTile label={t('users.credits')} value={fmt.number(u.credits?.balance ?? 0)} />
          <StatTile label={t('users.lastSeen')} value={u.last_seen_at ? fmt.relativeTime(new Date(u.last_seen_at)) : '—'} />
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t('createdAt')} value={<When iso={u.created_at} />} />
          <Row label={t('locale')} value={`${u.ui_locale} · ${u.timezone}`} />
          <Row label={t('users.providers')} value={u.providers.length ? u.providers.join(', ') : t('users.password')} />
          <Row label={t('users.beta')} value={u.beta?.tester ? t('users.betaSince', { date: u.beta.redeemed_at ? fmt.dateTime(new Date(u.beta.redeemed_at), { dateStyle: 'medium' }) : '—' }) : (u.beta?.invite_status ?? '—')} />
          {u.deletion ? <Row label={t('users.deletion')} value={<JsonBlock value={u.deletion} />} /> : null}
        </dl>

        <Section title={t('users.subscriptions')} empty={!subs.length}>
          {subs.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2">
              <span>{s.plan?.name ? pickLocalized(s.plan.name, locale) : (s.plan?.code ?? '—')}</span>
              <span className="text-xs text-muted-foreground">
                {s.status} · <When iso={s.current_period_end ?? null} />
              </span>
            </li>
          ))}
        </Section>
        <Section title={t('users.attempts')} empty={!attempts.length}>
          {attempts.slice(0, 8).map((a) => (
            <li key={a.id} className="flex flex-wrap justify-between gap-2">
              <span className="min-w-0 truncate">
                {a.test_set_title ? (typeof a.test_set_title === 'string' ? a.test_set_title : pickLocalized(a.test_set_title, locale)) : <ShortId id={a.id} />} <span className="text-xs text-muted-foreground">· {a.mode ?? ''}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {a.status} {a.scaled_score !== null && a.scaled_score !== undefined ? `· ${a.scaled_score}` : ''} · <When iso={a.submitted_at ?? a.started_at ?? null} />
              </span>
            </li>
          ))}
        </Section>
        <Section title={t('users.orders')} empty={!orders.length}>
          {orders.slice(0, 8).map((o) => (
            <li key={o.id} className="flex flex-wrap justify-between gap-2">
              <span className="font-mono text-xs">{o.id.slice(0, 8)}</span>
              <span className="text-xs text-muted-foreground">
                {o.status} · {formatVnd(o.total ?? 0, 'vi')} · <When iso={o.created_at ?? null} />
              </span>
            </li>
          ))}
        </Section>
        <Section title={t('users.tickets')} empty={!u.tickets.length}>
          {u.tickets.slice(0, 8).map((tk) => (
            <li key={tk.id} className="flex flex-wrap justify-between gap-2">
              <Link href={`/admin/support?ticket=${tk.id}`} className="text-primary hover:underline">
                {tk.subject}
              </Link>
              <span className="text-xs text-muted-foreground">{tk.status}</span>
            </li>
          ))}
        </Section>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {u.status === 'suspended' ? (
            <Button variant="outline" size="sm" onClick={() => setAction('unlock')} data-testid="admin-user-unlock">
              <LockOpen aria-hidden />
              {t('users.unlock')}
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setAction('lock')} disabled={self || u.status === 'deleted'} data-testid="admin-user-lock">
              <Lock aria-hidden />
              {t('users.lock')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setAction('impersonate')} disabled={self || privileged || u.status !== 'active'} data-testid="admin-user-impersonate">
            <Eye aria-hidden />
            {t('users.impersonate')}
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setAction('deletion')} disabled={self || !!u.deletion || u.status === 'deleted'} data-testid="admin-user-deletion">
            <Trash2 aria-hidden />
            {t('users.requestDeletion')}
          </Button>
          <Link href={`/admin/audit?entity=${u.id}`} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <FileSearch aria-hidden />
            {t('users.auditLink')}
          </Link>
        </div>
        {privileged ? <p className="text-xs text-muted-foreground">{t('users.privilegedNote')}</p> : null}
      </CardContent>

      <ConfirmDialog
        key={action ?? 'none'}
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        destructive={action === 'lock' || action === 'deletion'}
        title={action ? t(`users.confirm.${action}.title`, { name: u.display_name }) : ''}
        description={action ? t(`users.confirm.${action}.desc`) : undefined}
        confirmLabel={action ? t(`users.confirm.${action}.cta`) : ''}
        reason={action ? { label: t('users.reason'), min: 3, optional: action === 'unlock', placeholder: t('users.reasonPlaceholder') } : undefined}
        acknowledge={action === 'deletion' ? t('users.confirm.deletion.ack') : undefined}
        pending={run.isPending}
        error={run.isError ? te(`codes.${getErrorCode(run.error)}`) : null}
        onConfirm={(reason) => action && run.mutate({ a: action, reason })}
        testId={`admin-user-${action ?? 'none'}-confirm`}
      />
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words">{value}</dd>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  const t = useTranslations('adminOps');
  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-xs text-muted-foreground">{t('empty')}</p> : <ul className="space-y-1 text-sm">{children}</ul>}
    </section>
  );
}

const IMP_VIEWS = [
  { key: 'profile', path: '/me' },
  { key: 'stats', path: '/me/stats?program=toeic' },
  { key: 'attempts', path: '/me/attempts?limit=10' },
  { key: 'entitlements', path: '/me/entitlements?program=toeic' },
  { key: 'credits', path: '/me/credits' },
  { key: 'tickets', path: '/me/support/tickets' },
] as const;

/**
 * "Xem như người dùng" CHỈ ĐỌC: dữ liệu của người dùng đọc bằng token impersonate (Bearer, không cookie – phiên admin không đổi);
 * banner nổi bật + đếm ngược 10 phút + "Thoát" (xoá token khỏi bộ nhớ). Hết hạn → tự thoát. Không có nút ghi nào.
 */
function ImpersonationView({ imp, onExit }: { imp: AdminImpersonation & { until: number; name: string }; onExit: () => void }) {
  const t = useTranslations('adminOps');
  const [now, setNow] = React.useState(() => Date.now());
  const [view, setView] = React.useState<(typeof IMP_VIEWS)[number]['key']>('profile');
  React.useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);
  const left = Math.max(0, Math.ceil((imp.until - now) / 1000));
  const expired = left === 0;
  const path = IMP_VIEWS.find((v) => v.key === view)!.path;
  const data = useQuery({ queryKey: ['admin', 'impersonation', imp.impersonation_id, view], queryFn: () => impersonatedGet(imp.access_token, path), enabled: !expired, retry: false, staleTime: 60_000 });
  const bannerRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => bannerRef.current?.focus(), []);
  return (
    <div className="space-y-4" data-testid="impersonation-view">
      <div ref={bannerRef} tabIndex={-1} role="status" className="sticky top-16 z-30 flex flex-wrap items-center gap-3 rounded-xl border-2 border-accent bg-accent/20 p-4 outline-none" data-testid="impersonation-banner">
        <EyeOff className="size-5 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-bold">{t('users.imp.banner', { name: imp.name })}</span>{' '}
          <span className="text-muted-foreground">{expired ? t('users.imp.expired') : t('users.imp.left', { m: Math.floor(left / 60), s: String(left % 60).padStart(2, '0') })}</span>
        </p>
        <Button variant="navy" size="sm" onClick={onExit} data-testid="impersonation-exit">
          {t('users.imp.exit')}
        </Button>
      </div>
      <Alert variant="info">
        <AlertTitle>{t('users.imp.readOnly')}</AlertTitle>
        <AlertDescription>{t('users.imp.readOnlyDesc')}</AlertDescription>
      </Alert>
      <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
        <TabsList aria-label={t('users.imp.views')} className="max-w-full flex-wrap justify-start">
          {IMP_VIEWS.map((v) => (
            <TabsTrigger key={v.key} value={v.key} data-testid={`imp-view-${v.key}`}>
              {t(`users.imp.view.${v.key}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div role="tabpanel" aria-label={t(`users.imp.view.${view}`)} className={cn(expired && 'opacity-50')}>
        {expired ? (
          <p className="text-sm text-muted-foreground">{t('users.imp.expired')}</p>
        ) : data.isPending ? (
          <Spinner />
        ) : data.isError ? (
          <ErrorState error={data.error} onRetry={() => void data.refetch()} />
        ) : (
          <JsonBlock value={maskPii(data.data)} className="max-h-[32rem]" />
        )}
      </div>
    </div>
  );
}
