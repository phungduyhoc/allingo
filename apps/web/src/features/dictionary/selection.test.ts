import { describe, expect, it } from 'vitest';
import { cleanSelection, sentenceAround, toLookupTarget } from './selection';
import { popoverPosition } from './dom-selection';

const PASSAGE =
  'Thank you for your order. Neither the invoice nor the delivery note listed the correct quantity. Please contact us.';

describe('toLookupTarget – chọn từ → mục tra', () => {
  it('một từ: bỏ dấu câu hai đầu, ngữ cảnh = câu chứa từ', () => {
    const off = PASSAGE.indexOf('invoice');
    expect(toLookupTarget(' invoice, ', PASSAGE, off)).toEqual({
      term: 'invoice',
      context: 'Neither the invoice nor the delivery note listed the correct quantity.',
      mode: 'word',
      wordCount: 1,
    });
  });

  it('2–4 từ là cụm (kèm ngữ cảnh); > 4 từ là câu → dịch câu, không gửi context', () => {
    expect(toLookupTarget('delivery note', PASSAGE)).toMatchObject({
      term: 'delivery note',
      mode: 'phrase',
      wordCount: 2,
    });
    const sentence = 'Neither the invoice nor the delivery note listed the correct quantity.';
    expect(toLookupTarget(sentence, PASSAGE)).toEqual({
      term: 'Neither the invoice nor the delivery note listed the correct quantity',
      context: null,
      mode: 'sentence',
      wordCount: 11,
    });
  });

  it('từ có nháy/gạch giữ nguyên; ô trống ____ rút gọn; vùng chọn không có chữ hoặc quá dài → null', () => {
    expect(toLookupTarget('“follow-up”', null)?.term).toBe('follow-up');
    expect(toLookupTarget('o’clock.', null)?.term).toBe("o'clock");
    expect(toLookupTarget('  123 – 456 ', null)).toBeNull();
    expect(toLookupTarget('______', null)).toBeNull();
    expect(toLookupTarget('the ______ note', null)).toMatchObject({ term: 'the ___ note', mode: 'phrase' });
    expect(toLookupTarget('______ invoice', null)).toMatchObject({ term: 'invoice', mode: 'word' });
    expect(toLookupTarget('a '.repeat(260), null)).toBeNull();
    expect(cleanSelection('\n  multi\n  line \t')).toBe('multi line');
  });

  it('ngữ cảnh dài bị cắt ≤ 300 ký tự quanh vùng chọn', () => {
    const long = `${'word '.repeat(100)}target ${'more '.repeat(100)}`;
    const ctx = sentenceAround(long, long.indexOf('target'), 6);
    expect(ctx.length).toBeLessThanOrEqual(300);
    expect(ctx).toContain('target');
  });
});

describe('popoverPosition', () => {
  const vp = { width: 1280, height: 800, scrollX: 0, scrollY: 1000 };
  it('dưới vùng chọn, căn giữa, cộng scrollY (toạ độ trang)', () => {
    const p = popoverPosition(
      { top: 100, bottom: 120, left: 600, right: 660, width: 60, height: 20 },
      { width: 352, height: 300 },
      vp,
    );
    expect(p).toEqual({ top: 1128, left: 454, placement: 'below' });
  });
  it('thiếu chỗ phía dưới → lật lên trên; kẹp trong viewport ngang', () => {
    const p = popoverPosition(
      { top: 700, bottom: 720, left: 1250, right: 1270, width: 20, height: 20 },
      { width: 352, height: 300 },
      vp,
    );
    expect(p.placement).toBe('above');
    expect(p.top).toBe(1000 + 700 - 8 - 300);
    expect(p.left).toBe(1280 - 352 - 8);
  });
});
