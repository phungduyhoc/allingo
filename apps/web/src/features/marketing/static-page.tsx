import { Mail, MessageCircle, Building2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * /about, /contact (S10): nội dung tĩnh i18n (`marketing.about|contact`). Liên hệ: kênh hỗ trợ lấy từ i18n (cấu hình nội dung, không
 * hard-code trong mã) – địa chỉ email/Zalo chính thức do vận hành cập nhật trước beta (ghi ở docs/ASSUMPTIONS của web).
 */
export async function StaticInfoPage({ locale, kind }: { locale: string; kind: 'about' | 'contact' }) {
  const t = await getTranslations({ locale, namespace: `marketing.${kind}` });
  const sections = t.raw('sections') as Array<{ title: string; body: string }>;
  return (
    <article className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6 sm:py-16" data-testid={`${kind}-page`}>
      <header className="space-y-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-navy sm:text-5xl dark:text-foreground">{t('title')}</h1>
        <p className="text-lg leading-relaxed text-muted-foreground">{t('lead')}</p>
      </header>
      {kind === 'contact' ? (
        <ul className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['email', Mail],
              ['chat', MessageCircle],
              ['business', Building2],
            ] as const
          ).map(([k, Icon]) => (
            <li key={k} className="rounded-xl border border-border bg-card p-4">
              <Icon className="size-5 text-accent" aria-hidden />
              <p className="mt-2 text-sm font-semibold">{t(`channels.${k}.label`)}</p>
              <p className="mt-1 text-sm break-words text-muted-foreground">{t(`channels.${k}.value`)}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {sections.map((s) => (
        <section key={s.title} className="space-y-2">
          <h2 className="text-xl font-bold">{s.title}</h2>
          <p className="leading-relaxed text-muted-foreground">{s.body}</p>
        </section>
      ))}
    </article>
  );
}
