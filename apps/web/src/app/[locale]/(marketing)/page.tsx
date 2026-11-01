import { setRequestLocale } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import { BookOpenCheck, MessageSquareText, Route } from 'lucide-react';
import { Badge, buttonVariants, cn } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { TryFreeButton } from '@/features/auth/try-free-button';
import { SampleQuestionDemo } from '@/features/landing/sample-question-demo';

const PROGRAMS = ['toeic', 'ielts', 'jlpt', 'hsk'] as const;

function LandingContent() {
  const t = useTranslations('landing');
  const tp = useTranslations('programs');

  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-16 lg:pt-20 lg:pb-24">
        <div className="max-w-xl">
          <h1 className="text-4xl font-extrabold tracking-tight text-navy sm:text-5xl lg:text-6xl dark:text-foreground">{t('heroTitle')}</h1>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground sm:text-xl">{t('heroSubtitle')}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <TryFreeButton variant="gold" size="lg" className="shadow-[0_10px_30px_-12px_rgba(230,179,37,0.9)]" />
            <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}>
              {t('ctaLogin')}
            </Link>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{t('ctaTryHint')}</p>
        </div>
        <SampleQuestionDemo />
      </section>

      {/* Programs */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('programsTitle')}</h2>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t('programsSubtitle')}</p>
          <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {PROGRAMS.map((code) => {
              const active = code === 'toeic';
              return (
                <li
                  key={code}
                  className={cn(
                    'flex min-h-40 flex-col justify-between rounded-2xl border p-5',
                    active ? 'border-navy bg-navy text-navy-foreground' : 'border-border bg-background text-muted-foreground',
                  )}
                  data-testid={`program-${code}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn('text-2xl font-extrabold tracking-tight', active ? 'text-white' : 'text-foreground')}>{tp(code)}</span>
                    <Badge variant={active ? 'gold' : 'muted'}>{active ? tp('active') : tp('comingSoon')}</Badge>
                  </div>
                  <p className={cn('mt-4 text-sm leading-relaxed', active ? 'text-white/80' : '')}>{t(`programDesc.${code}`)}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Benefits */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{t('benefitsTitle')}</h2>
        <ul className="mt-10 grid gap-8 md:grid-cols-3">
          {(
            [
              ['explain', MessageSquareText],
              ['grade', BookOpenCheck],
              ['path', Route],
            ] as const
          ).map(([key, Icon]) => (
            <li key={key} className="border-l-4 border-accent pl-5">
              <Icon className="size-6 text-navy dark:text-accent" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold">{t(`benefits.${key}.title`)}</h3>
              <p className="mt-2 leading-relaxed text-muted-foreground">{t(`benefits.${key}.desc`)}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LandingContent />;
}
