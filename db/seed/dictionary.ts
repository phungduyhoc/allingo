/**
 * Nhập từ điển mở EN→VI vào `catalog.vocab_items` (kind `word`, source `human`, status `published`) – Sprint 6.
 *
 * - Dữ liệu: `db/seed/dictionary/toeic-core-en-vi.ts` (agent nội dung biên soạn, giấy phép trong `DICTIONARY_LICENSE`,
 *   ghi ở docs/LICENSES.md). Tệp này KHÔNG sửa dữ liệu – chỉ ánh xạ sang DDL.
 * - Idempotent: khớp mục có sẵn theo (program, kind word, headword chuẩn hoá, từ loại); headword chỉ có một mục trong từ điển thì
 *   "nhận" luôn hàng cũ khác từ loại (vd 20 từ demo `pos: 'n'`) để giữ id (vocab_list_items/srs_cards trỏ tới). Chạy lại → 0 thay đổi.
 * - `forms` = headword + dạng biến đổi, chuẩn hoá bằng `normalizeLookupTerm` (CÙNG hàm API dùng khi tra) → GIN `ix_vocab_items_forms`.
 * - meanings `[{vi, en}]` (như seed demo), examples `[{text, translation: {vi}}]` (i18n JSONB – CLAUDE.md §5.11).
 *
 * Gọi từ `pnpm db:seed --set core` (sau catalog) hoặc riêng `pnpm db:seed --set dictionary`.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { normalizeLookupTerm } from '@allingo/schemas';
import type { Db } from '../src/client.js';
import { catalogVocabItems } from '../drizzle/schema/index.js';

/** Mục từ điển (hình dạng export `DICTIONARY_TOEIC_CORE` của tệp dữ liệu) */
export interface DictEntry {
  headword: string;
  pos: string;
  ipa_us?: string | null;
  ipa_uk?: string | null;
  meanings: Array<{ vi: string; en: string }>;
  examples: Array<{ en: string; vi: string }>;
  collocations: string[];
  level?: string | null;
  topics: string[];
  forms: string[];
}

/** Module dữ liệu từ điển (tải động – tệp do agent nội dung viết song song) */
export interface DictionaryModule {
  DICTIONARY_TOEIC_CORE: DictEntry[];
  DICTIONARY_LICENSE?: unknown;
  normalizeTerm?: (s: string) => string;
  buildFormIndex?: (entries: DictEntry[]) => Map<string, unknown> | Record<string, unknown>;
}

export interface DictionaryImportResult {
  total: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
}

const DATA_MODULE = './dictionary/toeic-core-en-vi.js';

/** Tải module dữ liệu; chưa có tệp → null (seed core vẫn chạy, ghi cảnh báo) */
export async function loadDictionaryModule(specifier: string = DATA_MODULE): Promise<DictionaryModule | null> {
  try {
    // Đường dẫn trong biến: typecheck/build không phụ thuộc tệp dữ liệu (agent nội dung viết song song); tương đối với tệp này
    const mod = (await import(/* @vite-ignore */ specifier)) as Partial<DictionaryModule>;
    return Array.isArray(mod.DICTIONARY_TOEIC_CORE) ? (mod as DictionaryModule) : null;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module|Failed to load url|does not exist/i.test((err as Error).message)) return null;
    throw err;
  }
}

/** Chuỗi ghi nguồn ngắn từ DICTIONARY_LICENSE (chuỗi hoặc object {name|title, license|spdx, source|url, attribution}) */
export function formatAttribution(license: unknown): string | null {
  if (!license) return null;
  if (typeof license === 'string') return license.trim().slice(0, 240) || null;
  if (typeof license === 'object') {
    const l = license as Record<string, unknown>;
    const pick = (...keys: string[]) => keys.map((k) => l[k]).find((v): v is string => typeof v === 'string' && v.trim().length > 0)?.trim();
    const explicit = pick('attribution', 'notice');
    if (explicit) return explicit.slice(0, 240);
    const parts = [pick('name', 'title', 'dataset'), pick('license', 'spdx', 'licence'), pick('author', 'authors', 'copyright', 'holder')].filter(Boolean);
    return parts.length ? parts.join(' · ').slice(0, 240) : null;
  }
  return null;
}

let attributionCache: { value: string | null } | null = null;
/** Ghi nguồn dữ liệu từ điển (API hiển thị dưới popover tra từ); memo trong process */
export async function dictionaryAttribution(): Promise<string | null> {
  if (attributionCache) return attributionCache.value;
  const mod = await loadDictionaryModule().catch(() => null);
  attributionCache = { value: formatAttribution(mod?.DICTIONARY_LICENSE) };
  return attributionCache.value;
}

/** Từ loại về dạng đầy đủ để so khớp (n → noun …); giữ nguyên nếu không biết */
export function normalizePos(pos: string | null | undefined): string {
  const p = (pos ?? '').trim().toLowerCase().replace(/\.$/, '');
  const map: Record<string, string> = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', conj: 'conjunction', pron: 'pronoun', phr: 'phrase', 'phr v': 'phrasal verb', phrv: 'phrasal verb', det: 'determiner', interj: 'interjection' };
  return map[p] ?? p;
}

const uniq = (xs: string[]) => [...new Set(xs.filter((x) => x.length > 0))];

/** Ánh xạ một mục sang giá trị cột vocab_items (thuần, để test) */
export function toVocabRow(e: DictEntry, program = 'toeic', normalize: (s: string) => string = normalizeLookupTerm) {
  const headword = e.headword.trim();
  const forms = uniq([normalize(headword), ...(e.forms ?? []).map((f) => normalize(f))]);
  return {
    programCode: program,
    kind: 'word' as const,
    headword,
    pos: e.pos?.trim() || null,
    ipaUs: e.ipa_us?.trim() || null,
    ipaUk: e.ipa_uk?.trim() || null,
    meanings: (e.meanings ?? []).map((m) => ({ vi: m.vi?.trim() ?? '', en: m.en?.trim() ?? '' })),
    examples: (e.examples ?? []).map((x) => ({ text: x.en.trim(), translation: { vi: x.vi?.trim() ?? '' } })),
    collocations: uniq((e.collocations ?? []).map((c) => c.trim())),
    level: e.level?.trim() || null,
    topics: uniq((e.topics ?? []).map((t) => t.trim().toLowerCase())),
    forms,
    source: 'human' as const,
    status: 'published' as const,
  };
}
type VocabRow = ReturnType<typeof toVocabRow>;

const COMPARE_KEYS = ['headword', 'pos', 'ipaUs', 'ipaUk', 'meanings', 'examples', 'collocations', 'level', 'topics', 'forms', 'source', 'status'] as const;
const stable = (v: unknown): string => JSON.stringify(v, (_k, val: unknown) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : val));

/**
 * Nhập danh sách mục (idempotent, một transaction). `normalize` mặc định = normalizeLookupTerm (khớp API).
 * Mục trùng (cùng headword + từ loại) trong dữ liệu → giữ mục đầu, đếm `skipped`.
 */
export async function importDictionary(db: Db, entries: DictEntry[], opts: { program?: string; normalize?: (s: string) => string } = {}): Promise<DictionaryImportResult> {
  const program = opts.program ?? 'toeic';
  const normalize = opts.normalize ?? normalizeLookupTerm;
  const result: DictionaryImportResult = { total: entries.length, inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  const rows: VocabRow[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e?.headword?.trim()) {
      result.skipped++;
      continue;
    }
    const r = toVocabRow(e, program, normalize);
    const key = `${normalize(r.headword)}|${normalizePos(r.pos)}`;
    if (seen.has(key)) {
      result.skipped++;
      continue;
    }
    seen.add(key);
    rows.push(r);
  }
  const perHeadword = new Map<string, number>();
  for (const r of rows) perHeadword.set(normalize(r.headword), (perHeadword.get(normalize(r.headword)) ?? 0) + 1);

  await db.transaction(async (tx) => {
    const heads = [...perHeadword.keys()];
    const existing = heads.length
      ? await tx
          .select()
          .from(catalogVocabItems)
          .where(and(eq(catalogVocabItems.programCode, program), eq(catalogVocabItems.kind, 'word'), inArray(sql`lower(${catalogVocabItems.headword})`, heads)))
      : [];
    const byHead = new Map<string, Array<(typeof existing)[number]>>();
    for (const x of existing) byHead.set(normalize(x.headword), [...(byHead.get(normalize(x.headword)) ?? []), x]);
    const claimed = new Set<string>();
    const inserts: VocabRow[] = [];
    for (const r of rows) {
      const head = normalize(r.headword);
      const cands = (byHead.get(head) ?? []).filter((c) => !claimed.has(c.id));
      let match = cands.find((c) => normalizePos(c.pos) === normalizePos(r.pos));
      // Headword chỉ có một mục từ điển → nhận hàng cũ cùng headword (seed demo / CMS) thay vì tạo trùng; ưu tiên source human
      if (!match && perHeadword.get(head) === 1) match = cands.find((c) => c.source === 'human') ?? cands[0];
      if (!match) {
        inserts.push(r);
        continue;
      }
      claimed.add(match.id);
      const changed = COMPARE_KEYS.some((k) => stable(match[k]) !== stable(r[k]));
      if (!changed) {
        result.unchanged++;
        continue;
      }
      await tx
        .update(catalogVocabItems)
        .set({ headword: r.headword, pos: r.pos, ipaUs: r.ipaUs, ipaUk: r.ipaUk, meanings: r.meanings, examples: r.examples, collocations: r.collocations, level: r.level, topics: r.topics, forms: r.forms, source: r.source, status: r.status })
        .where(eq(catalogVocabItems.id, match.id));
      result.updated++;
    }
    for (let i = 0; i < inserts.length; i += 200) {
      const chunk = inserts.slice(i, i + 200);
      await tx.insert(catalogVocabItems).values(chunk);
      result.inserted += chunk.length;
    }
  });
  return result;
}

/** Seed từ điển từ tệp dữ liệu; chưa có tệp → bỏ qua (null) */
export async function seedDictionary(db: Db, opts: { specifier?: string } = {}): Promise<DictionaryImportResult | null> {
  const mod = await loadDictionaryModule(opts.specifier);
  if (!mod) return null;
  return importDictionary(db, mod.DICTIONARY_TOEIC_CORE);
}
