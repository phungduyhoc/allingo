import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';

/** Dấu hiệu: chữ "A" như một chiếc cầu/vòm vàng trên nền navy – "cầu nối ngôn ngữ" */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-8', className)}>
      <rect width="32" height="32" rx="8" fill="#0B1F4B" />
      <path d="M8 24 L16 8 L24 24" fill="none" stroke="#E6B325" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 18.5 H20.5" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ href = '/', className, withTagline = false }: { href?: '/' | '/toeic/dashboard'; className?: string; withTagline?: boolean }) {
  const t = useTranslations('common');
  return (
    // S12 (axe label-content-name-mismatch): tên truy cập = chữ hiển thị (tên + khẩu hiệu), không ghi đè bằng aria-label
    <Link href={href} className={cn('inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-extrabold tracking-tight text-navy dark:text-foreground">{t('appName')}</span>
        {withTagline ? <span className="mt-0.5 text-[11px] font-medium text-muted-foreground">{t('tagline')}</span> : null}
      </span>
    </Link>
  );
}
