'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { getSystemStatus, listInvites, s12Keys } from '@/lib/s12-api';
import { CardSkeleton, ErrorState } from '@/components/states';
import { ADMIN_SECTIONS, AdminOpsShell, StatTile, useInitialParam, type AdminSection } from './admin-ops-shell';

/** Mỗi mục nạp lười (bảng/biểu mẫu của mục khác không vào JS trang) */
const loading = () => <CardSkeleton lines={6} />;
const BetaAdmin = dynamic(() => import('./beta-admin').then((m) => m.BetaAdmin), { loading });
const FeedbackAdmin = dynamic(() => import('./feedback-admin').then((m) => m.FeedbackAdmin), { loading });
const ContentAdmin = dynamic(() => import('./content-admin').then((m) => m.ContentAdmin), { loading });
const SupportAdmin = dynamic(() => import('./support-admin').then((m) => m.SupportAdmin), { loading });
const UsersAdmin = dynamic(() => import('./users-admin').then((m) => m.UsersAdmin), { loading });
const AiAdmin = dynamic(() => import('./ai-admin').then((m) => m.AiAdmin), { loading });
const SystemAdmin = dynamic(() => import('./system-admin').then((m) => m.SystemAdmin), { loading });
const AuditAdmin = dynamic(() => import('./audit-admin').then((m) => m.AuditAdmin), { loading });

/** `/admin/<mục>` – quản trị vận hành S12 */
export function AdminOpsPage({ section }: { section: AdminSection }) {
  const tab = useInitialParam('tab');
  return (
    <AdminOpsShell section={section}>
      {section === 'beta' ? <BetaAdmin initialTab={tab} /> : null}
      {section === 'feedback' ? <FeedbackAdmin /> : null}
      {section === 'content' ? <ContentAdmin initialTab={tab} /> : null}
      {section === 'support' ? <SupportAdmin /> : null}
      {section === 'users' ? <UsersAdmin /> : null}
      {section === 'ai' ? <AiAdmin /> : null}
      {section === 'system' ? <SystemAdmin initialTab={tab} /> : null}
      {section === 'audit' ? <AuditAdmin /> : null}
    </AdminOpsShell>
  );
}

/** `/admin` – tổng quan: sức khoẻ hệ thống, SLA hỗ trợ, beta hôm nay + lối vào từng mục */
export function AdminOverviewPage() {
  const t = useTranslations('adminOps');
  const status = useQuery({ queryKey: s12Keys.admin('system-status'), queryFn: getSystemStatus, refetchInterval: 60_000 });
  const invites = useQuery({ queryKey: s12Keys.admin('invites-today'), queryFn: () => listInvites({ limit: 1 }) });
  const s = status.data;
  return (
    <AdminOpsShell section="overview">
      <div className="space-y-6" data-testid="admin-overview">
        {status.isPending ? (
          <CardSkeleton lines={3} />
        ) : status.isError ? (
          <ErrorState error={status.error} onRetry={() => void status.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t('system.redis')} value={s?.redis_healthy ? t('system.healthy') : t('system.down')} tone={s?.redis_healthy ? 'ok' : 'bad'} />
            <StatTile label={t('system.dlqUnreplayed')} value={s?.dead_letters?.unreplayed ?? 0} tone={(s?.dead_letters?.unreplayed ?? 0) > 0 ? 'warn' : 'ok'} testId="overview-dlq" />
            <StatTile label={t('overview.ticketsOverdue')} value={s?.sla?.support_tickets_overdue ?? 0} tone={(s?.sla?.support_tickets_overdue ?? 0) > 0 ? 'warn' : 'ok'} testId="overview-tickets-overdue" />
            <StatTile label={t('overview.reportsOverdue')} value={s?.sla?.content_reports_overdue ?? 0} tone={(s?.sla?.content_reports_overdue ?? 0) > 0 ? 'warn' : 'ok'} />
          </div>
        )}
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {ADMIN_SECTIONS.map((sec) => (
            <Card key={sec}>
              <CardHeader>
                <CardTitle className="text-base">{t(`sections.${sec}.title`)}</CardTitle>
                <CardDescription>{t(`sections.${sec}.desc`)}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <span className="text-xs text-muted-foreground">{sec === 'beta' && invites.data?.today ? t('overview.betaToday', { sent: invites.data.today.sent ?? 0, limit: invites.data.today.limit ?? 0 }) : null}</span>
                <Link href={`/admin/${sec}`} className={buttonVariants({ variant: 'outline', size: 'sm' })} aria-label={t('overview.openSection', { section: t(`sections.${sec}.title`) })}>
                  {t('overview.open')}
                  <ArrowRight aria-hidden />
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </AdminOpsShell>
  );
}
