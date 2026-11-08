import { ApiError, unwrap } from '@allingo/api-client';
import { errorLogEntrySchema, errorLogPageSchema, forecastSchema, funnelEventResultSchema, srsDueListSchema, vocabEnrollResultSchema, vocabItemSchema, vocabListSchema, type ErrorKind, type ErrorLogEntry, type ErrorLogPage, type ErrorPatch, type Forecast, type FunnelEventInput, type SrsDueList, type VocabEnrollResult, type VocabItem, type VocabList } from '@allingo/schemas/api/learning-s10';
import { srsCardSchema, type SrsCard } from '@allingo/schemas/api/learning-tools';
import type { z } from 'zod';
import { getApi } from './api';
import { pageOf, parseOr } from './zod-parse';
import type { Attempt, Page } from './types';

/**
 * Lời gọi API Sprint 10 – ôn tập FSRS (`/me/srs/*`), bộ từ hệ thống (`/vocab/lists*`), sổ lỗi (`/me/errors*`), dự báo v0
 * (`/me/forecast`), sự kiện phễu (`/analytics/events`) và đăng ký chờ (`/waitlist` – backend S12). Kiểu chính xác ở
 * `packages/schemas/src/api/learning-s10.ts`; phản hồi validate bằng Zod, sai dạng → dữ liệu thô (server là nguồn sự thật).
 */

export type FunnelEventResult = z.infer<typeof funnelEventResultSchema>;

// ----------------------------------------------------------------------------- SRS

export interface SrsDueQuery {
  program?: string;
  card_type?: string;
  list_id?: string | null;
  limit?: number;
}

const compact = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** GET /me/srs/due – thẻ đến hạn (learning trước) + thẻ mới trong hạn mức ngày; mỗi thẻ có `preview` 4 nút */
export async function getSrsDue(q: SrsDueQuery = {}): Promise<SrsDueList> {
  const query = compact({ program: q.program ?? 'toeic', card_type: q.card_type, list_id: q.list_id, limit: q.limit ?? 30 });
  return parseOr(srsDueListSchema, unwrap(await getApi().GET('/me/srs/due', { params: { query } as never })));
}

export interface SrsReviewItem {
  card_id: string;
  rating: 1 | 2 | 3 | 4;
  review_mode?: 'flashcard' | 'dictation';
  /** Khoá idempotent (card_id, reviewed_at) – gửi lại cùng giá trị khi thử lại → server trả `duplicate: true` */
  reviewed_at: string;
}

/** POST /me/srs/review → SrsCard[] (lịch mới); 429 `srs_new_cards` khi hết hạn mức thẻ mới hôm nay (cả lô bị từ chối) */
export async function postSrsReview(reviews: SrsReviewItem[]): Promise<SrsCard[]> {
  const data = unwrap(await getApi().POST('/me/srs/review', { body: { reviews } as never }));
  return (Array.isArray(data) ? data : []).map((x) => parseOr(srsCardSchema, x));
}

// ----------------------------------------------------------------------------- Bộ từ

/** GET /vocab/lists?program= (đăng nhập) – mảng bộ từ kèm tiến độ của người học */
export async function getVocabLists(program: string): Promise<VocabList[]> {
  const data = unwrap(await getApi().GET('/vocab/lists', { params: { query: { program } } as never }));
  const arr = Array.isArray(data) ? data : ((data as { data?: unknown[] } | null)?.data ?? []);
  return arr.map((x) => parseOr(vocabListSchema, x));
}

export async function getVocabItems(listId: string, cursor?: string | null, limit = 50): Promise<Page<VocabItem>> {
  const query = compact({ limit, cursor });
  return pageOf(vocabItemSchema, unwrap(await getApi().GET('/vocab/lists/{listId}/items', { params: { path: { listId }, query } as never })));
}

/** POST /vocab/lists/{id}/enroll – thêm cả bộ (idempotent: `existing` = thẻ đã có) */
export async function enrollVocabList(listId: string): Promise<VocabEnrollResult> {
  return parseOr(vocabEnrollResultSchema, unwrap(await getApi().POST('/vocab/lists/{listId}/enroll', { params: { path: { listId } } } as never)));
}

// ----------------------------------------------------------------------------- Sổ lỗi

export interface ErrorQuery {
  program?: string;
  kind?: ErrorKind | null;
  part?: string | null;
  status?: 'open' | 'resolved' | 'all';
  days?: number | null;
  sort?: 'newest' | 'oldest';
  cursor?: string | null;
  limit?: number;
}

export async function getErrors(q: ErrorQuery = {}): Promise<ErrorLogPage> {
  const query = compact({ program: q.program ?? 'toeic', kind: q.kind, part: q.part, status: q.status, days: q.days, sort: q.sort, cursor: q.cursor, limit: q.limit ?? 20 });
  const data = unwrap(await getApi().GET('/me/errors', { params: { query } as never }));
  const parsed = errorLogPageSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  // Phần tử sai dạng không làm hỏng cả trang
  const d = (data ?? {}) as Partial<ErrorLogPage> & { data?: unknown[] };
  return {
    distribution: d.distribution ?? {},
    by_section: d.by_section ?? {},
    totals: d.totals ?? { open: 0, resolved: 0 },
    paraphrase_map: d.paraphrase_map ?? [],
    recurring_writing_speaking: d.recurring_writing_speaking ?? [],
    data: (d.data ?? []).map((x) => parseOr(errorLogEntrySchema, x)),
    next_cursor: d.next_cursor ?? null,
  };
}

/** PATCH /me/errors/{id} – đã hiểu / ghi chú / đổi lý do / tạo thẻ SRS kind `error` */
export async function patchError(entryId: string, patch: ErrorPatch): Promise<ErrorLogEntry> {
  return parseOr(errorLogEntrySchema, unwrap(await getApi().PATCH('/me/errors/{entryId}', { params: { path: { entryId } }, body: patch as never } as never)));
}

export interface ErrorDrillBody {
  program?: string;
  entry_ids?: string[];
  kind?: ErrorKind;
  part?: string;
  limit?: number;
  plan_task_id?: string;
}

/** POST /me/errors/drill → 201 Attempt (timed_drill) từ đúng các câu sai; 404 khi không còn lỗi chưa hiểu */
export async function createErrorDrill(body: ErrorDrillBody): Promise<Attempt> {
  return unwrap(await getApi().POST('/me/errors/drill', { body: { program: 'toeic', ...body } as never })) as unknown as Attempt;
}

// ----------------------------------------------------------------------------- Dự báo

export async function getForecast(program: string): Promise<Forecast> {
  return parseOr(forecastSchema, unwrap(await getApi().GET('/me/forecast', { params: { query: { program } } as never })));
}

// ----------------------------------------------------------------------------- Phễu & đăng ký chờ

/** POST /analytics/events (không cần đăng nhập) – chỉ gọi khi đã có đồng ý cookie phân tích (`consent: true`) */
export async function postFunnelEvent(body: FunnelEventInput): Promise<FunnelEventResult> {
  return parseOr(funnelEventResultSchema, unwrap(await getApi().POST('/analytics/events', { body: body as never })));
}

export interface WaitlistInput {
  email: string;
  /** S12: thêm `toeic` – danh sách chờ beta kín (trang /beta) */
  program: 'toeic' | 'ielts' | 'jlpt' | 'hsk';
  locale: string;
  consent_marketing: boolean;
}

export type WaitlistOutcome = 'accepted' | 'unavailable';

/**
 * POST /waitlist → 202 (backend Sprint 12 thêm endpoint). Chưa có trên API (404 `not_found` của router) → `unavailable` để
 * giao diện hiện thông báo thân thiện thay vì lỗi. TODO(S12): bỏ nhánh 404 khi endpoint đã phát hành trong OpenAPI.
 */
export async function postWaitlist(body: WaitlistInput): Promise<WaitlistOutcome> {
  const res = await getApi().POST('/waitlist' as never, { body: body as never } as never);
  const status = (res as { response: Response }).response.status;
  if (status === 404 || status === 405 || status === 501) return 'unavailable';
  unwrap(res as never);
  return 'accepted';
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}
