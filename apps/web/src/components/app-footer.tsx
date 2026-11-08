'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Chân trang khu vực học (S12): liên kết pháp lý + hỗ trợ, tuyên bố không liên kết ETS trên mọi trang TOEIC trong app */
const LINKS = [
  ['/legal/terms', 'terms'],
  ['/legal/privacy', 'privacy'],
  ['/legal/refund', 'refund'],
  ['/legal/voice-consent', 'voice'],
  ['/support', 'support'],
] as const;

export function AppFooter() {
  const t = useTranslations('legalFooter');
  return (
    <footer className="border-t border-border/70 pb-24 md:pb-6" data-testid="app-footer">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 pt-5 text-xs text-muted-foreground sm:px-6 md:flex-row md:items-start md:justify-between md:gap-6">
        <nav aria-label={t('label')}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {LINKS.map(([href, key]) => (
              <li key={key}>
                <Link href={href} className="hover:text-foreground hover:underline">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="max-w-xl leading-relaxed md:text-right" data-testid="app-ets-disclaimer">
          {t('trademark')}
        </p>
      </div>
    </footer>
  );
}
