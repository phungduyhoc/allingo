import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markCount } from '@allingo/schemas/question/marks';
import { IELTS_LISTENING_01_SET, IELTS_MOCK_PART_AUDIO_MS, IELTS_READING_ACADEMIC_01_SET, MOCK_IELTS_TEST_SETS } from './ielts-fixtures';

/** C3 – mock đề IELTS đầy đủ dùng cùng nội dung với seed demo: id không trùng, 40 câu theo mục, audio part có tệp thật */

describe('mock đề IELTS đầy đủ', () => {
  it('id câu/phiên bản/đề không trùng giữa mọi đề IELTS mock', () => {
    const ids = MOCK_IELTS_TEST_SETS.flatMap((t) => [t.id, ...t.questions.flatMap((q) => [q.question_id, q.question_version_id])]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([
    [IELTS_READING_ACADEMIC_01_SET, { reading_p1: 13, reading_p2: 13, reading_p3: 14 }],
    [IELTS_LISTENING_01_SET, { listening_p1: 10, listening_p2: 10, listening_p3: 10, listening_p4: 10 }],
  ])('%#: 40 câu theo mục, sections.question_count = số mục', (set, expected) => {
    expect(Object.fromEntries(set.sections.map((s) => [s.code, s.question_count]))).toEqual(expected);
    expect(set.questions.reduce((sum, q) => sum + markCount(q.content), 0)).toBe(40);
    expect(set.kind).toBe('full');
  });

  it('Reading ghi hình thức academic; Listening mỗi part một audio có tệp trong public và mốc thời gian phủ đủ độ dài', () => {
    expect(IELTS_READING_ACADEMIC_01_SET.level).toBe('academic');
    expect(IELTS_LISTENING_01_SET.level).toBeNull();
    const passages = new Map(IELTS_LISTENING_01_SET.questions.map((q) => [q.passage!.id, q.passage!]));
    expect(passages.size).toBe(4);
    for (const p of passages.values()) {
      expect(p.media_url).toMatch(/^\/demo-audio\/ielts\/l01-p[1-4]\.mp3$/);
      expect(existsSync(join(process.cwd(), 'public', p.media_url!))).toBe(true);
      expect(p.segments?.at(-1)?.end_ms).toBe(IELTS_MOCK_PART_AUDIO_MS);
    }
  });
});
