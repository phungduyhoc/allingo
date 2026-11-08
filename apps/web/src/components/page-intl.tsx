import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { pickMessages } from '@/lib/i18n-scope';
import { APP_PAGE_MESSAGES, type AppPageKey } from '@/lib/i18n-app-scopes';

/**
 * S11 (hiệu năng): thông điệp next-intl cho component client của MỘT trang khu vực học – thay cho toàn bộ ~100 KB thông điệp
 * trước đây (S10 chỉ tách cho marketing). Danh sách nhánh sinh tự động từ đồ thị import (`scripts/i18n-scopes.mjs`); provider
 * lồng THAY (không gộp) thông điệp của layout nên mỗi trang khai báo đủ phần của mình (+ common, errors).
 */
export async function PageIntl({ page, children }: { page: AppPageKey; children: React.ReactNode }) {
  return <NextIntlClientProvider messages={pickMessages(await getMessages(), APP_PAGE_MESSAGES[page])}>{children}</NextIntlClientProvider>;
}
