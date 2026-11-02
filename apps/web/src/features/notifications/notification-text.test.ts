import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import { messages } from '@allingo/i18n';
import { NOTIFICATION_TEMPLATE_CODES, type NotificationItem } from '@allingo/schemas';
import { notificationText, resolveNotificationHref, templateParams, TEMPLATE_REQUIRED_PARAMS, type Translator } from './notification-text';

const tr = (locale: 'vi' | 'en'): Translator => createTranslator({ locale, messages: messages[locale], namespace: 'notifications', timeZone: 'Asia/Ho_Chi_Minh' }) as unknown as Translator;

const base = (over: Partial<NotificationItem>): NotificationItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  channel: 'inapp',
  template_code: 'billing.order_paid',
  payload: {},
  status: 'sent',
  scheduled_at: '2026-11-02T04:00:00Z',
  sent_at: '2026-11-02T04:00:00Z',
  read_at: null,
  category: 'billing',
  title: null,
  body: null,
  url: null,
  ...over,
});

describe('dịch thông báo theo template_code', () => {
  it('mọi mã NOTIFICATION_TEMPLATE_CODES có bản dịch vi/en (title + body) và khai báo tham số', () => {
    for (const locale of ['vi', 'en'] as const) {
      const t = tr(locale);
      for (const code of NOTIFICATION_TEMPLATE_CODES) {
        expect(t.has(`templates.${code}.title`), `${locale}:${code}`).toBe(true);
        expect(t.has(`templates.${code}.body`), `${locale}:${code}`).toBe(true);
        expect(TEMPLATE_REQUIRED_PARAMS[code]).toBeDefined();
      }
    }
  });

  it('title/body null → dịch ở web với tham số từ payload.data (tên gói đa ngôn ngữ, VND)', () => {
    const n = base({ payload: { data: { plan_name: { vi: 'TOEIC Pro – Tháng', en: 'TOEIC Pro – Monthly' }, total: 159200, order_id: '7eafd12d-1a08-40f6-bd3b-406ef193abdc' }, locale: 'vi' } });
    const vi = notificationText(n, tr('vi'), 'vi');
    expect(vi.source).toBe('web');
    expect(vi.title).toBe('Thanh toán thành công');
    expect(vi.body?.replace(/\s/g, ' ')).toBe('Đơn TOEIC Pro – Tháng – 159.200 ₫ đã được thanh toán.');
    const en = notificationText(n, tr('en'), 'en');
    expect(en.body).toBe('TOEIC Pro – Monthly – ₫159,200 was paid.');
  });

  it('referral: select theo vai trò + mốc thưởng', () => {
    const n = base({ template_code: 'growth.referral_rewarded', category: 'billing', payload: { data: { credits: 500, stage: 'upgraded', is_referrer: true } } });
    expect(notificationText(n, tr('vi'), 'vi')).toMatchObject({ title: 'Thưởng giới thiệu +500 credit', body: 'Bạn bè của bạn đã nâng cấp Pro.' });
    const referee = base({ template_code: 'growth.referral_rewarded', payload: { data: { credits: 200, stage: 'started', is_referrer: false } } });
    expect(notificationText(referee, tr('en'), 'en').body).toBe('Welcome gift from your referral.');
  });

  it('ngày theo giờ Việt Nam (trial_started)', () => {
    const n = base({ template_code: 'billing.trial_started', payload: { data: { plan_name: { vi: 'TOEIC Pro – Tháng', en: 'TOEIC Pro – Monthly' }, trial_days: 7, period_end: '2026-11-08T18:30:00Z' } } });
    const vi = notificationText(n, tr('vi'), 'vi');
    expect(vi.title).toBe('Đã kích hoạt dùng thử Pro');
    expect(vi.body).toContain('7 ngày');
    expect(vi.body).toContain('9 thg 11, 2026');
  });

  it('server đã dựng title cùng ngôn ngữ → dùng nguyên văn; khác ngôn ngữ → dịch ở web', () => {
    const n = base({ title: 'Đã có hoá đơn điện tử', body: 'Hoá đơn 1C26MAL-00000001 (159.200 ₫) – mã tra cứu EE4C.', template_code: 'billing.invoice_issued', payload: { locale: 'vi', data: { series: '1C26MAL', invoice_no: '00000001', total: 159200, lookup_code: 'EE4C' } } });
    expect(notificationText(n, tr('vi'), 'vi')).toMatchObject({ source: 'server', title: 'Đã có hoá đơn điện tử' });
    expect(notificationText(n, tr('en'), 'en')).toMatchObject({ source: 'web', title: 'Your e-invoice is ready', body: 'Invoice 1C26MAL-00000001 (₫159,200) – lookup code EE4C.' });
  });

  it('thiếu tham số bắt buộc → dùng title/body server; không có gì → chuỗi chung theo loại', () => {
    const missing = base({ template_code: 'billing.subscription_expiring', title: 'Pro plan expiring', body: 'x', payload: { locale: 'en', data: {} } });
    expect(notificationText(missing, tr('vi'), 'vi')).toMatchObject({ source: 'server', title: 'Pro plan expiring' });
    const unknown = base({ template_code: 'marketing.flash_sale', category: 'marketing', payload: {} });
    expect(notificationText(unknown, tr('vi'), 'vi')).toMatchObject({ source: 'generic', title: 'Ưu đãi mới', body: null });
  });

  it('templateParams: payload.data ưu tiên, mã đơn rút gọn, bỏ giá trị không hợp lệ', () => {
    const p = templateParams({ payload: { total: 1, data: { total: 199000, order_id: '7eafd12d-1a08-40f6', days_before: '3', op: 'issue', error_code: 'E1', attempts: 6 } } }, 'vi');
    expect(p).toMatchObject({ days: 3, op: 'issue', error: 'E1', attempts: 6, order: '7eafd12d' });
    expect(String(p.total).replace(/\s/g, ' ')).toBe('199.000 ₫');
  });
});

describe('resolveNotificationHref', () => {
  it('đường dẫn nội bộ, bỏ locale, ánh xạ đường dẫn chung của server', () => {
    expect(resolveNotificationHref('/account/orders/abc')).toBe('/account/orders/abc');
    expect(resolveNotificationHref('/vi/pricing')).toBe('/pricing');
    expect(resolveNotificationHref('/practice')).toBe('/toeic/practice');
    expect(resolveNotificationHref('/today?x=1')).toBe('/toeic/dashboard?x=1');
    expect(resolveNotificationHref('/admin/billing/dead-letters')).toBe('/admin/billing/dead-letters');
  });
  it('chặn URL ngoài / scheme lạ', () => {
    expect(resolveNotificationHref('https://evil.com')).toBeNull();
    expect(resolveNotificationHref('//evil.com')).toBeNull();
    expect(resolveNotificationHref('javascript:alert(1)')).toBeNull();
    expect(resolveNotificationHref(null)).toBeNull();
  });
});
