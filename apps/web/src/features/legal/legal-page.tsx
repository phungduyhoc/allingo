import { getTranslations } from 'next-intl/server';
import { FileText, Scale } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle, Badge } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { fetchPoliciesServer, type Policy } from '@/lib/s12-api';

/**
 * Văn bản pháp lý (RSC). S12: phiên bản/ngày hiệu lực/trạng thái duyệt đọc từ `GET /legal/policies` (cache 300 s; lỗi → phiên bản
 * dự phòng); `status = draft_pending_legal_review` → nhãn "Bản nháp chờ luật sư duyệt" (SPEC-ISSUES S131). Nội dung hiển thị
 * (placeholder) ở packages/i18n `legal.*` – API chỉ phục vụ phiên bản.
 */
export const LEGAL_DOCS = ['terms', 'privacy', 'refund', 'voice-consent'] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

const TYPE_OF: Record<LegalDoc, Policy['type']> = { terms: 'terms', privacy: 'privacy', refund: 'refund_policy', 'voice-consent': 'voice_consent' };
const KEYS: Record<LegalDoc, { title: string; body: string }> = {
  terms: { title: 'termsTitle', body: 'termsBody' },
  privacy: { title: 'privacyTitle', body: 'privacyBody' },
  refund: { title: 'refundTitle', body: 'refundBody' },
  'voice-consent': { title: 'voiceTitle', body: 'voiceBody' },
};

export async function legalTitle(locale: string, kind: LegalDoc): Promise<string> {
  const t = await getTranslations({ locale, namespace: 'legal' });
  return t(KEYS[kind].title);
}

export async function LegalPage({ locale, kind }: { locale: string; kind: LegalDoc }) {
  const t = await getTranslations({ locale, namespace: 'legal' });
  const policies = await fetchPoliciesServer();
  const policy = policies?.find((p) => p.type === TYPE_OF[kind]) ?? null;
  const body = t.raw(KEYS[kind].body) as string[];
  // Tiêu đề theo API khi có (đa ngôn ngữ), không thì bản dịch web
  const title = (policy?.title && (locale === 'en' ? policy.title.en : policy.title.vi)) || t(KEYS[kind].title);
  const version = policy?.version ?? process.env.NEXT_PUBLIC_POLICY_VERSION ?? '2026-11';
  const effective = policy?.effective_date ?? `${version}-01`.slice(0, 10);
  const draft = !policy || policy.status === 'draft_pending_legal_review';
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'vi-VN', { dateStyle: 'long', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(`${effective}T00:00:00+07:00`));

  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-12 sm:px-6 sm:py-16" data-testid="legal-page" data-doc={kind} data-status={policy?.status ?? 'fallback'}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="size-5 text-muted-foreground" aria-hidden />
          {draft ? (
            <Badge variant="gold" data-testid="legal-draft-badge">
              {t('draftPending')}
            </Badge>
          ) : (
            <Badge variant="success">{t('approved')}</Badge>
          )}
        </div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground" data-testid="legal-version">
          {t('meta', { version, date })}
        </p>
      </header>
      {draft ? (
        <Alert variant="gold">
          <AlertTitle>{t('draftPending')}</AlertTitle>
          <AlertDescription>
            {t('draftNotice')} {t('draftPendingDesc')}
          </AlertDescription>
        </Alert>
      ) : null}
      {policy?.requires_consent ? <p className="text-sm text-muted-foreground">{t('consentNote')}</p> : null}
      <ol className="list-decimal space-y-3 pl-5 leading-relaxed">
        {body.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
      <nav aria-label={t('otherDocs')} className="border-t border-border pt-6">
        <h2 className="mb-3 text-sm font-semibold">{t('otherDocs')}</h2>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {LEGAL_DOCS.filter((d) => d !== kind).map((d) => (
            <li key={d}>
              <Link href={`/legal/${d}`} className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
                <FileText className="size-4" aria-hidden />
                {t(KEYS[d].title)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  );
}
