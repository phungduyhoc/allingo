'use client';

import { BookA, CalendarCheck, CreditCard, Dumbbell, FileWarning, LayoutDashboard, ListChecks, LogOut, NotebookPen, Route, Settings, ShieldCheck, UserRound } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Badge, Button, buttonVariants, cn } from '@allingo/ui';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { useLogout, useMe } from '@/lib/queries';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';
import { LocaleSwitcher } from './locale-switcher';
import { TutorProvider } from '@/features/tutor/tutor-provider';
import { InstallBanner } from '@/features/pwa/install-banner';
import { Deferred } from './deferred';
import { SubscriptionBanner } from '@/features/billing/subscription-banner';
import { isAdmin } from '@/features/admin/is-admin';
import { useFlag } from '@/features/flags/flags-provider';
import type { FlagKey } from '@/lib/flags';
import { FeedbackButton } from '@/features/feedback/feedback-button';
import { AppFooter } from './app-footer';

/**
 * S9: "Hôm nay" + "Lộ trình" lên đầu; Cài đặt chuyển thành nút biểu tượng trên header. S10: thêm "Từ vựng" + "Sổ lỗi" (8 mục):
 * desktop chỉ biểu tượng tới 2xl (nhãn cho trình đọc màn hình), thanh dưới mobile 8 cột dùng nhãn ngắn `nav.short.*`.
 */
const NotificationBell = dynamic(() => import('@/features/notifications/notification-bell').then((m) => m.NotificationBell), {
  ssr: false,
  loading: () => <span className="inline-block size-10" aria-hidden />,
});

const NAV: ReadonlyArray<{ href: string; key: string; icon: typeof CalendarCheck; flag?: FlagKey }> = [
  // S11: kill-switch ff.learning.study_plan tắt → ẩn "Hôm nay" + "Lộ trình"
  { href: '/toeic/today', key: 'today', icon: CalendarCheck, flag: 'ff.learning.study_plan' },
  { href: '/toeic/plan', key: 'plan', icon: Route, flag: 'ff.learning.study_plan' },
  { href: '/toeic/dashboard', key: 'dashboard', icon: LayoutDashboard },
  { href: '/toeic/test-sets', key: 'testSets', icon: ListChecks },
  { href: '/toeic/practice', key: 'practice', icon: Dumbbell },
  { href: '/toeic/vocab', key: 'vocab', icon: BookA },
  { href: '/toeic/errors', key: 'errors', icon: FileWarning },
  { href: '/notes', key: 'notes', icon: NotebookPen },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');
  const ta = useTranslations('auth');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const router = useRouter();
  const me = useMe();
  const logout = useLogout();
  const user = me.data;
  const planOn = useFlag('ff.learning.study_plan');
  const nav = NAV.filter((n) => !n.flag || (n.flag === 'ff.learning.study_plan' && planOn));

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
              <nav aria-label={t('aria.app')} className="hidden items-center gap-1 md:flex">
                {nav.map(({ href, key, icon: Icon }) => {
                  const active = pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      title={t(key)}
                      className={cn(
                        buttonVariants({ variant: 'ghost', size: 'sm' }),
                        'gap-1.5',
                        active && 'bg-secondary text-secondary-foreground',
                      )}
                    >
                      <Icon aria-hidden />
                      {/* md–xl: chỉ biểu tượng (nhãn cho trình đọc màn hình), từ 2xl hiện chữ */}
                      <span className="sr-only 2xl:not-sr-only">{t(key)}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <LocaleSwitcher className="hidden h-9 w-auto sm:block" />
              <ThemeToggle />
              {/* S12: góp ý in-app (ẩn khi Exam Mode) */}
              {user ? <FeedbackButton /> : null}
              {user && isAdmin(user) ? (
                <Link
                  href="/admin"
                  aria-label={t('admin')}
                  title={t('admin')}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'hidden sm:inline-flex', pathname.startsWith('/admin') && 'bg-secondary')}
                  data-testid="nav-admin"
                >
                  <ShieldCheck aria-hidden />
                </Link>
              ) : null}
              {/* Mobile: Thanh toán vào qua Cài đặt (giữ header không tràn ở 360 px khi thêm nút Góp ý) */}
              {user ? (
                <Link
                  href="/account/billing"
                  aria-label={t('billing')}
                  title={t('billing')}
                  className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'hidden sm:inline-flex', pathname.startsWith('/account') && 'bg-secondary')}
                  data-testid="nav-billing"
                >
                  <CreditCard aria-hidden />
                </Link>
              ) : null}
              {/* S11: chuông (tải /me/notifications + mã bảng) dựng khi trình duyệt rảnh; khung giữ chỗ cùng kích thước (không CLS) */}
              {user ? (
                <Deferred fallback={<span className="inline-block size-10" aria-hidden />}>
                  <NotificationBell />
                </Deferred>
              ) : null}
              <Link
                href="/settings"
                aria-label={t('settings')}
                title={t('settings')}
                className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), pathname.startsWith('/settings') && 'bg-secondary')}
                data-testid="nav-settings"
              >
                <Settings aria-hidden />
              </Link>
              {user ? (
                <span
                  className="hidden items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium 2xl:inline-flex"
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

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 md:pb-10">
          {children}
        </main>
        {/* S12: liên kết pháp lý + hỗ trợ + tuyên bố không liên kết ETS (đệm dưới cho thanh điều hướng mobile) */}
        <AppFooter />

        {/* Điều hướng dưới cho mobile */}
        <nav
          aria-label={t('aria.appMobile')}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden"
        >
          <ul className={cn('grid', nav.length === 8 ? 'grid-cols-8' : 'grid-cols-6')}>
            {nav.map(({ href, key, icon: Icon }) => {
              const active = pathname.startsWith(href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex flex-col items-center gap-1 px-0.5 py-2.5 text-center text-[10px] leading-tight font-medium',
                      active ? 'text-primary' : 'text-muted-foreground',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {t(`short.${key}`)}
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
