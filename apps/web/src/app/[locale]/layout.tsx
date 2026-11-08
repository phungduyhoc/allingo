import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/lib/query-provider';
import { Toaster } from '@/components/toaster';
import { ApiLocaleSync } from '@/components/api-locale-sync';
import { ServiceWorkerRegistrar } from '@/components/sw-registrar';
import { AttributionCapture } from '@/features/consent/funnel-tracker';
import { CONSENT_BOOT_SCRIPT } from '@/lib/analytics/consent';
import { pickMessages, ROOT_MESSAGES } from '@/lib/i18n-scope';
import { getServerFlags } from '@/lib/flags-server';
import { FlagsProvider } from '@/features/flags/flags-provider';
import { ApiErrorToasts } from '@/features/rate-limit/api-error-toasts';
import { Telemetry } from '@/components/telemetry';
import '../globals.css';

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'landing' });
  const tc = await getTranslations({ locale, namespace: 'common' });
  return {
    title: { default: `${tc('appName')} – ${tc('tagline')}`, template: `%s · ${tc('appName')}` },
    description: t('heroSubtitle'),
    applicationName: tc('appName'),
    manifest: '/manifest.webmanifest',
    icons: { icon: '/icons/icon.svg', apple: '/icons/icon-192.png' },
    appleWebApp: { capable: true, statusBarStyle: 'default', title: tc('appName') },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0B1F4B' },
    { media: '(prefers-color-scheme: dark)', color: '#0A1026' },
  ],
};

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // S10: chỉ thông điệp cho lớp gốc + trang ngoài nhóm; (app) và (marketing) tự cấp phần của mình (giảm payload RSC mỗi trang)
  const messages = pickMessages(await getMessages(), ROOT_MESSAGES);
  // S11: nonce CSP của request (src/proxy.ts) cho script inline của ứng dụng; đọc headers() ⇒ mọi trang render động (bắt buộc với nonce)
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  // S11: cờ công khai cho lần vẽ đầu (ẩn danh, cache 30 s, ≤ 400 ms) – client tải lại theo người dùng
  const initialFlags = await getServerFlags();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="min-h-dvh">
        {/* S10: đã chọn đồng ý cookie → html[data-consent] trước khi vẽ (CSS ẩn thanh đồng ý, không nháy/CLS) */}
        {/* nosemgrep: allingo-dangerously-set-inner-html – hằng số trong mã (không có dữ liệu người dùng), có nonce CSP */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: CONSENT_BOOT_SCRIPT }} />
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider nonce={nonce}>
            <QueryProvider>
              <FlagsProvider initial={initialFlags}>
                <ApiLocaleSync locale={locale} />
                {children}
                <Toaster />
                <ApiErrorToasts />
                <ServiceWorkerRegistrar />
                <AttributionCapture />
                <Telemetry />
              </FlagsProvider>
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
