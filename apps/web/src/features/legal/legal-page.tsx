import { getTranslations } from 'next-intl/server';
import { Alert, AlertDescription } from '@allingo/ui';

/** Trang pháp lý tĩnh (SSG). Nội dung trong packages/i18n `legal.*` – bản dự thảo, pháp chế duyệt trước GATE-3. */
export async function LegalPage({ locale, kind }: { locale: string; kind: 'terms' | 'privacy' }) {
  const t = await getTranslations({ locale, namespace: 'legal' });
  const body = t.raw(kind === 'terms' ? 'termsBody' : 'privacyBody') as string[];
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6 sm:py-16">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{t(kind === 'terms' ? 'termsTitle' : 'privacyTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('updated', { version: process.env.NEXT_PUBLIC_POLICY_VERSION ?? '2026-11' })}</p>
      </header>
      <Alert variant="gold">
        <AlertDescription>{t('draftNotice')}</AlertDescription>
      </Alert>
      <ol className="list-decimal space-y-3 pl-5 leading-relaxed">
        {body.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
    </article>
  );
}
