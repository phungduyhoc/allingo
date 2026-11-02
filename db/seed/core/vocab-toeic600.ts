/**
 * Seed "TOEIC 600 từ theo chủ đề" (Sprint 10) – dựng TỪ từ điển tự biên soạn đã nhập (`catalog.vocab_items`, S6 – không sửa
 * dữ liệu từ điển): 10 bộ chủ đề + 1 bộ trọn gói (600 từ, mỗi từ thuộc đúng một chủ đề).
 *
 * Chọn từ (xác định, không phụ thuộc uuid của DB):
 *  1. Ứng viên: chương trình toeic, kind `word`, status `published`, source `human`, level A2–C1, có `topics` chứa mã chủ đề;
 *     gộp theo headword (không phân biệt hoa thường), mỗi headword lấy mục đầu theo (pos, headword).
 *  2. Ưu tiên mức B1 → A2 → B2 → C1 (mục tiêu TOEIC 600 ≈ B1); trong cùng mức xếp theo sha256(chủ đề:headword) để rải đều bảng chữ.
 *  3. Chủ đề khan hiếm chọn trước (health → … → business); thiếu ứng viên → phần thiếu chuyển sang bộ "business".
 *  4. Thứ tự trong bộ: mức (A2, B1, B2, C1) rồi headword – thẻ mới được học từ dễ đến khó.
 * Idempotent: id bộ từ xác định (uuid từ sha256), chủ đề upsert theo (program, code), mục trong bộ đồng bộ (thêm/xoá/sắp lại).
 * Chạy lại → 0 thay đổi. Chưa có từ điển → bỏ qua (cảnh báo).
 */
import { createHash } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../../src/client.js';
import { catalogTopics, catalogVocabItems, catalogVocabListItems, catalogVocabLists } from '../../drizzle/schema/index.js';

export interface Toeic600Topic {
  code: string;
  vi: string;
  en: string;
  quota: number;
}

/** Thứ tự = thứ tự hiển thị; `quota` cộng lại = 600 */
export const TOEIC600_TOPICS: readonly Toeic600Topic[] = [
  { code: 'office', vi: 'Văn phòng', en: 'Office', quota: 90 },
  { code: 'business', vi: 'Kinh doanh', en: 'Business', quota: 100 },
  { code: 'finance', vi: 'Tài chính – kế toán', en: 'Finance & accounting', quota: 55 },
  { code: 'hr', vi: 'Nhân sự – tuyển dụng', en: 'HR & recruitment', quota: 55 },
  { code: 'travel', vi: 'Du lịch – công tác', en: 'Travel', quota: 70 },
  { code: 'shopping', vi: 'Mua sắm – bán hàng', en: 'Shopping & sales', quota: 60 },
  { code: 'technology', vi: 'Công nghệ', en: 'Technology', quota: 60 },
  { code: 'logistics', vi: 'Vận chuyển – kho vận', en: 'Logistics', quota: 45 },
  { code: 'education', vi: 'Đào tạo – hội thảo', en: 'Training & events', quota: 35 },
  { code: 'health', vi: 'Sức khoẻ – y tế', en: 'Health', quota: 30 },
];
export const TOEIC600_TOTAL = 600;
const LEVEL_PRIORITY: Record<string, number> = { B1: 0, A2: 1, B2: 2, C1: 3 };
const LEVEL_DISPLAY: Record<string, number> = { A2: 0, B1: 1, B2: 2, C1: 3 };
/** Bộ dồn phần thiếu */
const OVERFLOW_TOPIC = 'business';
/** sort_order của bộ TOEIC 600 (sau bộ demo 20 từ – sort 0) */
const SORT_BASE = 10;

/** uuid xác định từ khoá (định dạng v4 hợp lệ) */
export function stableUuid(key: string): string {
  const h = createHash('sha256').update(`allingo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const toeic600ListId = (topic: string) => stableUuid(`vocab_list:toeic600:${topic}`);

export interface Toeic600Candidate {
  id: string;
  headword: string;
  pos: string | null;
  level: string | null;
  topics: string[];
}

/** Chọn 600 từ theo chủ đề (thuần – test được) */
export function selectToeic600(candidates: readonly Toeic600Candidate[], topics: readonly Toeic600Topic[] = TOEIC600_TOPICS): Map<string, Toeic600Candidate[]> {
  const byHead = new Map<string, Toeic600Candidate>();
  for (const c of [...candidates].sort((a, b) => a.headword.toLowerCase().localeCompare(b.headword.toLowerCase()) || (a.pos ?? '').localeCompare(b.pos ?? '') || a.headword.localeCompare(b.headword))) {
    if (!c.level || LEVEL_PRIORITY[c.level] === undefined || !c.topics.length) continue;
    const k = c.headword.trim().toLowerCase();
    if (!byHead.has(k)) byHead.set(k, c);
  }
  const pool = [...byHead.values()];
  const counts = new Map(topics.map((t) => [t.code, pool.filter((c) => c.topics.includes(t.code)).length]));
  const order = [...topics].sort((a, b) => (counts.get(a.code) ?? 0) / a.quota - (counts.get(b.code) ?? 0) / b.quota || a.code.localeCompare(b.code));
  const used = new Set<string>();
  const out = new Map<string, Toeic600Candidate[]>(topics.map((t) => [t.code, []]));
  let deficit = 0;
  const rank = (topic: string, c: Toeic600Candidate) => [LEVEL_PRIORITY[c.level!]!, createHash('sha256').update(`${topic}:${c.headword.toLowerCase()}`).digest('hex')] as const;
  const take = (topic: string, n: number) => {
    const cands = pool
      .filter((c) => !used.has(c.id) && c.topics.includes(topic))
      .map((c) => ({ c, r: rank(topic, c) }))
      .sort((x, y) => x.r[0] - y.r[0] || x.r[1].localeCompare(y.r[1]))
      .slice(0, n)
      .map((x) => x.c);
    for (const c of cands) used.add(c.id);
    out.get(topic)!.push(...cands);
    return cands.length;
  };
  for (const t of order) {
    if (t.code === OVERFLOW_TOPIC) continue;
    deficit += t.quota - take(t.code, t.quota);
  }
  const overflow = topics.find((t) => t.code === OVERFLOW_TOPIC);
  if (overflow) take(OVERFLOW_TOPIC, overflow.quota + deficit);
  for (const [k, list] of out) out.set(k, [...list].sort((a, b) => (LEVEL_DISPLAY[a.level!] ?? 9) - (LEVEL_DISPLAY[b.level!] ?? 9) || a.headword.toLowerCase().localeCompare(b.headword.toLowerCase())));
  return out;
}

export interface Toeic600SeedResult {
  lists: number;
  words: number;
  inserted: number;
  removed: number;
}

async function syncItems(db: Db, listId: string, itemIds: string[]): Promise<{ inserted: number; removed: number }> {
  const existing = await db.select({ id: catalogVocabListItems.vocabItemId, sort: catalogVocabListItems.sortOrder }).from(catalogVocabListItems).where(eq(catalogVocabListItems.listId, listId));
  const cur = new Map(existing.map((e) => [e.id, e.sort]));
  const removed = existing.filter((e) => !itemIds.includes(e.id)).length;
  if (removed) await db.delete(catalogVocabListItems).where(and(eq(catalogVocabListItems.listId, listId), itemIds.length ? notInArray(catalogVocabListItems.vocabItemId, itemIds) : sql`true`));
  const rows = itemIds.map((id, i) => ({ listId, vocabItemId: id, sortOrder: i + 1 })).filter((r) => cur.get(r.vocabItemId) !== r.sortOrder);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db
      .insert(catalogVocabListItems)
      .values(chunk)
      .onConflictDoUpdate({ target: [catalogVocabListItems.listId, catalogVocabListItems.vocabItemId], set: { sortOrder: sql`excluded.sort_order` } });
    inserted += chunk.filter((r) => !cur.has(r.vocabItemId)).length;
  }
  return { inserted, removed };
}

export async function seedToeic600(db: Db): Promise<Toeic600SeedResult | null> {
  const candidates = await db
    .select({ id: catalogVocabItems.id, headword: catalogVocabItems.headword, pos: catalogVocabItems.pos, level: catalogVocabItems.level, topics: catalogVocabItems.topics })
    .from(catalogVocabItems)
    .where(and(eq(catalogVocabItems.programCode, 'toeic'), eq(catalogVocabItems.kind, 'word'), eq(catalogVocabItems.status, 'published'), eq(catalogVocabItems.source, 'human'), inArray(catalogVocabItems.level, Object.keys(LEVEL_PRIORITY)), sql`cardinality(${catalogVocabItems.topics}) > 0`));
  if (candidates.length < 100) return null;
  const selected = selectToeic600(candidates);
  // Chủ đề (catalog.topics – UNIQUE (program, code))
  await db
    .insert(catalogTopics)
    .values(TOEIC600_TOPICS.map((t) => ({ programCode: 'toeic', code: t.code, name: { vi: t.vi, en: t.en } })))
    .onConflictDoUpdate({ target: [catalogTopics.programCode, catalogTopics.code], set: { name: sql`excluded.name` } });
  const topicRows = await db.select({ id: catalogTopics.id, code: catalogTopics.code }).from(catalogTopics).where(and(eq(catalogTopics.programCode, 'toeic'), inArray(catalogTopics.code, TOEIC600_TOPICS.map((t) => t.code))));
  const topicId = new Map(topicRows.map((r) => [r.code, r.id]));
  const lists = [
    { id: toeic600ListId('all'), kind: 'core', title: { vi: 'TOEIC 600 từ theo chủ đề – trọn bộ', en: 'TOEIC 600 words by topic – full set' }, topicId: null as string | null, sort: SORT_BASE, items: TOEIC600_TOPICS.flatMap((t) => selected.get(t.code) ?? []).map((c) => c.id) },
    ...TOEIC600_TOPICS.map((t, i) => ({ id: toeic600ListId(t.code), kind: 'topic', title: { vi: `TOEIC 600 – ${t.vi}`, en: `TOEIC 600 – ${t.en}` }, topicId: topicId.get(t.code) ?? null, sort: SORT_BASE + 1 + i, items: (selected.get(t.code) ?? []).map((c) => c.id) })),
  ];
  let inserted = 0;
  let removed = 0;
  for (const l of lists) {
    await db
      .insert(catalogVocabLists)
      .values({ id: l.id, programCode: 'toeic', kind: l.kind, title: l.title, topicId: l.topicId, ownerUserId: null, isFree: true, sortOrder: l.sort })
      .onConflictDoUpdate({ target: catalogVocabLists.id, set: { kind: l.kind, title: l.title, topicId: l.topicId, isFree: true, sortOrder: l.sort } });
    const r = await syncItems(db, l.id, l.items);
    inserted += r.inserted;
    removed += r.removed;
  }
  return { lists: lists.length, words: lists[0]!.items.length, inserted, removed };
}
