import { unwrap } from '@allingo/api-client';
import { messageSchema, threadDetailSchema, threadSchema, type Message, type Thread, type ThreadDetail } from '@allingo/schemas/api/core';
import { dictionaryEntrySchema, noteSchema, notificationPreferencesSchema, pushSubscriptionSchema, srsCardSchema, ttsResultSchema, vapidPublicKeySchema, type DictionaryEntry, type Note, type NotificationPreferences, type NotificationPreferencesPatch, type PushSubscriptionInput, type PushSubscriptionView, type SrsCard, type SrsCardCreate, type TtsResult } from '@allingo/schemas/api/learning-tools';
import type { z } from 'zod';
import { getApi, postJsonOrStream } from './api';
import type { Page } from './types';

/**
 * Lời gọi API Sprint 6 (gia sư, tra từ, TTS, SRS, ghi chú, Web Push) – hàm thuần dùng trong hook/TanStack Query.
 * Phản hồi được validate bằng Zod của packages/schemas (đầy đủ hơn kiểu OpenAPI sinh ra); sai dạng → dùng dữ liệu thô
 * đã ép kiểu (không chặn UI vì một trường thêm/thiếu – server mới là nguồn sự thật).
 */

function parseOr<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  return r.success ? r.data : (data as T);
}

const pageOf = <T>(schema: z.ZodType<T>, data: unknown): Page<T> => {
  const d = (data ?? {}) as { data?: unknown[]; next_cursor?: string | null };
  return { data: (d.data ?? []).map((x) => parseOr(schema, x)), next_cursor: d.next_cursor ?? null };
};

// ----------------------------------------------------------------------------- Gia sư

export interface ThreadCreateInput {
  program?: string;
  context?: { attempt_id?: string; question_version_id?: string; kind?: 'free' };
  title?: string;
}

export async function createThread(body: ThreadCreateInput): Promise<Thread> {
  return parseOr(threadSchema, unwrap(await getApi().POST('/ai/threads', { body: body as never })));
}

export async function listThreads(cursor?: string | null, limit = 20): Promise<Page<Thread>> {
  const query = { limit, ...(cursor ? { cursor } : {}) };
  return pageOf(threadSchema, unwrap(await getApi().GET('/ai/threads', { params: { query } as never })));
}

export async function getThread(threadId: string, limit = 50): Promise<ThreadDetail> {
  return parseOr(
    threadDetailSchema,
    unwrap(await getApi().GET('/ai/threads/{threadId}', { params: { path: { threadId }, query: { limit } } as never })),
  );
}

/** Trang tin cũ hơn (next_cursor của ThreadDetail) – mỗi trang sắp xếp cũ → mới */
export async function listOlderMessages(threadId: string, cursor: string, limit = 50): Promise<Page<Message>> {
  return pageOf(
    messageSchema,
    unwrap(
      await getApi().GET('/ai/threads/{threadId}/messages', {
        params: { path: { threadId }, query: { cursor, limit } } as never,
      }),
    ),
  );
}

/** POST /ai/threads/{id}/messages → SSE (start → delta* → result → done | error); lỗi HTTP trước stream ném ApiError */
export function sendThreadMessage(threadId: string, text: string, signal?: AbortSignal) {
  return postJsonOrStream(`/ai/threads/${encodeURIComponent(threadId)}/messages`, { text }, signal);
}

// ----------------------------------------------------------------------------- Tra từ & TTS

export interface LookupParams {
  q: string;
  context?: string | null;
  program?: string;
  ai?: 'auto' | 'always' | 'never';
  locale?: string;
}

export async function lookupDictionary(p: LookupParams, signal?: AbortSignal): Promise<DictionaryEntry> {
  const query = {
    q: p.q,
    program: p.program ?? 'toeic',
    ai: p.ai ?? 'auto',
    ...(p.context ? { context: p.context } : {}),
    ...(p.locale ? { locale: p.locale } : {}),
  };
  return parseOr(
    dictionaryEntrySchema,
    unwrap(await getApi().GET('/dictionary/lookup', { params: { query } as never, signal })),
  );
}

export async function fetchTts(text: string, voice?: string): Promise<TtsResult> {
  const query = { text, ...(voice ? { voice } : {}) };
  return parseOr(ttsResultSchema, unwrap(await getApi().GET('/tts', { params: { query } as never })));
}

/** 201 (mới) / 200 (`created: false` – đã có); trả kèm cờ `created` chuẩn hoá */
export async function addSrsCard(body: SrsCardCreate): Promise<SrsCard & { created: boolean }> {
  const res = await getApi().POST('/me/srs/cards', { body: body as never });
  const card = parseOr(srsCardSchema, unwrap(res));
  return { ...card, created: card.created ?? res.response.status === 201 };
}

// ----------------------------------------------------------------------------- Ghi chú

export interface NotesQuery {
  q?: string;
  question_version_id?: string;
  attempt_id?: string;
  cursor?: string | null;
  limit?: number;
}

export async function listNotes(q: NotesQuery = {}): Promise<Page<Note>> {
  const query = Object.fromEntries(
    Object.entries({ ...q, limit: q.limit ?? 20 }).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
  return pageOf(noteSchema, unwrap(await getApi().GET('/notes', { params: { query } as never })));
}

export async function createNote(body: {
  body: string;
  question_version_id?: string;
  attempt_id?: string;
  question_id?: string;
}): Promise<Note> {
  return parseOr(noteSchema, unwrap(await getApi().POST('/notes', { body: body as never })));
}

export async function updateNote(noteId: string, body: string): Promise<Note> {
  return parseOr(
    noteSchema,
    unwrap(await getApi().PATCH('/notes/{noteId}', { params: { path: { noteId } }, body: { body } as never })),
  );
}

export async function deleteNote(noteId: string): Promise<void> {
  const res = await getApi().DELETE('/notes/{noteId}', { params: { path: { noteId } } });
  // 404 = đã xoá ở nơi khác → coi như xong
  if (res.response.status === 404) return;
  unwrap(res);
}

// ----------------------------------------------------------------------------- Thông báo & Web Push

export async function getVapidKey(): Promise<{ public_key: string | null; enabled: boolean }> {
  return parseOr(vapidPublicKeySchema, unwrap(await getApi().GET('/push/vapid-public-key')));
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return parseOr(notificationPreferencesSchema, unwrap(await getApi().GET('/me/notification-preferences')));
}

export async function patchNotificationPreferences(
  body: NotificationPreferencesPatch,
): Promise<NotificationPreferences> {
  return parseOr(
    notificationPreferencesSchema,
    unwrap(await getApi().PATCH('/me/notification-preferences', { body: body as never })),
  );
}

export async function listPushSubscriptions(): Promise<PushSubscriptionView[]> {
  return pageOf(pushSubscriptionSchema, unwrap(await getApi().GET('/me/push-subscriptions'))).data;
}

export async function registerPushSubscription(body: PushSubscriptionInput): Promise<PushSubscriptionView> {
  return parseOr(
    pushSubscriptionSchema,
    unwrap(await getApi().POST('/me/push-subscriptions', { body: body as never })),
  );
}

export async function deletePushSubscription(subscriptionId: string): Promise<void> {
  const res = await getApi().DELETE('/me/push-subscriptions/{subscriptionId}', {
    params: { path: { subscriptionId } },
  });
  if (res.response.status === 404) return;
  unwrap(res);
}
