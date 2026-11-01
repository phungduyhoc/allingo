import { useTranslations } from 'next-intl';
import { buttonVariants } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { LogoMark } from '@/components/logo';

export default function NotFound() {
  const t = useTranslations('common');
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <LogoMark className="size-12" />
      <h1 className="text-2xl font-bold">{t('notFoundTitle')}</h1>
      <p className="max-w-md text-muted-foreground">{t('notFoundDesc')}</p>
      <Link href="/" className={buttonVariants({ variant: 'navy' })}>
        {t('goHome')}
      </Link>
    </main>
  );
}
