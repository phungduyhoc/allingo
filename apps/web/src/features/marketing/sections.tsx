import { ShieldAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge, cn } from '@allingo/ui';

/** Phần tĩnh dùng chung của trang marketing (server, không JS): 4 chương trình, tuyên bố không liên kết ETS, định dạng đề TOEIC */

const PROGRAMS = ['toeic', 'ielts', 'jlpt', 'hsk'] as const;

export async function ProgramsSection({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'landing' });
  const tp = await getTranslations({ locale, namespace: 'programs' });
  return (
    <section className="border-y border-border bg-card" data-testid="programs-section">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{t('programsTitle')}</h2>
        <p className="mt-2 max-w-2xl text-muted-foreground">{t('programsSubtitle')}</p>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {PROGRAMS.map((code) => {
            const active = code === 'toeic';
            return (
              <li key={code} data-testid={`program-${code}`}>
                <a
                  href={`/${locale === 'en' ? 'en' : 'vi'}/${code}`}
                  className={cn('flex h-full min-h-40 flex-col justify-between rounded-2xl border p-5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40', active ? 'border-navy bg-navy text-navy-foreground' : 'border-border bg-background text-muted-foreground hover:border-navy/40')}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className={cn('text-2xl font-extrabold tracking-tight', active ? 'text-white' : 'text-foreground')}>{tp(code)}</span>
                    <Badge variant={active ? 'gold' : 'muted'}>{active ? tp('active') : tp('comingSoon')}</Badge>
                  </span>
                  <span className={cn('mt-4 text-sm leading-relaxed', active ? 'text-white/80' : '')}>{t(`programDesc.${code}`)}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Tuyên bố không liên kết ETS (trang TOEIC – yêu cầu pháp lý S12) */
export async function EtsDisclaimer({ locale, className }: { locale: string; className?: string }) {
  const t = await getTranslations({ locale, namespace: 'marketing' });
  return (
    <aside className={cn('mx-auto max-w-6xl px-4 sm:px-6', className)} aria-label={t('etsTitle')} data-testid="ets-disclaimer">
      <div className="flex gap-3 rounded-xl border border-accent/60 bg-accent/10 p-4 text-sm leading-relaxed">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
        <p>
          <span className="font-semibold">{t('etsTitle')}. </span>
          {t('etsBody')}
        </p>
      </div>
    </aside>
  );
}

/** Định dạng TOEIC L&R (7 Part) – cột phải hero trang TOEIC */
export async function ToeicFormatCard({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'marketing.toeicFormat' });
  const ts = await getTranslations({ locale, namespace: 'sections' });
  const parts: Array<[string, number]> = [
    ['part1', 6],
    ['part2', 25],
    ['part3', 39],
    ['part4', 30],
    ['part5', 30],
    ['part6', 16],
    ['part7', 54],
  ];
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_20px_60px_-30px_rgba(11,31,75,0.45)] sm:p-6">
      <h2 className="text-sm font-semibold text-muted-foreground">{t('title')}</h2>
      <table className="mt-4 w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th>{t('part')}</th>
            <th>{t('items')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {parts.map(([code, n], i) => (
            <tr key={code}>
              <td className="py-2">
                <span className={cn('mr-2 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold', i < 4 ? 'bg-navy text-navy-foreground' : 'bg-accent text-accent-foreground')}>{i < 4 ? 'L' : 'R'}</span>
                {ts(code)}
              </td>
              <td className="tabular py-2 text-right font-semibold">{t('itemsCount', { count: n })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-4 text-xs text-muted-foreground">{t('note')}</p>
    </div>
  );
}
