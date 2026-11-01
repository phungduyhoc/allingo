import { describe, expect, it } from 'vitest';
import { isListeningSection, mergeListeningMedia } from '../src/lib/listening';
import { validateQuestionContent } from '../src/lib/validate';

const part2 = (media?: Record<string, unknown>) => ({
  type: 'mcq_single',
  stem: '',
  options: [
    { key: 'A', text: '' },
    { key: 'B', text: '' },
    { key: 'C', text: '' },
  ],
  answer_key: { correct: 'B' },
  ...(media ? { media } : {}),
});

describe('trường Listening media.listen_policy / media.pause_ms (Sprint 4)', () => {
  it('nhận diện section Listening theo chương trình', () => {
    expect(['part1', 'part2', 'part3', 'part4'].every((p) => isListeningSection('toeic', p))).toBe(true);
    expect(isListeningSection('toeic', 'part5')).toBe(false);
    expect(isListeningSection('ielts', 'listening_p2')).toBe(true);
    expect(isListeningSection('jlpt', 'listening')).toBe(true);
    expect(isListeningSection('ielts', 'reading_p1')).toBe(false);
    expect(isListeningSection('toeic', null)).toBe(false);
  });

  it('tạo mới từ form: ghi vào content.media; content sau đó hợp lệ Zod và đi qua sync', () => {
    const r = mergeListeningMedia({ program: 'toeic', sectionCode: 'part2', content: part2({ audio_asset_id: '00000000-0000-4000-8000-000000000001' }), fields: { listen_policy: 'once', pause_ms: 5000.4 }, isCreate: true });
    const c = r.content as { media: Record<string, unknown> };
    expect(c.media).toEqual({ audio_asset_id: '00000000-0000-4000-8000-000000000001', listen_policy: 'once', pause_ms: 5000 });
    expect(r.fields).toEqual({ listen_policy: 'once', pause_ms: 5000 });
    const v = validateQuestionContent('mcq_single', r.content);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.value.media).toMatchObject({ listen_policy: 'once', pause_ms: 5000 });
  });

  it('tạo mới không khai báo (nhập lô): mặc định once; pause_ms kẹp 0–60 000', () => {
    expect((mergeListeningMedia({ program: 'toeic', sectionCode: 'part3', content: part2(), fields: undefined, isCreate: true }).content as { media: unknown }).media).toEqual({ listen_policy: 'once' });
    const big = mergeListeningMedia({ program: 'toeic', sectionCode: 'part1', content: part2(), fields: { pause_ms: 999_999 }, isCreate: true });
    expect(big.fields).toEqual({ listen_policy: 'once', pause_ms: 60_000 });
  });

  it('sửa: form đổi → form thắng; form giữ nguyên → JSON thắng (sửa trực tiếp JSON); để trống không xoá JSON', () => {
    const content = part2({ listen_policy: 'once', pause_ms: 4000 });
    const formChanged = mergeListeningMedia({ program: 'toeic', sectionCode: 'part2', content, fields: { listen_policy: 'free', pause_ms: 4000 }, previousFields: { listen_policy: 'once', pause_ms: 4000 }, isCreate: false });
    expect((formChanged.content as { media: unknown }).media).toEqual({ listen_policy: 'free', pause_ms: 4000 });
    const jsonEdited = mergeListeningMedia({ program: 'toeic', sectionCode: 'part2', content: part2({ listen_policy: 'free', pause_ms: 8000 }), fields: { listen_policy: 'once', pause_ms: 4000 }, previousFields: { listen_policy: 'once', pause_ms: 4000 }, isCreate: false });
    expect(jsonEdited.fields).toEqual({ listen_policy: 'free', pause_ms: 8000 });
    const cleared = mergeListeningMedia({ program: 'toeic', sectionCode: 'part2', content, fields: { listen_policy: 'once', pause_ms: null }, previousFields: { listen_policy: 'once', pause_ms: 4000 }, isCreate: false });
    expect((cleared.content as { media: { pause_ms: number } }).media.pause_ms).toBe(4000);
  });

  it('sửa câu cũ không có media: không tự thêm media (tránh tạo phiên bản mới ngoài ý muốn); không phải Listening → giữ nguyên', () => {
    const noMedia = part2();
    const r = mergeListeningMedia({ program: 'toeic', sectionCode: 'part3', content: noMedia, fields: null, previousFields: null, isCreate: false });
    expect(r.content).toBe(noMedia);
    expect(r.fields).toEqual({ listen_policy: null, pause_ms: null });
    const reading = { type: 'mcq_single', stem: 'x' };
    expect(mergeListeningMedia({ program: 'toeic', sectionCode: 'part5', content: reading, fields: { listen_policy: 'once' }, isCreate: true })).toEqual({ content: reading, fields: undefined });
  });
});
