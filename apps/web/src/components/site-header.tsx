'use client';

import { useTranslations } from 'next-intl';
import { buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { Logo } from './logo';
import { LocaleSwitcher } from './locale-switcher';
import { ThemeToggle } from './theme-toggle';
import { TryFreeButton } from '@/features/auth/try-free-button';

export function SiteHeader() {
  const t = useTranslations('nav');
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo withTagline />
        {/* S10: điều hướng marketing (desktop) */}
        <nav aria-label={t('marketingNav')} className="hidden items-center gap-1 lg:flex">
          <Link href="/toeic" prefetch={false} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('toeic')}
          </Link>
          <Link href="/blog" prefetch={false} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('blog')}
          </Link>
          <Link href="/pricing" prefetch={false} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('pricing')}
          </Link>
        </nav>
        <nav aria-label="main" className="flex items-center gap-1 sm:gap-2">
          <LocaleSwitcher className="hidden h-9 w-auto sm:block" />
          <ThemeToggle />
          <Link href="/login" className={cn(buttonVariants({ variant: 'ghost' }), 'hidden sm:inline-flex')}>
            {t('login')}
          </Link>
          <TryFreeButton size="default" variant="navy" className="hidden sm:inline-flex" />
          <Link href="/login" className={cn(buttonVariants({ variant: 'navy', size: 'sm' }), 'sm:hidden')}>
            {t('login')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
