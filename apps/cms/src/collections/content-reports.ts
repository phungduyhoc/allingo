import { APIError, type CollectionBeforeChangeHook, type CollectionBeforeOperationHook, type CollectionConfig, type Endpoint, type Payload } from 'payload';
import { hasRole, isLoggedIn, roleOf } from '../lib/access';
import { CONTENT_REPORT_REASONS, CONTENT_REPORT_STATUSES, isOverdue, SYNC_THROTTLE_MS, syncContentReports, type ContentReportDoc, type ReportStore, type SyncState } from '../lib/content-reports';
import { describeError, listContentReports, setContentReportStatus } from '../lib/internal-api';

const SLUG = 'content-reports';
const state: SyncState = { since: '1970-01-01T00:00:00.000Z', lastRunAt: 0 };
let running: Promise<unknown> | null = null;

function storeFor(payload: Payload): ReportStore {
  const context = { fromSync: true, skipReportSync: true };
  return {
    findByReportId: async (id) => {
      const r = await payload.find({ collection: SLUG as never, where: { reportId: { equals: id } }, limit: 1, depth: 0, overrideAccess: true, context });
      const d = r.docs[0] as { id: string | number; apiUpdatedAt?: string | null } | undefined;
      return d ?? null;
    },
    create: (data) => payload.create({ collection: SLUG as never, data: data as never, overrideAccess: true, context }),
    update: (id, data) => payload.update({ collection: SLUG as never, id, data: data as never, overrideAccess: true, context }),
  };
}

/** Đồng bộ (throttle 30 s, một lượt chạy tại một thời điểm); lỗi API không chặn việc xem danh sách */
export async function syncNow(payload: Payload, force = false): Promise<{ created: number; updated: number; since: string } | null> {
  if (!force && Date.now() - state.lastRunAt < SYNC_THROTTLE_MS) return null;
  if (running) return (await running) as never;
  running = syncContentReports(storeFor(payload), state, (q) => listContentReports(q)).finally(() => {
    running = null;
  });
  return (await running) as { created: number; updated: number; since: string };
}

const pullBeforeRead: CollectionBeforeOperationHook = async ({ operation, context, req }) => {
  if ((operation === 'read' || operation === 'find' || operation === ('findByID' as never)) && !context?.skipReportSync) {
    try {
      await syncNow(req.payload);
    } catch (err) {
      req.payload.logger.warn(`[content-reports] đồng bộ thất bại: ${describeError(err)}`);
    }
  }
};

/** Biên tập viên đổi trạng thái/ghi chú → gọi API trước (nguồn sự thật); API lỗi → không lưu, hiện thông báo */
const pushStatus: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, context, req }) => {
  if (operation !== 'update' || context?.fromSync) return data;
  const before = originalDoc as Partial<ContentReportDoc> | undefined;
  const next = data as Partial<ContentReportDoc>;
  const status = next.status ?? before?.status;
  const note = next.resolutionNote ?? before?.resolutionNote ?? undefined;
  if (!before?.reportId || !status || (status === before.status && (note ?? null) === (before.resolutionNote ?? null))) return data;
  const user = req.user as { email?: string; apiUserEmail?: string | null } | null;
  try {
    const r = await setContentReportStatus(before.reportId, { status, resolution_note: note ?? undefined, resolved_by_email: user?.apiUserEmail || user?.email || undefined });
    return { ...data, status: r.status, resolutionNote: r.resolution_note, resolvedAt: r.resolved_at, overdue: r.overdue, apiUpdatedAt: r.updated_at };
  } catch (err) {
    throw new APIError(`Không cập nhật được báo lỗi trên API: ${describeError(err)}`, 502);
  }
};

const syncEndpoint: Endpoint = {
  path: '/sync',
  method: 'post',
  handler: async (req) => {
    if (!roleOf(req)) return Response.json({ error: 'unauthorized' }, { status: 401 });
    try {
      const r = await syncNow(req.payload, true);
      return Response.json({ ok: true, ...(r ?? {}) });
    } catch (err) {
      return Response.json({ ok: false, error: describeError(err) }, { status: 502 });
    }
  },
};

const ro = { readOnly: true } as const;

/**
 * Hàng đợi báo lỗi câu hỏi (S12) – bản sao chỉ đọc của ops.content_reports (đồng bộ qua /internal/content-reports), chỉ được
 * đổi `status` + `resolutionNote` (giáo viên/admin). Không tạo/xoá trong CMS. SLA 48 giờ: cột "Quá hạn".
 */
export const ContentReports: CollectionConfig = {
  slug: SLUG,
  labels: { singular: { vi: 'Báo lỗi câu hỏi', en: 'Question report' }, plural: { vi: 'Báo lỗi câu hỏi', en: 'Question reports' } },
  admin: {
    useAsTitle: 'reportId',
    group: { vi: 'Nội dung', en: 'Content' },
    defaultColumns: ['reportedAt', 'reason', 'status', 'overdue', 'externalRef', 'sectionCode', 'reportsForQuestion'],
    description: { vi: 'Người học báo lỗi câu hỏi (nguồn: API). Xử lý trong 48 giờ: xác nhận → sửa câu (phiên bản mới) → "Đã sửa"; không phải lỗi → "Từ chối". Danh sách tự đồng bộ mỗi 30 giây khi mở.', en: 'Learner question reports (source: API). Handle within 48 hours. The list syncs every 30 seconds when opened.' },
    listSearchableFields: ['externalRef', 'reportId', 'stemPreview'],
  },
  access: { read: isLoggedIn, create: () => false, update: hasRole('teacher', 'admin'), delete: () => false },
  hooks: { beforeOperation: [pullBeforeRead], beforeChange: [pushStatus], afterRead: [({ doc }) => ({ ...doc, overdue: isOverdue(doc as Partial<ContentReportDoc>) })] },
  endpoints: [syncEndpoint],
  fields: [
    { name: 'reportId', type: 'text', required: true, unique: true, index: true, label: { vi: 'Mã báo cáo (API)', en: 'Report id' }, admin: ro },
    {
      type: 'row',
      fields: [
        { name: 'status', type: 'select', required: true, defaultValue: 'open', options: CONTENT_REPORT_STATUSES.map((v) => ({ label: { open: { vi: 'Mở', en: 'Open' }, confirmed: { vi: 'Xác nhận lỗi', en: 'Confirmed' }, rejected: { vi: 'Từ chối', en: 'Rejected' }, fixed: { vi: 'Đã sửa', en: 'Fixed' } }[v], value: v })), label: { vi: 'Trạng thái', en: 'Status' } },
        { name: 'overdue', type: 'checkbox', label: { vi: 'Quá hạn 48 giờ', en: 'Overdue (48 h)' }, admin: ro },
        { name: 'slaDueAt', type: 'date', label: { vi: 'Hạn xử lý', en: 'Due' }, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
      ],
    },
    { name: 'resolutionNote', type: 'textarea', label: { vi: 'Ghi chú xử lý', en: 'Resolution note' } },
    {
      type: 'row',
      fields: [
        { name: 'reason', type: 'select', required: true, options: CONTENT_REPORT_REASONS.map((v) => ({ label: v, value: v })), label: { vi: 'Lý do', en: 'Reason' }, admin: ro },
        { name: 'reportsForQuestion', type: 'number', label: { vi: 'Số báo lỗi của câu', en: 'Reports for question' }, admin: ro },
      ],
    },
    { name: 'message', type: 'textarea', label: { vi: 'Mô tả của người học', en: 'Learner message' }, admin: ro },
    { name: 'stemPreview', type: 'textarea', label: { vi: 'Trích đề bài', en: 'Stem preview' }, admin: ro },
    {
      type: 'row',
      fields: [
        { name: 'externalRef', type: 'text', label: { vi: 'Mã câu (external_ref)', en: 'External ref' }, admin: ro },
        { name: 'sectionCode', type: 'text', label: { vi: 'Part', en: 'Section' }, admin: ro },
        { name: 'versionNo', type: 'number', label: { vi: 'Phiên bản đã làm', en: 'Version' }, admin: ro },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'questionId', type: 'text', label: 'question_id', admin: ro },
        { name: 'questionVersionId', type: 'text', required: true, label: 'question_version_id', admin: ro },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'reportedAt', type: 'date', label: { vi: 'Thời điểm báo', en: 'Reported at' }, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'resolvedAt', type: 'date', label: { vi: 'Thời điểm xử lý', en: 'Resolved at' }, admin: { ...ro, date: { pickerAppearance: 'dayAndTime' } } },
        { name: 'apiUpdatedAt', type: 'text', label: 'api_updated_at', admin: { ...ro, hidden: true } },
      ],
    },
  ],
};
