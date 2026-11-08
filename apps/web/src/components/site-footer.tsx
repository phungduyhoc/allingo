import { useLocale, useTranslations } from 'next-intl';
import { ConsentSettingsButton } from '@/features/consent/cookie-banner';
import { LogoMark } from './logo';

/** Chân trang marketing: liên kết (TOEIC, blog, bảng giá, giới thiệu, liên hệ, pháp lý S12, beta kín), "Cài đặt cookie" (S10), nhãn hiệu */
const LINKS = [
  ['/toeic', 'toeic'],
  ['/blog', 'blog'],
  ['/pricing', 'pricing'],
  ['/about', 'about'],
  ['/contact', 'contact'],
  // S12: văn bản pháp lý /legal/* + trang beta kín
  ['/legal/terms', 'terms'],
  ['/legal/privacy', 'privacy'],
  ['/legal/refund', 'refund'],
  ['/legal/voice-consent', 'voice'],
  ['/beta', 'beta'],
] as const;

export function SiteFooter() {
  const t = useTranslations('landing');
  const tc = useTranslations('common');
  const tm = useTranslations('marketing.footer');
  const locale = useLocale();
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark className="size-7" />
          <div className="leading-tight">
            <div className="font-bold text-navy dark:text-foreground">{tc('appName')}</div>
            <div className="text-xs text-muted-foreground">{tc('tagline')}</div>
          </div>
        </div>
        <nav aria-label={tm('label')} className="text-sm">
          <ul className="grid grid-cols-2 gap-x-8 gap-y-2 sm:grid-cols-3">
            {LINKS.map(([href, key]) => (
              <li key={key}>
                <a href={`/${locale}${href}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  {tm(key)}
                </a>
              </li>
            ))}
            <li>
              <ConsentSettingsButton className="text-left text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" />
            </li>
          </ul>
        </nav>
        <div className="max-w-sm space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>{t('footerTrademark')}</p>
          <p>{t('footerRights', { year: new Date().getFullYear() })}</p>
        </div>
      </div>
    </footer>
  );
}
