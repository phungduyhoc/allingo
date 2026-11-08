import type { ContentReportItem } from './internal-api';

/**
 * Hàng đợi báo lỗi câu hỏi trong CMS (S12): API (ops.content_reports) là nguồn sự thật; collection `content-reports` là bản sao
 * để biên tập viên lọc/xử lý trong Payload admin. Đồng bộ kéo (pull) theo `updated_at` khi mở danh sách (tối đa 30 s/lần) hoặc
 * bấm "Đồng bộ"; đổi trạng thái trong CMS → gọi API trước (lỗi → không lưu). SLA xử lý 48 giờ – `overdue` đánh dấu quá hạn.
 */
export const CONTENT_REPORT_REASONS = ['wrong_answer', 'typo', 'unclear', 'audio_issue', 'image_issue', 'translation', 'explanation_wrong', 'other'] as const;
export const CONTENT_REPORT_STATUSES = ['open', 'confirmed', 'rejected', 'fixed'] as const;
export const SYNC_THROTTLE_MS = 30_000;

export interface ContentReportDoc {
  reportId: string;
  questionId: string | null;
  questionVersionId: string;
  versionNo: number | null;
  externalRef: string | null;
  sectionCode: string | null;
  stemPreview: string | null;
  reason: string;
  message: string | null;
  status: ContentReportItem['status'];
  resolutionNote: string | null;
  slaDueAt: string | null;
  overdue: boolean;
  reportsForQuestion: number;
  reportedAt: string;
  resolvedAt: string | null;
  apiUpdatedAt: string;
}

export function toContentReportDoc(r: ContentReportItem): ContentReportDoc {
  return {
    reportId: r.id,
    questionId: r.question_id,
    questionVersionId: r.question_version_id,
    versionNo: r.version_no,
    externalRef: r.external_ref,
    sectionCode: r.section_code,
    stemPreview: r.stem_preview,
    reason: r.reason,
    message: r.message,
    status: r.status,
    resolutionNote: r.resolution_note,
    slaDueAt: r.sla_due_at,
    overdue: r.overdue,
    reportsForQuestion: r.reports_for_question,
    reportedAt: r.created_at,
    resolvedAt: r.resolved_at,
    apiUpdatedAt: r.updated_at,
  };
}

/** Quá hạn SLA tại thời điểm đọc (trạng thái mở và đã qua hạn) */
export function isOverdue(doc: { status?: string | null; slaDueAt?: string | null }, now: Date = new Date()): boolean {
  return doc.status === 'open' && !!doc.slaDueAt && new Date(doc.slaDueAt).getTime() < now.getTime();
}

export interface ReportStore {
  findByReportId(id: string): Promise<{ id: string | number; apiUpdatedAt?: string | null } | null>;
  create(data: ContentReportDoc): Promise<unknown>;
  update(id: string | number, data: ContentReportDoc): Promise<unknown>;
}

export interface SyncState {
  since: string;
  lastRunAt: number;
}

/**
 * Kéo mọi thay đổi từ API kể từ `state.since` (phân trang cursor) và upsert theo reportId. Trả số tạo/cập nhật; cập nhật
 * `state.since` = updated_at lớn nhất đã thấy. `fetchPage` = listContentReports (test thay bằng giả).
 */
export async function syncContentReports(store: ReportStore, state: SyncState, fetchPage: (q: { updated_since: string; cursor?: string | null }) => Promise<{ data: ContentReportItem[]; next_cursor: string | null }>): Promise<{ created: number; updated: number; since: string }> {
  let cursor: string | null = null;
  let created = 0;
  let updated = 0;
  let maxSeen = state.since;
  for (let page = 0; page < 50; page++) {
    const r = await fetchPage({ updated_since: state.since, cursor });
    for (const item of r.data) {
      const doc = toContentReportDoc(item);
      const existing = await store.findByReportId(item.id);
      if (!existing) {
        await store.create(doc);
        created++;
      } else if (existing.apiUpdatedAt !== doc.apiUpdatedAt) {
        await store.update(existing.id, doc);
        updated++;
      }
      if (item.updated_at > maxSeen) maxSeen = item.updated_at;
    }
    if (!r.next_cursor) break;
    cursor = r.next_cursor;
  }
  state.since = maxSeen;
  state.lastRunAt = Date.now();
  return { created, updated, since: maxSeen };
}
