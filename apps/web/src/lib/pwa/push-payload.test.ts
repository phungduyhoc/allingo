import { describe, expect, it } from 'vitest';
import { notificationFromPayload, pushLocaleOf, safePushPath } from './push-payload';

const I18N = {
  vi: {
    study_reminder: { title: 'Đến giờ học rồi!', body: 'Dành 15 phút luyện TOEIC hôm nay.' },
    test: { title: 'Thông báo thử', body: 'Đã nhận.' },
  },
  en: {
    study_reminder: { title: 'Time to study!', body: 'Spend 15 minutes today.' },
    test: { title: 'Test notification', body: 'Received.' },
  },
};

describe('notificationFromPayload (service worker push)', () => {
  it('title/body null → dịch theo template_code + locale; giữ tag, notification_id; url thêm locale', () => {
    const n = notificationFromPayload(
      {
        v: 1,
        notification_id: 'n-1',
        template_code: 'study_reminder',
        title: null,
        body: null,
        url: '/toeic/dashboard',
        tag: 'study-2026-11-02',
        locale: 'en',
        sent_at: '2026-11-02T13:00:00Z',
      },
      I18N,
    );
    expect(n.title).toBe('Time to study!');
    expect(n.options).toMatchObject({
      body: 'Spend 15 minutes today.',
      tag: 'study-2026-11-02',
      lang: 'en',
      data: { url: '/en/toeic/dashboard', notification_id: 'n-1', template_code: 'study_reminder' },
    });
  });
  it('title/body có sẵn → dùng nguyên; chuỗi JSON cũng nhận; payload hỏng → mặc định "Đến giờ học" (vi)', () => {
    expect(
      notificationFromPayload(
        JSON.stringify({ template_code: 'test', title: 'Xin chào', body: 'Nội dung', url: '/vi/notes', locale: 'vi' }),
        I18N,
      ),
    ).toMatchObject({ title: 'Xin chào', options: { body: 'Nội dung', data: { url: '/vi/notes' } } });
    expect(notificationFromPayload('not json', I18N)).toMatchObject({
      title: 'Đến giờ học rồi!',
      options: { body: 'not json', lang: 'vi' },
    });
    expect(notificationFromPayload(null, I18N).title).toBe('Đến giờ học rồi!');
    expect(notificationFromPayload({ template_code: 'unknown_tpl', locale: 'vi' }, I18N).title).toBe(
      'Đến giờ học rồi!',
    );
  });
  it('đường dẫn mở khi bấm: chỉ tương đối cùng origin', () => {
    expect(safePushPath('https://evil.example', 'vi')).toBe('/vi/toeic/dashboard');
    expect(safePushPath('//evil.example/x', 'vi')).toBe('/vi/toeic/dashboard');
    expect(safePushPath('/', 'en')).toBe('/en/toeic/dashboard');
    expect(safePushPath('/vi/attempts/1/review', 'en')).toBe('/vi/attempts/1/review');
    expect(pushLocaleOf('en-US')).toBe('en');
    expect(pushLocaleOf('ja')).toBe('vi');
  });
});
