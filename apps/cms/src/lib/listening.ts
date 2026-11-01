/**
 * Trường Listening của câu hỏi (Sprint 4): `media.listen_policy` (once/free) và `media.pause_ms` hiển thị như trường form riêng,
 * lưu trong `content.media` (questionMediaSchema – packages/schemas) và đi qua sync hiện có `/internal/content/questions/sync`.
 * Hàm thuần – có unit test (test/listening.test.ts).
 */

export const LISTEN_POLICIES = ['once', 'free'] as const;
export type ListenPolicy = (typeof LISTEN_POLICIES)[number];
export const MAX_PAUSE_MS = 60_000;

export interface ListeningMediaFields {
  /** Giá trị từ form (select) – chấp nhận chuỗi bất kỳ, chỉ 'once' | 'free' được áp dụng */
  listen_policy?: string | null;
  pause_ms?: number | null;
}

/** Section Listening: TOEIC Part 1–4; IELTS `listening_p*`; JLPT/HSK `listening` */
export function isListeningSection(program: string | null | undefined, sectionCode: string | null | undefined): boolean {
  if (!sectionCode) return false;
  if (program === 'toeic') return /^part[1-4]$/.test(sectionCode);
  return /^listening(\b|_)/.test(sectionCode) || sectionCode === 'listening';
}

const isPolicy = (v: unknown): v is ListenPolicy => v === 'once' || v === 'free';
const hasAny = (f: ListeningMediaFields | null | undefined) => !!f && (isPolicy(f.listen_policy) || typeof f.pause_ms === 'number');
const same = (a: ListeningMediaFields | null | undefined, b: ListeningMediaFields | null | undefined) => (a?.listen_policy ?? null) === (b?.listen_policy ?? null) && (a?.pause_ms ?? null) === (b?.pause_ms ?? null);

export interface MergeListeningInput {
  program: string | null | undefined;
  sectionCode: string | null | undefined;
  content: unknown;
  /** Giá trị form hiện gửi lên (data.media) */
  fields: ListeningMediaFields | null | undefined;
  /** Giá trị form trước khi sửa (originalDoc.media); undefined khi tạo mới */
  previousFields?: ListeningMediaFields | null;
  isCreate: boolean;
}

/**
 * Gộp trường form vào `content.media`:
 * - Form đổi so với bản trước (hoặc tạo mới có giá trị) → form thắng; ngược lại JSON `content.media` thắng (sửa trực tiếp JSON/nhập lô).
 * - Tạo mới câu Listening chưa khai báo → `listen_policy = 'once'` (thi thật phát một lần; Practice luôn tự do ở client).
 * - `pause_ms` làm tròn, kẹp 0–60 000. Để trống trong form KHÔNG xoá giá trị trong JSON.
 * Trả `fields` đồng bộ ngược từ content (form luôn phản ánh giá trị thật). Câu không phải Listening → giữ nguyên.
 */
export function mergeListeningMedia(input: MergeListeningInput): { content: unknown; fields: ListeningMediaFields | undefined } {
  const { content } = input;
  if (!isListeningSection(input.program, input.sectionCode) || !content || typeof content !== 'object' || Array.isArray(content)) return { content, fields: undefined };
  const c = content as Record<string, unknown>;
  const media: Record<string, unknown> = c.media && typeof c.media === 'object' && !Array.isArray(c.media) ? { ...(c.media as Record<string, unknown>) } : {};
  const formWins = input.isCreate ? hasAny(input.fields) : !same(input.fields, input.previousFields);
  if (formWins && input.fields) {
    if (isPolicy(input.fields.listen_policy)) media.listen_policy = input.fields.listen_policy;
    if (typeof input.fields.pause_ms === 'number' && Number.isFinite(input.fields.pause_ms)) media.pause_ms = Math.min(MAX_PAUSE_MS, Math.max(0, Math.round(input.fields.pause_ms)));
  }
  if (!isPolicy(media.listen_policy) && (input.isCreate || c.media)) media.listen_policy = 'once';
  const hasMedia = Object.keys(media).length > 0;
  const next = hasMedia ? { ...c, media } : c;
  return { content: next, fields: { listen_policy: isPolicy(media.listen_policy) ? media.listen_policy : null, pause_ms: typeof media.pause_ms === 'number' ? media.pause_ms : null } };
}
