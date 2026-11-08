import { describe, expect, it } from 'vitest';
import { buildFeedbackInput, checkScreenshot, FEEDBACK_MAX_IMAGE_BYTES, feedbackPagePath, imageFromClipboard, webAppVersion } from './feedback';

describe('payload góp ý in-app (S12)', () => {
  it('đường dẫn trang: bỏ query/hash (token, mã mời, email) và tiền tố locale', () => {
    expect(feedbackPagePath('/vi/notifications/manage?token=secret#x')).toBe('/notifications/manage');
    expect(feedbackPagePath('/en/attempts/9a0c/review')).toBe('/attempts/9a0c/review');
    expect(feedbackPagePath('/vi')).toBe('/');
    expect(feedbackPagePath(null)).toBeUndefined();
  });

  it('chuẩn hoá theo feedbackInputSchema: trim, trace hợp lệ, ảnh, phiên bản – không trường thừa', () => {
    const r = buildFeedbackInput({ category: 'bug', message: '  Audio Part 3 bị rè  ', screenshotUploadId: '0b5e6a2c-1f7d-4c1a-9d2e-3f4a5b6c7d8e' }, { pathname: '/vi/attempts/1?x=1', traceId: '4bf92f3577b34da6a3ce929d0e0e4736', appVersion: 'allingo-web@abc' });
    expect(r).toEqual({ ok: true, input: { category: 'bug', message: 'Audio Part 3 bị rè', page_url: '/attempts/1', trace_id: '4bf92f3577b34da6a3ce929d0e0e4736', screenshot_upload_id: '0b5e6a2c-1f7d-4c1a-9d2e-3f4a5b6c7d8e', app_version: 'allingo-web@abc' } });
    const noTrace = buildFeedbackInput({ category: 'idea', message: 'Thêm chế độ tối' }, { pathname: '/toeic/dashboard', traceId: 'bad trace!', appVersion: 'v' });
    expect(noTrace.ok && noTrace.input).toEqual({ category: 'idea', message: 'Thêm chế độ tối', page_url: '/toeic/dashboard', app_version: 'v' });
    expect(Object.keys(noTrace.ok ? noTrace.input : {})).not.toContain('screenshot_upload_id');
  });

  it('lỗi tại chỗ: quá ngắn, quá dài, loại sai', () => {
    expect(buildFeedbackInput({ category: 'bug', message: ' a ' }, { pathname: '/', traceId: null })).toEqual({ ok: false, error: 'message_short' });
    expect(buildFeedbackInput({ category: 'bug', message: 'x'.repeat(4001) }, { pathname: '/', traceId: null })).toEqual({ ok: false, error: 'message_long' });
    expect(buildFeedbackInput({ category: 'spam' as never, message: 'hello' }, { pathname: '/', traceId: null })).toEqual({ ok: false, error: 'category' });
  });

  it('ảnh: chỉ PNG/JPEG/WebP (như /uploads/presign), ≤ 8 MB; dán từ clipboard', () => {
    expect(checkScreenshot({ type: 'image/png', size: 1000 })).toBe('ok');
    expect(checkScreenshot({ type: 'image/svg+xml', size: 1000 })).toBe('type');
    expect(checkScreenshot({ type: 'image/gif', size: 1000 })).toBe('type');
    expect(checkScreenshot({ type: 'image/jpeg', size: FEEDBACK_MAX_IMAGE_BYTES + 1 })).toBe('size');
    expect(checkScreenshot({ type: 'image/webp', size: 0 })).toBe('empty');
    const file = { name: 'shot.png' } as File;
    const items = [{ kind: 'string', type: 'text/plain', getAsFile: () => null }, { kind: 'file', type: 'image/png', getAsFile: () => file }];
    expect(imageFromClipboard({ items: items as unknown as DataTransferItemList })).toBe(file);
    expect(imageFromClipboard({ items: [items[0]] as unknown as DataTransferItemList })).toBeNull();
    expect(imageFromClipboard(null)).toBeNull();
  });

  it('app_version ≤ 40 ký tự', () => {
    expect(webAppVersion('allingo-web@' + 'a'.repeat(60))).toHaveLength(40);
  });
});
