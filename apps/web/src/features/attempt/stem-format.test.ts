import { describe, expect, it } from 'vitest';
import { hasStemMarkup, parseInline, parseStem } from './stem-format';
import { questionRemainingMs, timedDrillBudgetSec } from './question-timer';

describe('stem-format', () => {
  it('văn bản thường không cần định dạng (giữ bố cục Reading)', () => {
    expect(hasStemMarkup('The report ______ to all heads.')).toBe(false);
    expect(hasStemMarkup('Look at the graphic.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
    expect(hasStemMarkup('**Bold** title')).toBe(true);
  });

  it('đậm trong dòng', () => {
    expect(parseInline('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
  });

  it('graphic Part 3/4: đoạn + tiêu đề đậm + bảng (căn lề theo dòng phân cách)', () => {
    const stem = 'Look at the graphic. Which platform?\n\n**Morning Departures**\n\n| Destination | Departs | Platform |\n| --- | :---: | ---: |\n| Port Callan | 9:15 | 2 |\n| Holloway | 9:40 | 4 |\nAfter table';
    const blocks = parseStem(stem);
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'table', 'paragraph']);
    const table = blocks[2]!;
    if (table.kind !== 'table') throw new Error('expected table');
    expect(table.header.map((h) => h[0]!.text)).toEqual(['Destination', 'Departs', 'Platform']);
    expect(table.align).toEqual(['left', 'center', 'right']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]!.map((c) => c[0]!.text)).toEqual(['Holloway', '9:40', '4']);
    const title = blocks[1]!;
    expect(title.kind === 'paragraph' && title.segments).toEqual([{ text: 'Morning Departures', bold: true }]);
  });

  it('dòng "|" không có dòng phân cách → coi là văn bản', () => {
    expect(parseStem('| not | a table |').map((b) => b.kind)).toEqual(['paragraph']);
  });
});

describe('timed_drill: ngân sách từng câu', () => {
  it('tổng thời gian / số câu, tối thiểu 5 s; không giới hạn → null', () => {
    expect(timedDrillBudgetSec('2026-11-01T00:00:00Z', '2026-11-01T00:02:00Z', 6)).toBe(20);
    expect(timedDrillBudgetSec('2026-11-01T00:00:00Z', '2026-11-01T00:00:10Z', 6)).toBe(5);
    expect(timedDrillBudgetSec('2026-11-01T00:00:00Z', null, 6)).toBeNull();
    expect(timedDrillBudgetSec('2026-11-01T00:00:00Z', '2026-11-01T00:02:00Z', 0)).toBeNull();
    expect(questionRemainingMs(20, 5_000)).toBe(15_000);
    expect(questionRemainingMs(20, 25_000)).toBe(0);
  });
});
