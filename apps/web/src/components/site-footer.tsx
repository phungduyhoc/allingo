import { useTranslations } from 'next-intl';
import { LogoMark } from './logo';

export function SiteFooter() {
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-7" />
          <div className="leading-tight">
            <div className="font-bold text-navy dark:text-foreground">{tc('appName')}</div>
            <div className="text-xs text-muted-foreground">{tc('tagline')}</div>
          </div>
        </div>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>{t('footerTrademark')}</p>
          <p>{t('footerRights', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
