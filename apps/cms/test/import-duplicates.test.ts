import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// API nội bộ: lần 1 trả kết quả từ catalog, lần 2 không kết nối được → chỉ kiểm tra trùng trong tệp
const findDuplicates = vi.fn();
vi.mock('../src/lib/internal-api', () => ({
  findDuplicates: (...args: unknown[]) => findDuplicates(...args),
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

const { detectDuplicates } = await import('../src/endpoints/import-questions');
const { parseImportJson } = await import('../src/lib/import-questions');

const samples = path.resolve(import.meta.dirname, '../samples');
const rows = parseImportJson(readFileSync(path.join(samples, 'questions.sample.json'), 'utf8')).rows;

describe('nhập hàng loạt – phát hiện trùng (Sprint 2)', () => {
  it('dùng kết quả API: trùng trong lô + trùng catalog → báo đúng dòng, bỏ khỏi danh sách nhập', async () => {
    findDuplicates.mockResolvedValueOnce({ threshold: 0.85, in_batch: [{ index: 3, duplicate_of: 0, similarity: 0.97 }], existing: [{ index: 5, question_id: 'q-1', similarity: 0.9, status: 'published' }] });
    const r = await detectDuplicates(rows);
    expect(r.keep).toHaveLength(rows.length - 2);
    expect(r.duplicates.map((d) => d.row)).toEqual([rows[3]!.row, rows[5]!.row]);
    expect(r.errors[0]?.message).toMatch(/Trùng dòng/);
    expect(r.errors[1]?.message).toMatch(/catalog/);
    expect(r.warnings).toEqual([]);
  });

  it('API không chạy → vẫn phát hiện trùng trong tệp, có cảnh báo', async () => {
    findDuplicates.mockRejectedValue(new Error('ECONNREFUSED'));
    const dupRows = [...rows.slice(0, 4), { ...rows[1]!, row: 99 }];
    const r = await detectDuplicates(dupRows);
    expect(r.duplicates).toEqual([{ row: 99, duplicate_of_row: rows[1]!.row, similarity: 1 }]);
    expect(r.keep).toHaveLength(4);
    expect(r.warnings[0]).toMatch(/Không kiểm tra trùng với catalog/);
  });
});
