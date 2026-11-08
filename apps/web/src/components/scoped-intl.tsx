import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { pickMessages } from '@/lib/i18n-scope';

/** Cấp thêm nhánh thông điệp cho component client của MỘT trang (nhóm marketing chỉ có phần dùng chung – lib/i18n-scope) */
export async function ScopedIntl({ namespaces, children }: { namespaces: readonly string[]; children: React.ReactNode }) {
  return <NextIntlClientProvider messages={pickMessages(await getMessages(), namespaces)}>{children}</NextIntlClientProvider>;
}
