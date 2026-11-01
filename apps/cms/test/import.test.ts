import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectImportFormat, parseImportCsv, parseImportJson } from '../src/lib/import-questions';

const samples = path.resolve(import.meta.dirname, '../samples');

describe('nhập hàng loạt – JSON', () => {
  it('đọc được 16 câu mẫu TOEIC (samples/questions.sample.json)', () => {
    const res = parseImportJson(readFileSync(path.join(samples, 'questions.sample.json'), 'utf8'));
    expect(res.errors).toEqual([]);
    expect(res.rows).toHaveLength(16);
    expect(res.rows.filter((r) => r.sectionCode === 'part5')).toHaveLength(10);
    expect(res.rows.filter((r) => r.sectionCode === 'part2')).toHaveLength(6);
    expect(res.rows.every((r) => r.content.type === 'mcq_single')).toBe(true);
  });

  it('báo lỗi theo dòng, dòng hợp lệ vẫn được nhận', () => {
    const res = parseImportJson(
      JSON.stringify([
        { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: { type: 'mcq_single', stem: 'x', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer_key: { correct: 'C' } } },
        { program: 'toeic', section_code: 'part5', question_type: 'nope', content: {} },
        { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: { type: 'mcq_single', stem: 'ok', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer_key: { correct: 'A' } } },
      ]),
    );
    expect(res.rows.map((r) => r.row)).toEqual([3]);
    expect(res.errors.map((e) => e.row)).toEqual([1, 2]);
    expect(res.errors[0]?.message).toContain('"C"');
  });

  it('JSON hỏng hoặc không phải mảng → lỗi dòng 0', () => {
    expect(parseImportJson('{').errors[0]?.row).toBe(0);
    expect(parseImportJson('{"a":1}').errors[0]?.message).toContain('mảng');
  });
});

describe('nhập hàng loạt – CSV', () => {
  it('đọc questions.sample.csv thành mcq_single với explanation vi/en', () => {
    const res = parseImportCsv(readFileSync(path.join(samples, 'questions.sample.csv'), 'utf8'));
    expect(res.errors).toEqual([]);
    expect(res.rows.length).toBeGreaterThanOrEqual(3);
    const first = res.rows[0]!;
    expect(first.content.type).toBe('mcq_single');
    if (first.content.type === 'mcq_single') {
      expect(first.content.options).toHaveLength(4);
      expect(first.content.explanation?.vi).toBeTruthy();
    }
  });

  it('thiếu cột bắt buộc / dạng khác mcq_single → lỗi theo dòng', () => {
    const csv = ['program,section_code,question_type,stem,option_a,option_b,correct', 'toeic,part5,fill_blank,x,a,b,A', 'toeic,part5,mcq_single,,a,b,A', 'toeic,part5,mcq_single,ok,a,b,B'].join('\n');
    const res = parseImportCsv(csv);
    expect(res.errors.map((e) => e.row)).toEqual([1, 2]);
    expect(res.rows.map((r) => r.row)).toEqual([3]);
  });

  it('detectImportFormat theo đuôi tệp rồi nội dung', () => {
    expect(detectImportFormat('a.csv', '[')).toBe('csv');
    expect(detectImportFormat('a.json', 'x')).toBe('json');
    expect(detectImportFormat(undefined, '  [ {} ]')).toBe('json');
    expect(detectImportFormat(undefined, 'program,section')).toBe('csv');
  });
});
