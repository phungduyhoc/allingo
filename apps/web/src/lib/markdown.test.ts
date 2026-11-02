import { describe, expect, it } from 'vitest';
import { markdownToText, parseInline, parseMarkdown, safeHref } from './markdown';

describe('Markdown ngắn an toàn (gia sư, ghi chú)', () => {
  it('khối: đoạn, tiêu đề, danh sách, trích dẫn, mã', () => {
    const blocks = parseMarkdown(
      '# Mẹo\n\nDòng 1\nDòng 2\n\n- by + mốc\n- until + khoảng\n\n1. Đọc\n2. Chọn\n\n> ghi nhớ\n\n```\ncode\n```',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'p', 'ul', 'ol', 'quote', 'code']);
    expect(blocks[1]).toEqual({
      kind: 'p',
      inline: [{ kind: 'text', text: 'Dòng 1' }, { kind: 'br' }, { kind: 'text', text: 'Dòng 2' }],
    });
    expect(blocks[2]).toMatchObject({
      kind: 'ul',
      items: [[{ kind: 'text', text: 'by + mốc' }], [{ kind: 'text', text: 'until + khoảng' }]],
    });
    expect(blocks[3]).toMatchObject({ kind: 'ol', start: 1 });
  });

  it('inline: đậm, nghiêng, mã, liên kết http(s)', () => {
    expect(parseInline('Đáp án **B** là *đúng*, dùng `by` – [xem](https://allingo.vn/a)')).toEqual([
      { kind: 'text', text: 'Đáp án ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'B' }] },
      { kind: 'text', text: ' là ' },
      { kind: 'em', children: [{ kind: 'text', text: 'đúng' }] },
      { kind: 'text', text: ', dùng ' },
      { kind: 'code', text: 'by' },
      { kind: 'text', text: ' – ' },
      { kind: 'link', href: 'https://allingo.vn/a', children: [{ kind: 'text', text: 'xem' }] },
    ]);
  });

  it('liên kết javascript:/data: → chữ thường; HTML thô giữ là chữ (không render)', () => {
    expect(parseInline('[bấm](javascript:alert(1))')).toEqual([{ kind: 'text', text: 'bấm' }]);
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('/vi/notes')).toBe('/vi/notes');
    expect(safeHref('//evil.example')).toBeNull();
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      { kind: 'p', inline: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ]);
  });

  it('dấu * / _ trong từ không thành nghiêng; markdownToText bỏ ký hiệu', () => {
    expect(parseInline('snake_case_name 2*3*4')).toEqual([
      { kind: 'text', text: 'snake_case_name 2' },
      { kind: 'em', children: [{ kind: 'text', text: '3' }] },
      { kind: 'text', text: '4' },
    ]);
    expect(markdownToText('**Mẹo**: dùng *by*\n\n- một\n- hai')).toBe('Mẹo: dùng by một · hai');
  });
});
