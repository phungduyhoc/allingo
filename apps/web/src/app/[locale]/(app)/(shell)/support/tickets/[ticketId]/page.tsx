import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { TicketPage } from '@/features/support/ticket-page';
import { PageIntl } from '@/components/page-intl';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'support' });
  return { title: t('ticketTitle') };
}

export default async function Page({ params }: { params: Promise<{ locale: string; ticketId: string }> }) {
  const { locale, ticketId } = await params;
  setRequestLocale(locale);
  return (
    <PageIntl page="(shell)/support/tickets/[ticketId]">
      <TicketPage ticketId={ticketId} />
    </PageIntl>
  );
}
