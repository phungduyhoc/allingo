import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { FEATURE_CODES, lookupWordCount, normalizeLookupTerm, pickLocalized, type DictionaryEntry, type LocalizedText, type SegmentTranslateOutput } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { AppError, ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
// Đường dẫn core (không qua index) – tránh vòng import ai-gateway/index → ai-features → catalog (như content-generation)
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';
import { EntitlementService, QuotaService } from '../billing/index.js';
import { UsersService } from '../iam/index.js';
import { TtsService } from '../speech/index.js';

const { catalogVocabItems, aiTranslationCache } = schema;
type VocabRow = typeof catalogVocabItems.$inferSelect;

const LOCALE_NAMES: Record<string, string> = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', th: 'Thai' };
/** Ngôn ngữ nguồn của chương trình (từ điển/TTS) */
const PROGRAM_LANG: Record<string, string> = { toeic: 'en', ielts: 'en', jlpt: 'ja', hsk: 'zh' };
/** Gợi ý "gần đúng" đủ chắc để KHÔNG gọi AI với từ đơn (ai=auto) */
const SUGGEST_STRONG = 0.6;

export interface LookupInput {
  userId: string;
  query: string;
  program: string;
  context?: string | null;
  locale?: string | null;
  ai: 'auto' | 'always' | 'never';
}

/** Kết quả tra (chưa gồm trạng thái SRS – learning bổ sung `saved`/`srs_card_id`) */
export type LookupResult = Omit<DictionaryEntry, 'saved' | 'srs_card_id'>;

/** Khoá cache dịch: term + context + prompt version (chuẩn hoá) – target locale là cột target_lang */
export function translationCacheKey(term: string, context: string | null | undefined, promptVersionId: string): string {
  return createHash('sha256').update(`seg-v1|${promptVersionId}|${normalizeLookupTerm(term)}|${normalizeLookupTerm(context ?? '')}`).digest('hex');
}

class TranslationUnavailable extends AppError {
  constructor(reason: string) {
    super('internal', 'Translation is temporarily unavailable', HttpStatus.SERVICE_UNAVAILABLE, { reason });
  }
}

/**
 * Tra từ (S6, GET /dictionary/lookup): headword/forms (GIN) trong catalog.vocab_items đã phát hành → nghĩa/IPA/ví dụ/collocations;
 * không khớp → gợi ý pg_trgm; không có trong từ điển → `segment_translate` qua AiGateway, cache ai.translation_cache
 * (lần 2 cache hit, không gọi model, không tính quota `dictionary_ai`). Audio: URL TTS đã cache, chưa có thì sinh nền.
 */
@Injectable()
export class DictionaryService {
  private readonly logger = getLogger({ component: 'catalog.dictionary' });
  private attribution: Promise<string | null> | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly entitlements: EntitlementService,
    private readonly quotas: QuotaService,
    private readonly users: UsersService,
    private readonly tts: TtsService,
  ) {}

  /** Ghi nguồn dữ liệu từ điển (DICTIONARY_LICENSE) – nạp lười từ @allingo/db/dictionary, memo */
  private attributionText(): Promise<string | null> {
    this.attribution ??= import('@allingo/db/dictionary').then((m) => m.dictionaryAttribution()).catch(() => null);
    return this.attribution;
  }

  /** Mục từ điển khớp chính xác headword hoặc dạng từ (đã chuẩn hoá) */
  async findEntries(program: string, normalized: string): Promise<{ rows: VocabRow[]; matched: 'headword' | 'form' | 'none' }> {
    const rows = await this.dbs.db
      .select()
      .from(catalogVocabItems)
      .where(and(eq(catalogVocabItems.programCode, program), eq(catalogVocabItems.status, 'published'), sql`(${catalogVocabItems.forms} @> array[${normalized}]::text[] or lower(${catalogVocabItems.headword}) = ${normalized})`))
      .orderBy(
        sql`(lower(${catalogVocabItems.headword}) = ${normalized}) desc`,
        // Mục chính khi một dạng thuộc nhiều từ loại (invoices → invoice n./v.): danh từ → động từ → tính từ → trạng từ → khác
        sql`case lower(coalesce(${catalogVocabItems.pos}, '')) when 'noun' then 0 when 'n' then 0 when 'verb' then 1 when 'v' then 1 when 'adjective' then 2 when 'adverb' then 3 else 4 end`,
        sql`${catalogVocabItems.frequencyRank} asc nulls last`,
        catalogVocabItems.createdAt,
      )
      .limit(6);
    if (!rows.length) return { rows, matched: 'none' };
    const head = rows[0]!.headword;
    const same = rows.filter((r) => r.headword.toLowerCase() === head.toLowerCase());
    return { rows: same, matched: head.toLowerCase() === normalized ? 'headword' : 'form' };
  }

  async suggestions(program: string, normalized: string, limit = 5): Promise<Array<{ headword: string; similarity: number }>> {
    if (normalized.length < 3) return [];
    const rows = await this.dbs.db.execute<{ headword: string; sim: number }>(sql`
      select headword, max(similarity(headword, ${normalized}))::float as sim
        from catalog.vocab_items
       where program_code = ${program} and status = 'published' and headword % ${normalized}
       group by headword
       order by sim desc, headword
       limit ${limit}`);
    return [...rows].map((r) => ({ headword: r.headword, similarity: Math.round(Number(r.sim) * 100) / 100 }));
  }

  private toEntry(query: string, rows: VocabRow[], matched: 'headword' | 'form', locale: string): LookupResult {
    const main = rows[0]!;
    const meanings = rows.flatMap((r) => ((r.meanings as Array<LocalizedText & { en?: string }> | null) ?? []).map((m) => ({ en: m.en?.trim() || null, local: pickLocalized(m, locale) || null, pos: r.pos ?? null })));
    const examples = rows.flatMap((r) => ((r.examples as Array<{ text?: string; translation?: string | LocalizedText }> | null) ?? []).filter((x) => typeof x.text === 'string' && x.text.trim()).map((x) => ({ text: x.text!, translation: typeof x.translation === 'string' ? x.translation : x.translation ? pickLocalized(x.translation, locale) || null : null })));
    return {
      query,
      headword: main.headword,
      pos: main.pos ?? null,
      ipa: main.ipaUs ?? main.ipaUk ?? null,
      ipa_us: main.ipaUs ?? null,
      ipa_uk: main.ipaUk ?? null,
      audio_url: null,
      audio_expires_at: null,
      meaning_en: meanings.find((m) => m.en)?.en ?? null,
      meaning_local: meanings.find((m) => m.local)?.local ?? null,
      example: examples[0]?.text ?? null,
      meanings,
      examples: examples.slice(0, 6),
      collocations: [...new Set(rows.flatMap((r) => ((r.collocations as string[] | null) ?? []).filter((c) => typeof c === 'string')))].slice(0, 12),
      forms: [...new Set(rows.flatMap((r) => r.forms ?? []))],
      level: main.level ?? null,
      topics: [...new Set(rows.flatMap((r) => r.topics ?? []))],
      vocab_item_id: main.id,
      source: 'dictionary',
      matched,
      translation: null,
      cached: false,
      suggestions: [],
      locale,
      attribution: null,
    };
  }

  private emptyEntry(query: string, locale: string): LookupResult {
    return { query, headword: query, pos: null, ipa: null, ipa_us: null, ipa_uk: null, audio_url: null, audio_expires_at: null, meaning_en: null, meaning_local: null, example: null, meanings: [], examples: [], collocations: [], forms: [], level: null, topics: [], vocab_item_id: null, source: 'none', matched: 'none', translation: null, cached: false, suggestions: [], locale, attribution: null };
  }

  /** Gắn URL audio TTS đã cache (ngôn ngữ en); chưa có → sinh nền cho lần sau */
  private async withAudio(entry: LookupResult, text: string, program: string): Promise<LookupResult> {
    if (PROGRAM_LANG[program] !== 'en' || text.length > 500) return entry;
    try {
      const a = await this.tts.cachedAudio(text);
      if (a) return { ...entry, audio_url: a.url, audio_expires_at: a.expiresAt };
      this.tts.warmInBackground(text);
    } catch (err) {
      this.logger.warn({ err: (err as Error).message.slice(0, 200) }, 'tts lookup failed');
    }
    return entry;
  }

  async lookup(input: LookupInput): Promise<LookupResult> {
    const query = input.query.trim();
    const normalized = normalizeLookupTerm(query);
    if (!normalized) throw new ValidationFailed({ issues: [{ path: 'q', message: 'query is empty' }] });
    const user = await this.users.findById(input.userId);
    const locale = input.locale ?? user?.explainLocale ?? 'vi';

    const found = await this.findEntries(input.program, normalized);
    if (found.matched !== 'none') {
      const entry = this.toEntry(query, found.rows, found.matched, locale);
      entry.attribution = await this.attributionText();
      return this.withAudio(entry, entry.headword, input.program);
    }

    const words = lookupWordCount(normalized);
    const suggestions = words === 1 ? await this.suggestions(input.program, normalized) : [];
    const strong = suggestions.some((s) => s.similarity >= SUGGEST_STRONG);
    const useAi = input.ai === 'always' || (input.ai === 'auto' && !strong);
    if (!useAi) return { ...this.emptyEntry(query, locale), suggestions };

    const t = await this.translate(input.userId, input.program, query, input.context ?? null, locale);
    const entry: LookupResult = { ...this.emptyEntry(query, locale), source: 'ai', translation: { text: t.text, needs_review: t.needsReview, ai_task_id: t.aiTaskId }, cached: t.cached, meaning_local: t.text, suggestions };
    return this.withAudio(entry, query, input.program);
  }

  /** segment_translate với cache (khoá chuẩn hoá term + context + prompt version; cột target_lang = locale) */
  async translate(userId: string, program: string, text: string, context: string | null, locale: string): Promise<{ text: string; needsReview: boolean; cached: boolean; aiTaskId: string | null }> {
    const task = await this.gateway.resolveTask('segment_translate', program, userId);
    const sourceLang = PROGRAM_LANG[program] ?? 'en';
    const key = translationCacheKey(text, context, task.promptVersionId);
    const [hit] = await this.dbs.db.select({ text: aiTranslationCache.text }).from(aiTranslationCache).where(and(eq(aiTranslationCache.sourceHash, key), eq(aiTranslationCache.sourceLang, sourceLang), eq(aiTranslationCache.targetLang, locale))).limit(1);
    if (hit) return { text: hit.text, needsReview: false, cached: true, aiTaskId: null };

    const ent = await this.entitlements.require(userId, program, FEATURE_CODES.DICTIONARY_AI);
    await this.quotas.consume(userId, ent.planKind, FEATURE_CODES.DICTIONARY_AI);
    try {
      const r = await this.gateway.runTask<SegmentTranslateOutput>({
        taskCode: 'segment_translate',
        userId,
        program,
        taskOverride: task,
        chargeCredits: false,
        locale,
        // Văn bản người học chọn nằm trong <user_input> theo template; ngữ cảnh câu là dữ liệu đề (<data>)
        variables: { video_title: 'Dictionary lookup', category: 'dictionary', source_lang: sourceLang, target_lang: locale, target_locale_name: LOCALE_NAMES[locale] ?? 'Vietnamese', context_summary: (context ?? '').slice(0, 300), sentences: [{ index: 0, text: text.slice(0, 500) }] },
        inputRef: { purpose: 'dictionary', locale, chars: text.length },
      });
      const tr = r.data.translations.find((x) => x.index === 0) ?? r.data.translations[0];
      if (!tr?.text) throw new Error('empty translation');
      // Chỉ cache bản dịch chắc chắn (needs_review = false) – cache hit luôn là bản đáng tin
      if (!tr.needs_review) {
        await this.dbs.db.insert(aiTranslationCache).values({ sourceHash: key, sourceLang, targetLang: locale, text: tr.text }).onConflictDoNothing();
      }
      return { text: tr.text, needsReview: tr.needs_review, cached: false, aiTaskId: r.aiTaskId };
    } catch (err) {
      await this.quotas.refund(userId, ent.planKind, FEATURE_CODES.DICTIONARY_AI);
      this.logger.warn({ err: (err as Error).message.slice(0, 200) }, 'segment_translate failed');
      throw new TranslationUnavailable((err as { reason?: string }).reason ?? 'ai_failed');
    }
  }

  /**
   * Mục từ vựng cho thẻ SRS (learning, S6): theo id (đã phát hành hoặc mục AI draft) hoặc headword (từ điển → bản dịch đã cache
   * → tạo `vocab_items` source `ai`, status `draft` – không hiện trong tra từ). Trả null nếu không tìm thấy id.
   */
  async resolveVocabItem(program: string, ref: { id?: string; headword?: string; locale?: string; context?: string | null }): Promise<VocabRow | null> {
    if (ref.id) {
      const [row] = await this.dbs.db.select().from(catalogVocabItems).where(eq(catalogVocabItems.id, ref.id)).limit(1);
      return row ?? null;
    }
    const raw = ref.headword?.trim() ?? '';
    const normalized = normalizeLookupTerm(raw);
    if (!normalized) return null;
    const found = await this.findEntries(program, normalized);
    if (found.rows[0]) return found.rows[0];
    const [mine] = await this.dbs.db
      .select()
      .from(catalogVocabItems)
      .where(and(eq(catalogVocabItems.programCode, program), eq(catalogVocabItems.source, 'ai'), inArray(catalogVocabItems.status, ['draft']), sql`${catalogVocabItems.forms} @> array[${normalized}]::text[]`))
      .limit(1);
    if (mine) return mine;
    // Bản dịch đã cache (lookup trước đó) làm nghĩa; không có → để trống (S10 bổ sung)
    let local: string | null = null;
    try {
      const pv = await this.gateway.currentPromptVersionId('segment_translate', program, null);
      if (pv) {
        const [hit] = await this.dbs.db.select({ text: aiTranslationCache.text }).from(aiTranslationCache).where(and(eq(aiTranslationCache.sourceHash, translationCacheKey(raw, ref.context ?? null, pv)), eq(aiTranslationCache.targetLang, ref.locale ?? 'vi'))).limit(1);
        local = hit?.text ?? null;
      }
    } catch {
      local = null;
    }
    const [row] = await this.dbs.db
      .insert(catalogVocabItems)
      .values({ programCode: program, kind: 'word', headword: raw.slice(0, 100), meanings: local ? [{ [ref.locale ?? 'vi']: local }] : [], examples: ref.context ? [{ text: ref.context }] : [], collocations: [], forms: [normalized], source: 'ai', status: 'draft' })
      .returning();
    return row!;
  }

  /** Payload hiển thị thẻ (SRS) từ mục từ vựng */
  static cardPayload(row: VocabRow, locale: string, context?: string | null): Record<string, unknown> {
    const m = ((row.meanings as Array<LocalizedText> | null) ?? [])[0] ?? {};
    return { headword: row.headword, pos: row.pos ?? null, ipa: row.ipaUs ?? row.ipaUk ?? null, meaning_local: pickLocalized(m, locale) || null, meaning_en: (m as { en?: string }).en ?? null, level: row.level ?? null, source: row.source, ...(context ? { context } : {}) };
  }
}
