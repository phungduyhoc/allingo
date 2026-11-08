import { describe, expect, it } from 'vitest';
import { isDangerousLinkTarget, sanitizeNoteMarkdown } from '../src/index.js';

/** S11 – pentest 1, kịch bản 10 (XSS trong ghi chú/markdown): payload vượt bộ lọc cũ phải bị vô hiệu ở API */
describe('sanitizeNoteMarkdown – hồi quy XSS (pentest 1)', () => {
  const payloads: Array<[string, string]> = [
    ['<scr<script>ipt>alert(1)</scr</script>ipt>', 'alert(1)'],
    ['<<img src=x onerror=alert(1)>img src=x onerror=alert(1)>', ''],
    ['<img src=x onerror=alert(1)>', ''],
    ['<svg/onload=alert(1)>', ''],
    ['<!-- <script> -->ok', 'ok'],
    ['[a](javascript:alert(1))', '[a]()'],
    ['[a](JaVaScRiPt:alert(1))', '[a]()'],
    ['[a](&#106;avascript:alert(1))', '[a]()'],
    ['[a](&#x6A;avascript:alert(1))', '[a]()'],
    ['[a](java&#9;script:alert(1))', '[a]()'],
    ['[a](%6Aavascript:alert(1))', '[a]()'],
    ['[a](data:text/html;base64,PHNjcmlwdD4=)', '[a]()'],
    ['[a]: javascript:alert(1)', '[a]: #'],
    ['[a]: &#x6a;avascript:alert(1) "t"', '[a]: #'],
  ];
  for (const [input, expected] of payloads) {
    it(`vô hiệu: ${input.slice(0, 40)}`, () => {
      const out = sanitizeNoteMarkdown(input);
      expect(out).toBe(expected);
      expect(out.toLowerCase()).not.toMatch(/<\s*(script|img|svg)|onerror|onload|javascript:/);
    });
  }

  it('giữ Markdown hợp lệ (liên kết https/tương đối, code, ký hiệu so sánh có khoảng trắng)', () => {
    expect(sanitizeNoteMarkdown('**Nhớ**: [link](https://allingo.vn/a_(b)) và `code`')).toBe('**Nhớ**: [link](https://allingo.vn/a_(b)) và `code`');
    expect(sanitizeNoteMarkdown('[ok](/toeic/practice?part=5)')).toBe('[ok](/toeic/practice?part=5)');
    expect(sanitizeNoteMarkdown('a < b và 3 > 2')).toBe('a < b và 3 > 2');
    expect(sanitizeNoteMarkdown('dòng 1\r\n\r\n\r\n\r\ndòng 2')).toBe('dòng 1\n\ndòng 2');
  });

  it('isDangerousLinkTarget', () => {
    expect(isDangerousLinkTarget('  javascript:alert(1)')).toBe(true);
    expect(isDangerousLinkTarget('vbscript:x')).toBe(true);
    expect(isDangerousLinkTarget('https://allingo.vn')).toBe(false);
    expect(isDangerousLinkTarget('/toeic')).toBe(false);
    expect(isDangerousLinkTarget('mailto:hi@allingo.vn')).toBe(false);
  });
});
