import { Check, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription, Badge, buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';

/**
 * Trang Bảng giá – PLACEHOLDER (Sprint 5) để CTA "Nâng cấp Pro" có đích đến. Gói/giá/thanh toán thật làm ở Sprint 7
 * (billing: VNPay/MoMo/ZaloPay, GET /plans). Không ghi số tiền hay hạn mức cứng ở đây – hạn mức thật do máy chủ trả.
 */
export async function PricingPage({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'pricing' });
  const free = t.raw('freeFeatures') as string[];
  const pro = t.raw('proFeatures') as string[];
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-4 py-12 sm:px-6 sm:py-16" data-testid="pricing-page">
      <header className="mx-auto max-w-2xl space-y-3 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground">{t('title')}</h1>
        <p className="text-lg text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Alert variant="gold" className="mx-auto max-w-2xl" data-testid="pricing-coming-soon">
        <Sparkles aria-hidden />
        <AlertDescription>{t('comingSoon')}</AlertDescription>
      </Alert>
      <div className="grid gap-6 md:grid-cols-2">
        <PlanCard title={t('freeTitle')} desc={t('freeDesc')} items={free} />
        <PlanCard title={t('proTitle')} desc={t('proDesc')} items={pro} highlight badge={t('proBadge')} />
      </div>
      <div className="space-y-3 text-center text-sm text-muted-foreground">
        <p>{t('payments')}</p>
        <p>{t('currentLimits')}</p>
        <Link href="/toeic/dashboard" className={buttonVariants({ variant: 'outline' })}>
          {t('backToApp')}
        </Link>
      </div>
    </div>
  );
}

function PlanCard({ title, desc, items, highlight = false, badge }: { title: string; desc: string; items: string[]; highlight?: boolean; badge?: string }) {
  return (
    <section className={cn('flex flex-col gap-4 rounded-2xl border p-6', highlight ? 'border-accent bg-navy text-navy-foreground shadow-lg' : 'border-border bg-card')}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={cn('text-2xl font-bold', highlight && 'text-accent')}>{title}</h2>
        {badge ? <Badge variant="gold">{badge}</Badge> : null}
      </div>
      <p className={cn('text-sm', highlight ? 'text-white/80' : 'text-muted-foreground')}>{desc}</p>
      <ul className="space-y-2 text-sm">
        {items.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Check className={cn('mt-0.5 size-4 shrink-0', highlight ? 'text-accent' : 'text-success')} aria-hidden />
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
