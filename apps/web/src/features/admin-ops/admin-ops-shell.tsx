'use client';

import * as React from 'react';
import { Activity, Bot, CreditCard, FileSearch, FileWarning, LayoutGrid, LifeBuoy, MessageSquare, ShieldAlert, Sparkles, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle, buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { isAdmin, isContentStaff } from '@/features/admin/is-admin';
import { PageHeader } from '@/components/page-header';

import { ADMIN_SECTIONS, type AdminSection } from './sections';

export { ADMIN_SECTIONS, type AdminSection };

const ICONS: Record<AdminSection | 'overview' | 'billing', typeof Users> = {
  overview: LayoutGrid,
  beta: Sparkles,
  feedback: MessageSquare,
  content: FileWarning,
  support: LifeBuoy,
  users: Users,
  ai: Bot,
  system: Activity,
  audit: FileSearch,
  billing: CreditCard,
};

/**
 * Khung trang quản trị vận hành `/admin[/<mục>]` (S12, theo kiểu billing admin S8): chỉ vai trò admin/superadmin – client ẩn menu +
 * chặn route, SERVER vẫn 403 (và 403 `mfa_required` → hộp thoại step-up). Điều hướng giữa các mục + liên kết billing admin.
 */
export function AdminOpsShell({ section, children }: { section: AdminSection | 'overview'; children: React.ReactNode }) {
  const t = useTranslations('adminOps');
  const me = useMe();
  const admin = isAdmin(me.data);
  // B2: editor/teacher chỉ vào được mục Nội dung (server vẫn kiểm vai trò từng endpoint)
  const contentOnly = !admin && section === 'content' && isContentStaff(me.data);
  if (!admin && !contentOnly) {
    return (
      <Alert variant="destructive" data-testid="admin-forbidden">
        <ShieldAlert aria-hidden />
        <AlertTitle>{t('forbiddenTitle')}</AlertTitle>
        <AlertDescription>{t('forbiddenDesc')}</AlertDescription>
      </Alert>
    );
  }
  const items: Array<{ key: AdminSection | 'overview' | 'billing'; href: string }> = contentOnly
    ? [{ key: 'content', href: '/admin/content' }]
    : [{ key: 'overview', href: '/admin' }, ...ADMIN_SECTIONS.map((s) => ({ key: s, href: `/admin/${s}` })), { key: 'billing', href: '/admin/billing' }];
  return (
    <div className="space-y-6" data-testid="admin-ops" data-section={section} data-content-only={contentOnly || undefined}>
      <PageHeader title={t(`sections.${section}.title`)} description={t(`sections.${section}.desc`)} />
      <nav aria-label={t('navLabel')} className="-mx-1 overflow-x-auto pb-1">
        <ul className="flex w-max gap-1 px-1">
          {items.map(({ key, href }) => {
            const Icon = ICONS[key];
            const active = key === section;
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(buttonVariants({ variant: active ? 'secondary' : 'ghost', size: 'sm' }), 'gap-1.5')}
                  data-testid={`admin-nav-${key}`}
                >
                  <Icon aria-hidden />
                  {t(`sections.${key}.nav`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div>{children}</div>
    </div>
  );
}

/** Thẻ số liệu nhỏ dùng chung */
export function StatTile({ label, value, hint, tone = 'default', testId }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'warn' | 'ok' | 'bad'; testId?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4', tone === 'warn' ? 'border-accent' : tone === 'bad' ? 'border-destructive/50' : tone === 'ok' ? 'border-success/40' : 'border-border')} data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-extrabold tabular', tone === 'bad' && 'text-destructive')}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Tab con trong một mục (đồng bộ `?tab=` qua History API – không dựng lại trang, giữ bộ lọc) */
export function useSubTab<T extends string>(tabs: readonly T[], initial: string | null): [T, (t: T) => void] {
  const [tab, setTab] = React.useState<T>(() => ((tabs as readonly string[]).includes(initial ?? '') ? (initial as T) : tabs[0]!));
  const go = React.useCallback((next: T) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }, []);
  return [tab, go];
}

/** Rút gọn JSON để hiển thị (before/after audit, kết quả job) */
export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <pre className={cn('max-h-48 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap', className)}>{JSON.stringify(value, null, 1)}</pre>;
}

export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`);

/** Tham số query khởi tạo của trang admin (`?tab=`, `?user=`, `?entity=`…) – đọc một lần ở client */
export function useInitialParam(name: string): string | null {
  const [v] = React.useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name)));
  return v;
}

