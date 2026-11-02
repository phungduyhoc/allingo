import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { AuthForm } from '@/features/auth/auth-form';
import { ReferralCapture } from '@/features/referral/referral-capture';

/** Đích của link giới thiệu (API `/r/{code}` → `/register?ref=<code>&utm_*`) – OG tĩnh public/og/referral.png */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'referral.landing' });
  const title = t('ogTitle');
  const description = t('ogDescription');
  return {
    title,
    description,
    openGraph: { title, description, type: 'website', images: [{ url: '/og/referral.png', width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: ['/og/referral.png'] },
  };
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 py-12 sm:px-6 sm:py-20">
      <ReferralCapture />
      <AuthForm mode="signup" />
    </div>
  );
}
