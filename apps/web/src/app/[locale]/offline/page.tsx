import { setRequestLocale } from 'next-intl/server';
import { OfflineContent } from '@/features/offline/offline-content';

export default async function OfflinePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OfflineContent />;
}
