import { unwrap, type components } from '@allingo/api-client';
import type { ReviewBulkAction } from '@allingo/schemas/api/content-tools';
import { env } from '@/env';
import { getApi, getApiFetch } from './api';
import type { Page } from './types';

/**
 * B2 – công cụ sản xuất nội dung (OpenAPI v1.1 nhóm Admin): hàng chờ duyệt, nhập Excel, AI soạn nháp cả đề, phát hành đề nháp.
 * Kiểu từ `components['schemas']` (OpenAPI khai báo `required`); quyền do server quyết định (editor/teacher/admin – máy trạng thái).
 */

type S = components['schemas'];
export type ReviewQueueItem = S['ReviewQueueItem'];
export type ReviewQueuePage = S['ReviewQueuePage'];
export type ReviewBulkResult = S['ReviewBulkResult'];
export type ContentReviewer = S['ContentReviewer'];
export type DuplicateInfo = S['DuplicateInfo'];
export type AutoCheck = S['AutoCheck'];
export type ContentImportJob = S['ContentImportJob'];
export type ContentImportReport = S['ContentImportReport'];
export type ContentImportIssue = S['ContentImportIssue'];
export type ContentImportStarted = S['ContentImportStarted'];
export type DraftTestInput = S['DraftTestInput'];
export type DraftTestStarted = S['DraftTestStarted'];
export type DraftTestJob = S['DraftTestJob'];

export const contentToolsKeys = {
  queue: (q?: object) => (q ? (['admin', 'content-tools', 'queue', q] as const) : (['admin', 'content-tools', 'queue'] as const)),
  reviewers: ['admin', 'content-tools', 'reviewers'] as const,
  importJob: (id: string) => ['admin', 'content-tools', 'import', id] as const,
  draftJob: (id: string) => ['admin', 'content-tools', 'draft', id] as const,
};

type Query = Record<string, string | number | boolean | undefined | null>;
const clean = (q: Query) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== ''));

export async function getReviewQueue(q: Query & { cursor?: string | null }): Promise<ReviewQueuePage & Page<ReviewQueueItem>> {
  return unwrap(await getApi().GET('/admin/content/review-queue', { params: { query: clean({ limit: 30, ...q }) as never } }));
}

export async function bulkReview(body: { question_ids: string[]; action: ReviewBulkAction; notes?: string }): Promise<ReviewBulkResult> {
  return unwrap(await getApi().POST('/admin/content/review-queue/bulk', { body }));
}

export async function assignReviewer(body: { question_ids: string[]; assignee_id: string | null }): Promise<{ updated: number; assignee_id: string | null; missing: number }> {
  return unwrap(await getApi().POST('/admin/content/review-queue/assign', { body }));
}

export async function listReviewers(): Promise<{ data: ContentReviewer[] }> {
  return unwrap(await getApi().GET('/admin/content/reviewers'));
}

export async function duplicateCheck(questionId: string): Promise<{ question_id: string; question_version_id: string; duplicate: DuplicateInfo | null }> {
  return unwrap(await getApi().POST('/admin/content/questions/{questionId}/duplicate-check', { params: { path: { questionId } } }));
}

/** Tệp mẫu .xlsx (fetch có cookie → Blob; chạy được cả với mock) */
export async function downloadImportTemplate(): Promise<Blob> {
  const res = await getApiFetch()(`${env.apiUrl}/admin/content/imports/template`, { credentials: 'include', headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** Tệp → base64 (không tiền tố data:) */
export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function startImport(body: { file_name: string; file_base64: string; dry_run: boolean; confirm_fingerprint?: string; skip_bank_duplicates?: boolean }): Promise<ContentImportStarted> {
  return unwrap(await getApi().POST('/admin/content/imports', { body: { ...body, skip_bank_duplicates: body.skip_bank_duplicates ?? false } }));
}

export async function getImportJob(jobId: string): Promise<ContentImportJob> {
  return unwrap(await getApi().GET('/admin/content/imports/{jobId}', { params: { path: { jobId } } }));
}

export async function startDraftTest(body: DraftTestInput): Promise<DraftTestStarted> {
  return unwrap(await getApi().POST('/admin/generate/test-sets', { body }));
}

export async function getDraftTestJob(jobId: string): Promise<DraftTestJob> {
  return unwrap(await getApi().GET('/admin/generate/test-sets/{jobId}', { params: { path: { jobId } } }));
}

export async function publishDraftTestSet(testSetId: string): Promise<{ test_set_id: string; code: string; status: 'published' }> {
  return unwrap(await getApi().POST('/admin/test-sets/{testSetId}/publish', { params: { path: { testSetId } } }));
}
