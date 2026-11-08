import { ApiError, unwrap, type components } from '@allingo/api-client';
import { betaRedeemResultSchema, betaStatusSchema, contentReportCreatedSchema, feedbackCreatedSchema, mfaEnrollResultSchema, mfaStatusSchema, pendingSurveysSchema, policiesSchema, supportTicketSchema, surveyResponseSchema, type BetaRedeemResult, type BetaStatus, type BetaSurveyInput, type FeedbackInput, type SupportTicket, type SupportTicketInput } from '@allingo/schemas/api/s12';
import type { z } from 'zod';
import { env } from '@/env';
import { getApi, getApiFetch } from './api';
import { pageOf, parseOr } from './zod-parse';
import type { Page } from './types';

/**
 * Lời gọi API Sprint 12 (OpenAPI v1.1 – nhóm beta kín, phản hồi/hỗ trợ, NPS, pháp lý, MFA, admin vận hành). Kiểu dùng chung ở
 * `packages/schemas/src/api/s12.ts` (validate Zod, sai dạng → dữ liệu thô) và `components['schemas']` sinh từ OpenAPI cho phần
 * admin. B7/S145: schema S12 trong OpenAPI đã khai báo `required` đúng thực tế → kiểu sinh ra dùng trực tiếp (bỏ bọc `Full<>`, bỏ
 * ép kiểu từng lời gọi admin); Zod tương ứng ở `packages/schemas/src/api/s12-admin.ts`. Quyền/hạn mức luôn do server quyết định.
 */

type S = components['schemas'];
export type MfaStatus = z.infer<typeof mfaStatusSchema>;
export type MfaEnrollResult = z.infer<typeof mfaEnrollResultSchema>;
export type Policy = z.infer<typeof policiesSchema>['data'][number];
export type PendingSurveys = z.infer<typeof pendingSurveysSchema>;
export type SurveyResponse = z.infer<typeof surveyResponseSchema>;
export type ContentReportCreated = z.infer<typeof contentReportCreatedSchema>;
export type FeedbackCreated = z.infer<typeof feedbackCreatedSchema>;
export type AdminBetaInviteSendResult = S['AdminBetaInviteSendResult'];
export type { BetaRedeemResult, BetaStatus, SupportTicket };

export type AdminWaitlistEntry = S['AdminWaitlistEntry'];
export type AdminBetaInvite = S['AdminBetaInvite'];
export type AdminFeedbackItem = S['AdminFeedbackItem'];
export type ContentReportItem = S['ContentReportItem'];
export type AdminSupportTicket = S['AdminSupportTicket'];
export type AdminUserSummary = S['AdminUserSummary'];
export type AdminUserDetail = S['AdminUserDetail'];
export type AdminImpersonation = S['AdminImpersonation'];
export type QuestionStats = S['QuestionStats'];
export type AiQualityRow = S['AiQualityRow'];
export type AdminSystemStatus = S['AdminSystemStatus'];
export type DeadLetterItem = S['DeadLetterItem'];
export type AuditLogItem = S['AuditLogItem'];
export type FeatureFlag = S['FeatureFlag'];
export type RefusalItem = S['AiRefusal'];

export const s12Keys = {
  betaStatus: ['beta', 'status'] as const,
  pendingSurveys: ['me', 'surveys', 'pending'] as const,
  myTickets: ['me', 'support', 'tickets'] as const,
  myTicket: (id: string) => ['me', 'support', 'tickets', id] as const,
  mfa: ['me', 'mfa'] as const,
  policies: ['legal', 'policies'] as const,
  admin: (section: string, q?: object) => (q ? (['admin', 's12', section, q] as const) : (['admin', 's12', section] as const)),
};

type Query = Record<string, string | number | boolean | undefined | null>;
const clean = (q: Query) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ----------------------------------------------------------------------------- Beta
export async function getBetaStatus(): Promise<BetaStatus> {
  return parseOr(betaStatusSchema, unwrap(await getApi().GET('/beta/status')));
}

export async function redeemBetaCode(code: string): Promise<BetaRedeemResult> {
  return parseOr(betaRedeemResultSchema, unwrap(await getApi().POST('/beta/redeem', { body: { code } })));
}

export async function submitBetaSurvey(input: BetaSurveyInput): Promise<SurveyResponse> {
  return parseOr(surveyResponseSchema, unwrap(await getApi().POST('/me/beta-survey', { body: input as never })));
}

export async function getPendingSurveys(): Promise<PendingSurveys> {
  return parseOr(pendingSurveysSchema, unwrap(await getApi().GET('/me/surveys/pending')));
}

export async function submitNps(input: { score: number; comment?: string; survey?: 'nps_d7' | 'nps_d14' }): Promise<SurveyResponse> {
  return parseOr(surveyResponseSchema, unwrap(await getApi().POST('/me/surveys/nps', { body: input })));
}

// ----------------------------------------------------------------------------- Góp ý, ảnh, báo lỗi câu
export async function createFeedback(input: FeedbackInput): Promise<FeedbackCreated> {
  return parseOr(feedbackCreatedSchema, unwrap(await getApi().POST('/feedback', { body: input as never })));
}

/**
 * Tải ảnh lên bucket riêng tư: `POST /uploads/presign {kind: image}` → PUT trực tiếp (URL ký Content-Type + Content-Length,
 * hạn 10 phút) → `resource_id` dùng làm `screenshot_upload_id`. PUT không mang cookie (URL đã ký).
 */
export async function uploadImage(file: Blob & { type: string; size: number }): Promise<string> {
  const presign = unwrap(await getApi().POST('/uploads/presign', { body: { kind: 'image', mime_type: file.type, size_bytes: file.size } })) as { upload_url?: string; resource_id?: string };
  if (!presign.upload_url || !presign.resource_id) throw new ApiError(500, undefined, 'Presign failed');
  const res = await getApiFetch()(presign.upload_url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, credentials: 'omit' });
  if (!res.ok) throw new ApiError(res.status, undefined, 'Upload failed');
  return presign.resource_id;
}

export async function createContentReport(input: { question_version_id: string; reason: string; message?: string }): Promise<ContentReportCreated> {
  return parseOr(contentReportCreatedSchema, unwrap(await getApi().POST('/content-reports', { body: input as never })));
}

// ----------------------------------------------------------------------------- Hỗ trợ (người học)
export async function createSupportTicket(input: SupportTicketInput): Promise<SupportTicket> {
  return parseOr(supportTicketSchema, unwrap(await getApi().POST('/support/tickets', { body: input as never })));
}

export async function listMyTickets(cursor: string | null): Promise<Page<SupportTicket>> {
  return pageOf(supportTicketSchema, unwrap(await getApi().GET('/me/support/tickets', { params: { query: clean({ cursor, limit: 20 }) as never } })));
}

export async function getMyTicket(id: string): Promise<SupportTicket> {
  return parseOr(supportTicketSchema, unwrap(await getApi().GET('/me/support/tickets/{ticketId}', { params: { path: { ticketId: id } } })));
}

export async function replyMyTicket(id: string, message: string): Promise<SupportTicket> {
  return parseOr(supportTicketSchema, unwrap(await getApi().POST('/support/tickets/{ticketId}/messages', { params: { path: { ticketId: id } }, body: { message } })));
}

// ----------------------------------------------------------------------------- Pháp lý
export async function getPolicies(): Promise<Policy[]> {
  return parseOr(policiesSchema, unwrap(await getApi().GET('/legal/policies'))).data;
}

/** RSC: đọc phiên bản văn bản pháp lý (công khai, cache 300 s). Lỗi/timeout → null (trang dùng phiên bản dự phòng) */
export async function fetchPoliciesServer(): Promise<Policy[] | null> {
  if (process.env.NEXT_PUBLIC_API_MOCK === '1') return null;
  const base = process.env.API_INTERNAL_URL ?? env.apiUrl;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/legal/policies`, { next: { revalidate: 300, tags: ['legal-policies'] }, signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const parsed = policiesSchema.safeParse(await res.json());
    return parsed.success ? parsed.data.data : null;
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------- MFA
export async function getMfaStatus(): Promise<MfaStatus> {
  return parseOr(mfaStatusSchema, unwrap(await getApi().GET('/me/mfa')));
}

export async function enrollTotp(): Promise<MfaEnrollResult> {
  return parseOr(mfaEnrollResultSchema, unwrap(await getApi().POST('/auth/mfa/totp/enroll')));
}

export async function confirmTotp(code: string): Promise<{ recovery_codes: string[] }> {
  const r = unwrap(await getApi().POST('/auth/mfa/totp/confirm', { body: { code } })) as { recovery_codes?: string[] };
  return { recovery_codes: r.recovery_codes ?? [] };
}

export async function verifyMfa(input: { code: string } | { recovery_code: string }): Promise<void> {
  unwrap(await getApi().POST('/auth/mfa/verify', { body: input }));
}

export async function regenerateRecoveryCodes(code: string): Promise<string[]> {
  const r: { recovery_codes?: string[] } = unwrap(await getApi().POST('/auth/mfa/recovery-codes', { body: { code } }));
  return r.recovery_codes ?? [];
}

// ----------------------------------------------------------------------------- Admin: beta
export async function listWaitlist(q: Query & { cursor?: string | null }): Promise<Page<AdminWaitlistEntry> & { counts: Record<string, number> }> {
  return unwrap(await getApi().GET('/admin/beta/waitlist', { params: { query: clean({ limit: 50, ...q }) as never } }));
}

export async function listInvites(q: Query & { cursor?: string | null }): Promise<Page<AdminBetaInvite> & { today: { sent: number; limit: number; remaining: number }; counts: Record<string, number> }> {
  return unwrap(await getApi().GET('/admin/beta/invites', { params: { query: clean({ limit: 50, ...q }) as never } }));
}

export async function createInvites(input: { waitlist_entry_ids?: string[]; emails?: string[]; program?: 'toeic'; locale?: string; batch?: string }): Promise<{ queued: number; skipped: number; batch: string }> {
  return unwrap(await getApi().POST('/admin/beta/invites', { body: input as never }));
}

/**
 * Gửi ngay (B6/S147): không truyền bộ lọc → mọi lời mời đang xếp hàng (hạn mức ngày); `invite_ids` → chỉ các lời mời đã chọn
 * (theo thứ tự chọn); `batch` → chỉ đợt đang lọc. Lời mời đã chọn nhưng không còn `queued` được đếm ở `result.skipped`.
 */
export async function sendInvitesNow(input: { limit?: number; invite_ids?: string[]; batch?: string } = {}): Promise<AdminBetaInviteSendResult> {
  const body = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)));
  return unwrap(await getApi().POST('/admin/beta/invites/send', { body }));
}

export async function revokeInvite(id: string): Promise<AdminBetaInvite> {
  return unwrap(await getApi().POST('/admin/beta/invites/{inviteId}/revoke', { params: { path: { inviteId: id } } }));
}

export interface BetaReport {
  week: string;
  kpis: Record<string, unknown>;
  posthog: Record<string, unknown> | null;
  markdown: string;
}
export async function getBetaReport(week?: string): Promise<BetaReport> {
  return unwrap(await getApi().GET('/admin/reports/beta', { params: { query: clean({ week }) as never } }));
}

// ----------------------------------------------------------------------------- Admin: góp ý, báo lỗi câu, hỗ trợ
export async function listAdminFeedback(q: Query & { cursor?: string | null }): Promise<Page<AdminFeedbackItem>> {
  return unwrap(await getApi().GET('/admin/feedback', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function patchAdminFeedback(id: string, status: 'new' | 'triaged' | 'done' | 'wontfix'): Promise<AdminFeedbackItem> {
  return unwrap(await getApi().PATCH('/admin/feedback/{feedbackId}', { params: { path: { feedbackId: id } }, body: { status } }));
}

export async function listContentReports(q: Query & { cursor?: string | null }): Promise<Page<ContentReportItem>> {
  return unwrap(await getApi().GET('/admin/content/reports', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function patchContentReport(id: string, body: { status: 'open' | 'confirmed' | 'rejected' | 'fixed'; resolution_note?: string }): Promise<ContentReportItem> {
  return unwrap(await getApi().PATCH('/admin/content/reports/{reportId}', { params: { path: { reportId: id } }, body }));
}

export async function listAdminTickets(q: Query & { cursor?: string | null }): Promise<Page<AdminSupportTicket> & { counts: Record<string, number> }> {
  return unwrap(await getApi().GET('/admin/support/tickets', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function getAdminTicket(id: string): Promise<AdminSupportTicket> {
  return unwrap(await getApi().GET('/admin/support/tickets/{ticketId}', { params: { path: { ticketId: id } } }));
}

export async function patchAdminTicket(id: string, body: { status?: string; priority?: string; assigned_to?: string | null }): Promise<AdminSupportTicket> {
  return unwrap(await getApi().PATCH('/admin/support/tickets/{ticketId}', { params: { path: { ticketId: id } }, body: body as never }));
}

export interface AdminReplyInput {
  message: string;
  channels: ('inapp' | 'email')[];
  status: 'open' | 'waiting_user' | 'resolved' | 'closed';
  credit?: { delta: number; note: string };
}
export async function replyAdminTicket(id: string, body: AdminReplyInput): Promise<AdminSupportTicket & { credit: { delta: number; balance: number; ledger_id: number } | null }> {
  return unwrap(await getApi().POST('/admin/support/tickets/{ticketId}/messages', { params: { path: { ticketId: id } }, body }));
}

// ----------------------------------------------------------------------------- Admin: người dùng
export async function searchUsers(q: Query & { cursor?: string | null }): Promise<Page<AdminUserSummary>> {
  return unwrap(await getApi().GET('/admin/users', { params: { query: clean({ limit: 20, ...q }) as never } }));
}

export async function getAdminUser(id: string): Promise<AdminUserDetail> {
  return unwrap(await getApi().GET('/admin/users/{userId}', { params: { path: { userId: id } } }));
}

export async function lockUser(id: string, reason: string): Promise<{ user_id: string; status: 'suspended'; sessions_revoked: number }> {
  return unwrap(await getApi().POST('/admin/users/{userId}/lock', { params: { path: { userId: id } }, body: { reason } }));
}

export async function unlockUser(id: string, reason?: string): Promise<{ user_id: string; status: 'active' }> {
  return unwrap(await getApi().POST('/admin/users/{userId}/unlock', { params: { path: { userId: id } }, body: reason ? { reason } : {} }));
}

export async function requestUserDeletion(id: string, reason: string): Promise<{ status: 'scheduled'; due_at: string; request_id: string }> {
  return unwrap(await getApi().POST('/admin/users/{userId}/deletion', { params: { path: { userId: id } }, body: { reason } }));
}

export async function startImpersonation(id: string, reason: string): Promise<AdminImpersonation> {
  return unwrap(await getApi().POST('/admin/users/{userId}/impersonate', { params: { path: { userId: id } }, body: { reason } }));
}

/**
 * GET CHỈ ĐỌC bằng token impersonate (Bearer, KHÔNG cookie – không đụng phiên admin). Token chỉ nằm trong bộ nhớ của trang admin
 * (không localStorage); API ghi audit mỗi request và chặn mọi phương thức ghi + `/admin/*`.
 */
export async function impersonatedGet(token: string, path: string): Promise<unknown> {
  const res = await getApiFetch()(`${env.apiUrl}${path}`, { method: 'GET', credentials: 'omit', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) throw new ApiError(res.status, body as never);
  return body;
}

// ----------------------------------------------------------------------------- Admin: nội dung, AI, hệ thống, audit
export async function getQuestionStats(q: Query & { cursor?: string | null }): Promise<Page<QuestionStats> & { computed_at: string | null }> {
  return unwrap(await getApi().GET('/admin/content/questions/stats', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function recomputeQuestionStats(): Promise<{ job_id: string; mode: 'queued' | 'inline'; result: Record<string, unknown> | null }> {
  return unwrap(await getApi().POST('/admin/content/questions/stats/recompute'));
}

export async function getAiQuality(q: Query): Promise<{ from: string; to: string; data: AiQualityRow[] }> {
  return unwrap(await getApi().GET('/admin/ai/quality', { params: { query: clean(q) as never } }));
}

export async function getAiRefusals(q: Query & { cursor?: string | null }): Promise<Page<RefusalItem> & { by_reason: Record<string, number> }> {
  return unwrap(await getApi().GET('/admin/ai/refusals', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function getSystemStatus(): Promise<AdminSystemStatus> {
  return unwrap(await getApi().GET('/admin/system/status'));
}

export async function listDeadLettersAll(q: Query & { cursor?: string | null }): Promise<Page<DeadLetterItem>> {
  return unwrap(await getApi().GET('/admin/jobs/dead-letters', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function replayDeadLetterAll(id: string): Promise<DeadLetterItem & { mode: 'queued' | 'inline'; result: Record<string, unknown> | null; error: string | null }> {
  return unwrap(await getApi().POST('/admin/jobs/dead-letters/{deadLetterId}/replay', { params: { path: { deadLetterId: id } } }));
}

export async function listAuditLogs(q: Query & { cursor?: string | null }): Promise<Page<AuditLogItem>> {
  return unwrap(await getApi().GET('/admin/audit-logs', { params: { query: clean({ limit: 50, ...q }) as never } }));
}

export async function listAdminFlags(): Promise<FeatureFlag[]> {
  const r: { data?: unknown[] } = unwrap(await getApi().GET('/admin/flags'));
  return (r.data ?? []) as FeatureFlag[];
}
