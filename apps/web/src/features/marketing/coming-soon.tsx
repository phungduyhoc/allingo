import { BellRing, CheckCircle2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge } from '@allingo/ui';
import { FunnelTracker } from '@/features/consent/funnel-tracker';
import { WaitlistForm } from './waitlist-form';

/** /ielts · /jlpt · /hsk (S10): chương trình "sắp ra mắt" – điểm nổi bật dự kiến + đăng ký nhận thông báo (form client) */
export async function ComingSoonPage({ locale, program }: { locale: string; program: 'ielts' | 'jlpt' | 'hsk' }) {
  const t = await getTranslations({ locale, namespace: 'marketing.comingSoon' });
  const tp = await getTranslations({ locale, namespace: 'programs' });
  const tl = await getTranslations({ locale, namespace: 'landing' });
  const name = tp(program);
  const points = t.raw(`points.${program}`) as string[];
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20" data-testid={`coming-soon-${program}`}>
      <FunnelTracker event="landing_view" properties={{ program }} />
      <div className="max-w-xl">
        <Badge variant="gold">{tp('comingSoon')}</Badge>
        <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-navy sm:text-5xl dark:text-foreground">{t('title', { program: name })}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{tl(`programDesc.${program}`)}</p>
        <ul className="mt-8 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-xs leading-relaxed text-muted-foreground">{tl('footerTrademark')}</p>
      </div>
      <section aria-labelledby="waitlist-title" className="h-fit rounded-2xl border border-border bg-card p-6 shadow-[0_20px_60px_-30px_rgba(11,31,75,0.45)]">
        <h2 id="waitlist-title" className="flex items-center gap-2 text-xl font-bold">
          <BellRing className="size-5 text-accent" aria-hidden />
          {t('formTitle', { program: name })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('formDesc')}</p>
        <WaitlistForm program={program} />
      </section>
    </div>
  );
}
