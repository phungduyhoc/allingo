import { describe, expect, it } from 'vitest';
import { formatBand, marksTotal, parseBandScale } from './ielts-band';
import { programFlagsSignature } from '@/features/flags/flags-provider';

/** C3 – thẻ band IELTS ở màn kết quả + S168 (chữ ký cờ ra mắt chương trình) */

describe('parseBandScale', () => {
  it('band từng kỹ năng theo thứ tự L/R/W/S, số câu đúng /40, hình thức Reading; overall null khi chưa đủ 4 kỹ năng', () => {
    const v = parseBandScale({ program: 'ielts', unit: 'band', band: null, bands: { reading: 6.5, listening: 7 }, raw: { listening: { correct: 31, total: 40 }, reading: { correct: 27, total: 40 } }, module: 'general_training', partial: true });
    expect(v).toEqual({
      bands: [
        { skill: 'listening', band: 7, correct: 31, total: 40 },
        { skill: 'reading', band: 6.5, correct: 27, total: 40 },
      ],
      overall: null,
      module: 'general_training',
    });
  });
  it('đủ 4 kỹ năng → overall; band sai bước 0,5/ngoài 0–9 bị bỏ; thang khác band → null', () => {
    expect(parseBandScale({ unit: 'band', band: 6.5, bands: { listening: 7, reading: 6.3, writing: 10 } })?.bands.map((b) => b.skill)).toEqual(['listening']);
    expect(parseBandScale({ unit: 'band', band: 6.5, bands: {} })?.overall).toBe(6.5);
    expect(parseBandScale({ unit: 'points', total: 700 })).toBeNull();
    expect(parseBandScale(null)).toBeNull();
  });
  it('formatBand luôn một chữ số thập phân; marksTotal ưu tiên số mục', () => {
    expect(formatBand(7)).toBe('7.0');
    expect(formatBand(6.5)).toBe('6.5');
    expect(marksTotal({ reading_p1: { correct: 3, total: 4, marks: 10, max_marks: 13 }, part5: { correct: 2, total: 3 } })).toEqual({ correct: 12, total: 16 });
  });
});

describe('programFlagsSignature (S168)', () => {
  it('chỉ phụ thuộc cờ ff.catalog.program.* (thứ tự khoá không ảnh hưởng)', () => {
    const a = programFlagsSignature({ ttlSec: 30, flags: { 'ff.ai.explain': true, 'ff.catalog.program.ielts': false, 'ff.catalog.program.jlpt': false } } as never);
    const b = programFlagsSignature({ ttlSec: 30, flags: { 'ff.catalog.program.jlpt': false, 'ff.ai.explain': false, 'ff.catalog.program.ielts': false } } as never);
    const c = programFlagsSignature({ ttlSec: 30, flags: { 'ff.catalog.program.ielts': true, 'ff.catalog.program.jlpt': false } } as never);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(programFlagsSignature(null)).toBe('');
  });
});
