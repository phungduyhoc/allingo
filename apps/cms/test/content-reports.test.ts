import { describe, expect, it } from 'vitest';
import { isOverdue, syncContentReports, toContentReportDoc, type ContentReportDoc, type ReportStore } from '../src/lib/content-reports';
import type { ContentReportItem } from '../src/lib/internal-api';

const item = (i: number, over: Partial<ContentReportItem> = {}): ContentReportItem => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  question_id: 'q-1',
  question_version_id: 'v-1',
  version_no: 1,
  external_ref: 'toeic-r01-p5-001',
  section_code: 'part5',
  stem_preview: 'The manager ______ the report.',
  reason: 'wrong_answer',
  message: 'Đáp án B mới đúng',
  status: 'open',
  resolution_note: null,
  sla_due_at: '2026-11-10T00:00:00.000Z',
  overdue: false,
  reports_for_question: 2,
  created_at: '2026-11-08T00:00:00.000Z',
  updated_at: `2026-11-08T00:00:0${i}.000Z`,
  resolved_at: null,
  ...over,
});

function memoryStore() {
  const docs: Array<ContentReportDoc & { id: number }> = [];
  const store: ReportStore = {
    findByReportId: async (id) => docs.find((d) => d.reportId === id) ?? null,
    create: async (data) => docs.push({ ...data, id: docs.length + 1 }),
    update: async (id, data) => {
      const i = docs.findIndex((d) => d.id === id);
      docs[i] = { ...data, id: id as number };
    },
  };
  return { docs, store };
}

describe('CMS – hàng đợi báo lỗi câu hỏi (S12)', () => {
  it('ánh xạ item API → doc collection (reportId, SLA, trích đề, số báo lỗi của câu)', () => {
    expect(toContentReportDoc(item(1))).toMatchObject({ reportId: item(1).id, externalRef: 'toeic-r01-p5-001', sectionCode: 'part5', status: 'open', slaDueAt: '2026-11-10T00:00:00.000Z', reportsForQuestion: 2, apiUpdatedAt: '2026-11-08T00:00:01.000Z' });
  });

  it('quá hạn khi còn mở và đã qua hạn 48 giờ; đã xử lý thì không', () => {
    const now = new Date('2026-11-11T00:00:00Z');
    expect(isOverdue({ status: 'open', slaDueAt: '2026-11-10T00:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ status: 'fixed', slaDueAt: '2026-11-10T00:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ status: 'open', slaDueAt: '2026-11-12T00:00:00Z' }, now)).toBe(false);
  });

  it('đồng bộ kéo theo updated_at: phân trang, upsert theo reportId, bỏ qua bản không đổi, tiến mốc since', async () => {
    const { docs, store } = memoryStore();
    const state = { since: '1970-01-01T00:00:00.000Z', lastRunAt: 0 };
    const calls: Array<{ updated_since: string; cursor?: string | null }> = [];
    const pages = [
      { data: [item(1), item(2)], next_cursor: 'c2' },
      { data: [item(3)], next_cursor: null },
    ];
    const r1 = await syncContentReports(store, state, async (q) => {
      calls.push(q);
      return pages[calls.length - 1]!;
    });
    expect(r1).toMatchObject({ created: 3, updated: 0, since: '2026-11-08T00:00:03.000Z' });
    expect(calls.map((c) => c.cursor ?? null)).toEqual([null, 'c2']);
    // Lần 2: item 3 không đổi (bỏ qua), item 1 đổi trạng thái → cập nhật
    const r2 = await syncContentReports(store, state, async () => ({ data: [item(3), item(1, { status: 'fixed', updated_at: '2026-11-08T01:00:00.000Z', resolution_note: 'Đã sửa đáp án' })], next_cursor: null }));
    expect(r2).toMatchObject({ created: 0, updated: 1, since: '2026-11-08T01:00:00.000Z' });
    expect(docs.find((d) => d.reportId === item(1).id)).toMatchObject({ status: 'fixed', resolutionNote: 'Đã sửa đáp án' });
    expect(docs).toHaveLength(3);
  });
});
