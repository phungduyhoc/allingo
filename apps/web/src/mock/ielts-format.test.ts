import { describe, expect, it } from 'vitest';
import { evidenceSegmentsOf, mockSectionClock } from './ielts-format';
import type { MockQuestion, MockTestSet } from './fixtures';
import type { MockAttemptRecord } from './state';

/** C3 – mock: dòng transcript chứa đáp án, đồng hồ theo section (kỹ năng) của Exam Mode IELTS */

describe('evidenceSegmentsOf', () => {
  const segs = [
    { start_ms: 0, end_ms: 2000, speaker: 'W1', text: 'Good morning, how can I help?' },
    { start_ms: 2000, end_ms: 5000, speaker: 'M1', text: 'I would like to book the  Riverside hall for Friday.' },
  ];
  it('khớp không phân biệt hoa thường/khoảng trắng; không có evidence → rỗng', () => {
    expect(evidenceSegmentsOf(segs, 'riverside hall')).toEqual([1]);
    expect(evidenceSegmentsOf(segs, null)).toEqual([]);
    expect(evidenceSegmentsOf(undefined, 'hall')).toEqual([]);
  });
});

describe('mockSectionClock', () => {
  const q = (n: number, section: string): MockQuestion => ({ question_id: `q${n}`, question_version_id: `v${n}`, section_code: section, group_key: null, order_no: n, content: { type: 'mcq_single', stem: 'x', options: [], tags: [], answer_key: { correct: 'A' } } as never, media: [], passage: null, community_correct_rate: 50 });
  const ts = { kind: 'full', sections: [{ code: 'listening_p1', skill: 'listening', duration_sec: 600 }, { code: 'reading_p1', skill: 'reading', duration_sec: 1200 }] } as unknown as MockTestSet;
  const started = Date.now() - 700_000;
  const a = { program: 'ielts', mode: 'exam', started_at: new Date(started).toISOString(), expires_at: new Date(started + 1_800_000).toISOString() } as MockAttemptRecord;

  it('Listening hết hạn trước (khoá); Reading chưa bắt đầu → chưa có hạn; part_switch sang Reading → hạn = expires_at', () => {
    const c = mockSectionClock({ ...a, events: [] }, ts, [q(1, 'listening_p1'), q(2, 'reading_p1')]);
    expect(c.get('listening_p1')).toEqual({ skill: 'listening', ends_at: new Date(started + 600_000).toISOString(), locked: true });
    expect(c.get('reading_p1')).toEqual({ skill: 'reading', ends_at: null, locked: false });
    const switched = { ...a, events: [{ type: 'part_switch', at: new Date(started + 300_000).toISOString(), meta: { section_code: 'reading_p1' } }] };
    const c2 = mockSectionClock(switched, ts, [q(1, 'listening_p1'), q(2, 'reading_p1')]);
    expect(c2.get('reading_p1')).toEqual({ skill: 'reading', ends_at: a.expires_at, locked: false });
    expect(c2.get('listening_p1')?.locked).toBe(true);
  });
  it('đề mini → một đồng hồ chung', () => {
    expect(mockSectionClock({ ...a, events: [] }, { ...ts, kind: 'mini' }, [q(1, 'listening_p1')]).get('listening_p1')?.ends_at).toBeNull();
  });
  it('practice/TOEIC → không có hạn theo section', () => {
    expect(mockSectionClock({ ...a, events: [], mode: 'practice' }, ts, [q(1, 'listening_p1')]).get('listening_p1')).toEqual({ skill: 'listening', ends_at: null, locked: false });
  });
});

describe('evidenceSegmentsOf – nhiều dòng', () => {
  it('mỗi dòng evidence khớp segment riêng', () => {
    const segs = [
      { start_ms: 0, end_ms: 1, speaker: 'W1', text: 'The fee is twelve pounds.' },
      { start_ms: 1, end_ms: 2, speaker: 'M1', text: 'Nothing here.' },
      { start_ms: 2, end_ms: 3, speaker: 'W1', text: 'Bring a towel, please.' },
    ];
    expect(evidenceSegmentsOf(segs, 'twelve pounds\nbring a towel')).toEqual([0, 2]);
  });
});
