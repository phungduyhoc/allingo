'use client';

import { CreditCard, Dumbbell, LayoutDashboard, ListChecks, LogOut, NotebookPen, Settings, ShieldCheck, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, Button, buttonVariants, cn } from '@allingo/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useLogout, useMe } from '@/lib/queries';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { LocaleSwitcher } from './locale-switcher';
import { TutorProvider } from '@/features/tutor/tutor-provider';
import { InstallBanner } from '@/features/pwa/install-banner';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { SubscriptionBanner } from '@/features/billing/subscription-banner';
import { isAdmin } from '@/features/admin/is-admin';

const NAV = [
  { href: '/toeic/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { href: '/toeic/test-sets', key: 'testSets', icon: ListChecks },
  { href: '/toeic/practice', key: 'practice', icon: Dumbbell },
  { href: '/notes', key: 'notes', icon: NotebookPen },
  { href: '/settings', key: 'settings', icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const logout = useLogout();
  const user = me.data;

  return (
    <TutorProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
        >
          {tc('skipToContent')}
        </a>
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Logo href="/toeic/dashboard" />
              <nav aria-label="app" className="hidden items-center gap-1 md:flex">
                {NAV.map(({ href, key, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'gap-1.5',
                        active && 'bg-secondary text-secondary-foreground',
                      )}
                    >
                      <Icon aria-hidden />
                      {t(key)}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <LocaleSwitcher className="hidden h-9 w-auto sm:block" />
              <ThemeToggle />
              {user && isAdmin(user) ? (
                <Link
                  href="/admin/billing"
                  aria-label={t('adminBilling')}
                  title={t('adminBilling')}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'hidden sm:inline-flex', pathname.startsWith('/admin') && 'bg-secondary')}
                  data-testid="nav-admin-billing"
                >
                  <ShieldCheck aria-hidden />
                </Link>
              ) : null}
              {user ? (
                <Link
                  href="/account/billing"
                  aria-label={t('billing')}
                  title={t('billing')}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), pathname.startsWith('/account') && 'bg-secondary')}
                  data-testid="nav-billing"
                >
                  <CreditCard aria-hidden />
                </Link>
              ) : null}
              {user ? <NotificationBell /> : null}
              {user ? (
                <span
                  className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium sm:inline-flex"
                  data-testid="user-chip"
                >
                  <UserRound className="size-3.5" aria-hidden />
                  {user.display_name}
                  {user.is_guest ? <Badge variant="gold">{tc('guest')}</Badge> : null}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('logout')}
                disabled={logout.isPending}
                onClick={() => {
                  // mutateAsync: qc.clear() trong useLogout làm AuthGate gỡ component này trước khi callback onSettled của
                  // mutate() kịp chạy (kẹt spinner) – promise vẫn hoàn tất sau khi gỡ nên chuyển trang chắc chắn
                  void logout.mutateAsync().catch(() => undefined).finally(() => router.replace('/'));
                }}
              >
                <LogOut aria-hidden />
              </Button>
            </div>
          </div>
        </header>

        {user?.is_guest ? (
          <div className="border-b border-accent/50 bg-accent/15" data-testid="guest-banner">
            <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p>
                <span className="font-semibold">{ta('guestBannerTitle')}</span>
                <span className="text-muted-foreground"> — {ta('guestBannerDesc')}</span>
              </p>
              <Link href="/signup" className={buttonVariants({ variant: 'navy', size: 'sm' })}>
                {ta('guestBannerCta')}
              </Link>
            </div>
          </div>
        ) : null}
        <SubscriptionBanner />

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 pb-24 sm:px-6 md:pb-10">
          {children}
        </main>

        {/* Điều hướng dưới cho mobile */}
        <nav
          aria-label="app-mobile"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden"
        >
          <ul className="grid grid-cols-5">
            {NAV.map(({ href, key, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex flex-col items-center gap-1 px-0.5 py-2.5 text-center text-[11px] leading-tight font-medium',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {t(key)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <InstallBanner />
      </div>
    </TutorProvider>
  );
}
