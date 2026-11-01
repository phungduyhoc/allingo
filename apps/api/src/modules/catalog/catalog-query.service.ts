import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, param, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { isSpokenTextSection, questionContentSchema, redactSpokenText, toPublicContent, type LocalizedText, type ProgramCode, type QuestionContent, type QuestionPublic, type QuestionTypeCode, type TranscriptHighlight } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { StorageService } from '../../shared/storage/storage.module.js';
import { NotFound } from '../../shared/http/errors.js';

const { catalogPrograms, catalogSections, catalogSkills, catalogTestSets, catalogTestSetItems, catalogTestSetSections, catalogQuestions, catalogQuestionVersions, catalogPassages, catalogMediaAssets, catalogQuestionSubskills, catalogSubskills, catalogTopics } = schema;

/** Câu hỏi đầy đủ (có answer_key) – chỉ dùng nội bộ server (test-engine chấm, ai-gateway giải thích) */
export interface LoadedQuestion {
  question_id: string;
  question_version_id: string;
  question_type: QuestionTypeCode;
  section_id: string;
  section_code: string;
  skill_code: string;
  group_key: string | null;
  order_no: number;
  points: number;
  content: QuestionContent;
  passage: { id: string; kind: string; title: string | null; body: string | null; media_asset_id: string | null } | null;
  topic_code: string | null;
  subskill_codes: string[];
  exposure_count: number;
  correct_count: number;
  /** Thời gian trung bình cộng đồng (catalog.questions.avg_time_ms) – cập nhật khi chấm */
  avg_time_ms: number | null;
  program_code: string;
}

/** URL phát media: `expires_at` = hạn URL ký (null với URL ngoài không hết hạn) */
export interface MediaUrl {
  id: string;
  kind: string;
  url: string;
  duration_ms: number | null;
  expires_at: string | null;
}

/** Lịch sử luyện của người học (test-engine cung cấp – catalog không đọc bảng learn.*) */
export interface PracticeHistory {
  /** Câu đã làm (có câu trả lời hoặc đã chấm) */
  seen: string[];
  /** Câu làm sai trong 30 ngày gần đây */
  wrongRecent: string[];
}

/** Bộ lọc chọn câu luyện */
export interface RandomQuestionFilter {
  section_code?: string;
  question_type?: string;
  topic?: string;
  subskill?: string;
  count: number;
  excludeQuestionIds?: string[];
  onlyQuestionIds?: string[];
  history?: PracticeHistory;
}

/** Ngân hàng câu đã phát hành cho mini test generator */
export interface BankRow {
  question_id: string;
  question_version_id: string;
  section_code: string;
  group_key: string | null;
  order: number | null;
}

/** Mọi media asset mà nội dung câu tham chiếu (câu, lựa chọn, mục kéo thả/nối, ảnh đề, passage) */
export function assetIdsOfContent(content: QuestionContent): string[] {
  const ids: Array<string | undefined> = [content.media?.audio_asset_id, content.media?.image_asset_id];
  if ('image_asset_id' in content) ids.push(content.image_asset_id);
  const c = content as unknown as Record<string, unknown>;
  for (const key of ['options', 'items', 'left', 'right', 'labels', 'statements']) {
    const arr = c[key];
    if (Array.isArray(arr)) for (const o of arr as Array<{ image_asset_id?: string; audio_asset_id?: string }>) ids.push(o.image_asset_id, o.audio_asset_id);
  }
  return ids.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

/** media_assets.transcript: mảng [{start_ms,end_ms,text,speaker}] (TTS/DDL), {text} (seed Sprint 0) hoặc chuỗi */
export function normalizeTranscript(raw: unknown): { text: string; segments?: TranscriptHighlight['segments'] } | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw.trim() ? { text: raw.trim() } : null;
  if (Array.isArray(raw)) {
    const segments = raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string')
      .map((x) => ({ start_ms: typeof x.start_ms === 'number' ? Math.round(x.start_ms) : null, end_ms: typeof x.end_ms === 'number' ? Math.round(x.end_ms) : null, text: String(x.text), speaker: typeof x.speaker === 'string' ? x.speaker : null }));
    const text = segments.map((x) => x.text).join(' ').trim();
    return text ? { text, segments } : null;
  }
  if (typeof raw === 'object' && typeof (raw as { text?: unknown }).text === 'string') {
    const text = ((raw as { text: string }).text).trim();
    return text ? { text } : null;
  }
  return null;
}

export interface SectionRow {
  id: string;
  code: string;
  skill: string;
  name: LocalizedText;
  level: string | null;
  duration_sec: number | null;
  question_count: number | null;
  rules: Record<string, unknown>;
  sort_order: number;
}

@Injectable()
export class CatalogQueryService {
  constructor(
    private readonly dbs: DbService,
    private readonly storage: StorageService,
  ) {}

  async programs() {
    const rows = await this.dbs.db.select().from(catalogPrograms).where(eq(catalogPrograms.isActive, true)).orderBy(catalogPrograms.sortOrder);
    return rows.map((r) => ({ code: r.code as ProgramCode, name: r.name, score_scale: (r.scoreScale as Record<string, unknown>) ?? {}, languages: r.languages }));
  }

  async sections(program: string, level?: string): Promise<SectionRow[]> {
    const rows = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(and(eq(catalogSections.programCode, program), level ? eq(catalogSections.level, level) : sql`true`))
      .orderBy(catalogSections.sortOrder);
    return rows.map((r) => ({ id: r.s.id, code: r.s.code, skill: r.skill, name: r.s.name, level: r.s.level ?? null, duration_sec: r.s.durationSec ?? null, question_count: r.s.questionCount ?? null, rules: (r.s.rules as Record<string, unknown>) ?? {}, sort_order: r.s.sortOrder }));
  }

  async sectionByCode(program: string, code: string, db: DbOrTx = this.dbs.db) {
    const [row] = await db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(and(eq(catalogSections.programCode, program), eq(catalogSections.code, code)))
      .limit(1);
    return row ? { ...row.s, skillCode: row.skill } : null;
  }

  async sectionById(id: string) {
    const [row] = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.id, id))
      .limit(1);
    return row ? { ...row.s, skillCode: row.skill } : null;
  }

  /** Danh sách đề đã phát hành của chương trình (cursor theo published_at desc, id) */
  async testSets(program: string, opts: { kind?: string; level?: string; limit: number; cursorId?: string | null }) {
    const rows = await this.dbs.db
      .select({ ts: catalogTestSets, count: sql<number>`(select count(*) from catalog.test_set_items i where i.test_set_id = ${catalogTestSets.id})`.mapWith(Number) })
      .from(catalogTestSets)
      .where(
        and(
          eq(catalogTestSets.programCode, program),
          eq(catalogTestSets.status, 'published'),
          opts.kind ? eq(catalogTestSets.kind, opts.kind as never) : sql`true`,
          opts.level ? eq(catalogTestSets.level, opts.level) : sql`true`,
          opts.cursorId ? sql`${catalogTestSets.id} > ${opts.cursorId}` : sql`true`,
        ),
      )
      .orderBy(asc(catalogTestSets.id))
      .limit(opts.limit + 1);
    return rows;
  }

  async testSetById(id: string) {
    const [row] = await this.dbs.db
      .select({ ts: catalogTestSets, count: sql<number>`(select count(*) from catalog.test_set_items i where i.test_set_id = ${catalogTestSets.id})`.mapWith(Number) })
      .from(catalogTestSets)
      .where(eq(catalogTestSets.id, id))
      .limit(1);
    return row ?? null;
  }

  async testSetSections(testSetId: string): Promise<Array<SectionRow & { test_duration_sec: number | null }>> {
    const rows = await this.dbs.db
      .select({ s: catalogSections, skill: catalogSkills.code, tss: catalogTestSetSections })
      .from(catalogTestSetSections)
      .innerJoin(catalogSections, eq(catalogSections.id, catalogTestSetSections.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogTestSetSections.testSetId, testSetId))
      .orderBy(catalogTestSetSections.sortOrder);
    return rows.map((r) => ({ id: r.s.id, code: r.s.code, skill: r.skill, name: r.s.name, level: r.s.level ?? null, duration_sec: r.s.durationSec ?? null, question_count: r.s.questionCount ?? null, rules: (r.s.rules as Record<string, unknown>) ?? {}, sort_order: r.s.sortOrder, test_duration_sec: r.tss.durationSec ?? null }));
  }

  /** Toàn bộ câu hỏi (bản hiện hành) của đề theo thứ tự – dùng khi tạo attempt */
  async loadTestSetQuestions(testSetId: string, db: DbOrTx = this.dbs.db): Promise<LoadedQuestion[]> {
    const rows = await db
      .select({ item: catalogTestSetItems, q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogTestSetItems)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogTestSetItems.questionId))
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogTestSetItems.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(eq(catalogTestSetItems.testSetId, testSetId))
      .orderBy(catalogSections.sortOrder, catalogTestSetItems.sortOrder);
    const subskills = await this.subskillsFor(rows.map((r) => r.q.id), db);
    return rows.map((r, i) => this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: r.item.groupKey ?? null, order_no: i + 1, points: Number(r.item.points) }));
  }

  /** Cache trong tiến trình: question_version_id → question_type (phiên bản bất biến nên không cần vô hiệu) */
  private readonly versionTypeCache = new Map<string, string>();

  /** Dạng câu theo phiên bản – nhẹ, dùng khi lưu nháp (kiểm tra kiểu câu trả lời) thay vì nạp đầy đủ câu hỏi */
  async questionTypesByVersion(versionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const missing: string[] = [];
    for (const id of versionIds) {
      const t = this.versionTypeCache.get(id);
      if (t) out.set(id, t);
      else missing.push(id);
    }
    if (missing.length) {
      const rows = await db
        .select({ id: catalogQuestionVersions.id, type: catalogQuestions.questionTypeCode })
        .from(catalogQuestionVersions)
        .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
        .where(inArray(catalogQuestionVersions.id, missing));
      for (const r of rows) {
        out.set(r.id, r.type);
        if (this.versionTypeCache.size > 50_000) this.versionTypeCache.clear();
        this.versionTypeCache.set(r.id, r.type);
      }
    }
    return out;
  }

  /** Nạp theo question_version_id (review/explain) */
  async loadByVersionIds(versionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, LoadedQuestion>> {
    if (versionIds.length === 0) return new Map();
    const rows = await db
      .select({ q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogQuestionVersions)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(inArray(catalogQuestionVersions.id, versionIds));
    const subskills = await this.subskillsFor(rows.map((r) => r.q.id), db);
    const out = new Map<string, LoadedQuestion>();
    for (const r of rows) out.set(r.v.id, this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: null, order_no: 0, points: 1 }));
    return out;
  }

  /**
   * Câu luyện đã phát hành theo bộ lọc (practice/drill – Sprint 4):
   * 1. ưu tiên nhóm/câu người học CHƯA làm → 2. câu làm SAI trong 30 ngày → 3. còn lại; ngẫu nhiên trong cùng mức;
   * 2. câu cùng passage (Part 3/4/6/7) lấy TRỌN nhóm, liền nhau, `group_key` = passage_id;
   * 3. số câu ≤ count (nhóm không vừa thì bỏ qua); nhóm đầu tiên lớn hơn count vẫn được lấy; nếu còn thiếu, thêm một nhóm
   *    khi tổng mới gần count hơn (vd. count 10, nhóm 3 câu → 9 câu).
   */
  async randomQuestions(program: string, filter: RandomQuestionFilter): Promise<LoadedQuestion[]> {
    if (filter.onlyQuestionIds && filter.onlyQuestionIds.length === 0) return [];
    const seen = filter.history?.seen ?? [];
    const wrong = filter.history?.wrongRecent ?? [];
    const unitId = sql<string>`coalesce(${catalogQuestions.passageId}, ${catalogQuestions.id})`;
    const prio = sql<number>`case when bool_and(not (${catalogQuestions.id} = any(${param(seen)}::uuid[]))) then 0 when bool_or(${catalogQuestions.id} = any(${param(wrong)}::uuid[])) then 1 else 2 end`.mapWith(Number);
    // Bước 1: đơn vị (passage hoặc câu đơn) khớp bộ lọc + mức ưu tiên; lấy dư để có thể bỏ qua nhóm không vừa
    const units = await this.dbs.db
      .select({ unit: unitId, grouped: sql<boolean>`${catalogQuestions.passageId} is not null`, prio })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(
        and(
          eq(catalogQuestions.programCode, program),
          eq(catalogQuestions.status, 'published'),
          filter.section_code ? eq(catalogSections.code, filter.section_code) : sql`true`,
          filter.question_type ? eq(catalogQuestions.questionTypeCode, filter.question_type) : sql`true`,
          filter.topic ? eq(catalogTopics.code, filter.topic) : sql`true`,
          filter.subskill ? sql`exists (select 1 from catalog.question_subskills qs join catalog.subskills ss on ss.id = qs.subskill_id where qs.question_id = ${catalogQuestions.id} and ss.code = ${filter.subskill})` : sql`true`,
          filter.excludeQuestionIds?.length ? sql`${catalogQuestions.id} <> all(${param(filter.excludeQuestionIds)}::uuid[])` : sql`true`,
          filter.onlyQuestionIds?.length ? inArray(catalogQuestions.id, filter.onlyQuestionIds) : sql`true`,
        ),
      )
      .groupBy(unitId, sql`${catalogQuestions.passageId} is not null`)
      .orderBy(prio, sql`random()`)
      .limit(Math.max(filter.count * 3, filter.count + 10));
    if (units.length === 0) return [];

    // Bước 2: nạp TRỌN nhóm (mọi câu đã phát hành của passage, cùng chương trình), thứ tự trong nhóm theo số câu gốc
    const passageIds = units.filter((u) => u.grouped).map((u) => u.unit);
    const singleIds = units.filter((u) => !u.grouped).map((u) => u.unit);
    const rows = await this.dbs.db
      .select({ q: catalogQuestions, v: catalogQuestionVersions, s: catalogSections, skill: catalogSkills.code, p: catalogPassages, topic: catalogTopics.code })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .leftJoin(catalogTopics, eq(catalogTopics.id, catalogQuestions.topicId))
      .where(
        and(
          eq(catalogQuestions.programCode, program),
          eq(catalogQuestions.status, 'published'),
          sql`(${catalogQuestions.passageId} = any(${param(passageIds)}::uuid[]) or ${catalogQuestions.id} = any(${param(singleIds)}::uuid[]))`,
        ),
      )
      .orderBy(sql`case when (${catalogQuestionVersions.metadata} ->> 'number') ~ '^[0-9]{1,6}$' then (${catalogQuestionVersions.metadata} ->> 'number')::int end nulls last`, catalogQuestions.createdAt, catalogQuestions.id);
    const byUnit = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = r.q.passageId ?? r.q.id;
      byUnit.set(k, [...(byUnit.get(k) ?? []), r]);
    }

    const ordered = units.map((u) => ({ unit: u.unit, grouped: u.grouped, rows: byUnit.get(u.unit) ?? [] })).filter((u) => u.rows.length > 0);
    const chosen: typeof ordered = [];
    let total = 0;
    const skipped: typeof ordered = [];
    for (const u of ordered) {
      if (total >= filter.count) break;
      if (total + u.rows.length <= filter.count) {
        chosen.push(u);
        total += u.rows.length;
      } else skipped.push(u);
    }
    if (chosen.length === 0 && ordered[0]) chosen.push(ordered[0]);
    else if (total < filter.count) {
      const extra = skipped.find((u) => total + u.rows.length - filter.count < filter.count - total);
      if (extra) chosen.push(extra);
    }

    const picked = chosen.flatMap((u) => u.rows.map((r) => ({ r, group: u.grouped ? u.unit : null })));
    const subskills = await this.subskillsFor(picked.map((x) => x.r.q.id));
    return picked.map(({ r, group }, i) => this.toLoaded(r.q, r.v, { id: r.s.id, code: r.s.code, skill: r.skill }, r.p, r.topic, subskills.get(r.q.id) ?? [], { group_key: group, order_no: i + 1, points: 1 }));
  }

  /**
   * Ngân hàng câu đã phát hành (bản hiện hành) của chương trình theo section – đầu vào generateMiniTest.
   * group_key = passage_id; order = số câu gốc trong metadata (nếu có).
   */
  async publishedBank(program: string, sectionCodes: string[]): Promise<BankRow[]> {
    if (sectionCodes.length === 0) return [];
    const rows = await this.dbs.db
      .select({
        question_id: catalogQuestions.id,
        question_version_id: catalogQuestionVersions.id,
        section_code: catalogSections.code,
        group_key: catalogQuestions.passageId,
        order: sql<number | null>`case when (${catalogQuestionVersions.metadata} ->> 'number') ~ '^[0-9]{1,6}$' then (${catalogQuestionVersions.metadata} ->> 'number')::int end`,
      })
      .from(catalogQuestions)
      .innerJoin(catalogQuestionVersions, eq(catalogQuestionVersions.id, catalogQuestions.currentVersionId))
      .innerJoin(catalogSections, eq(catalogSections.id, catalogQuestions.sectionId))
      .where(and(eq(catalogQuestions.programCode, program), eq(catalogQuestions.status, 'published'), inArray(catalogSections.code, sectionCodes)));
    return rows.map((r) => ({ ...r, group_key: r.group_key ?? null, order: r.order === null || r.order === undefined ? null : Number(r.order) }));
  }

  /** Asset id của các phiên bản câu (content + passage) – nhẹ, dùng cho GET /attempts/{id}/media */
  async assetIdsForVersions(versionIds: string[]): Promise<string[]> {
    if (versionIds.length === 0) return [];
    const rows = await this.dbs.db
      .select({ content: catalogQuestionVersions.content, passageMedia: catalogPassages.mediaAssetId })
      .from(catalogQuestionVersions)
      .innerJoin(catalogQuestions, eq(catalogQuestions.id, catalogQuestionVersions.questionId))
      .leftJoin(catalogPassages, eq(catalogPassages.id, catalogQuestions.passageId))
      .where(inArray(catalogQuestionVersions.id, versionIds));
    const ids = new Set<string>();
    for (const r of rows) {
      const parsed = questionContentSchema.safeParse(r.content);
      if (parsed.success) for (const id of assetIdsOfContent(parsed.data)) ids.add(id);
      if (r.passageMedia) ids.add(r.passageMedia);
    }
    return [...ids];
  }

  /**
   * Transcript audio cho Review/feedback (Sprint 4): passage `audio_script` (Part 3/4, + mốc thời gian của audio passage nếu có)
   * hoặc `media_assets.transcript` của audio câu (Part 1/2); thiếu cả hai mà câu có audio → `content.evidence` của tác giả.
   * Câu không có audio → không có trong kết quả.
   */
  async transcripts(questions: LoadedQuestion[]): Promise<Map<string, TranscriptHighlight>> {
    const out = new Map<string, TranscriptHighlight>();
    const audioIds = new Set<string>();
    for (const q of questions) {
      if (q.content.media?.audio_asset_id) audioIds.add(q.content.media.audio_asset_id);
      if (q.passage?.media_asset_id) audioIds.add(q.passage.media_asset_id);
    }
    const tx = new Map<string, { kind: string; transcript: unknown }>();
    if (audioIds.size) {
      const rows = await this.dbs.db.select({ id: catalogMediaAssets.id, kind: catalogMediaAssets.kind, transcript: catalogMediaAssets.transcript }).from(catalogMediaAssets).where(inArray(catalogMediaAssets.id, [...audioIds]));
      for (const r of rows) tx.set(r.id, { kind: r.kind, transcript: r.transcript });
    }
    for (const q of questions) {
      const evidence = q.content.evidence ?? null;
      const passageAudio = q.passage?.media_asset_id ? tx.get(q.passage.media_asset_id) : undefined;
      if (q.passage?.kind === 'audio_script' && q.passage.body) {
        const seg = normalizeTranscript(passageAudio?.transcript);
        out.set(q.question_id, { text: q.passage.body, ...(seg?.segments ? { segments: seg.segments } : {}), evidence, source: 'passage', asset_id: q.passage.media_asset_id });
        continue;
      }
      const audioId = q.content.media?.audio_asset_id ?? (passageAudio?.kind === 'audio' ? q.passage!.media_asset_id : null);
      if (!audioId) continue;
      const t = normalizeTranscript(tx.get(audioId)?.transcript);
      if (t) out.set(q.question_id, { text: t.text, ...(t.segments ? { segments: t.segments } : {}), evidence, source: 'media', asset_id: audioId });
      else if (evidence) out.set(q.question_id, { text: evidence, evidence, source: 'evidence', asset_id: audioId });
    }
    return out;
  }

  private async subskillsFor(questionIds: string[], db: DbOrTx = this.dbs.db): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (questionIds.length === 0) return map;
    const rows = await db
      .select({ qid: catalogQuestionSubskills.questionId, code: catalogSubskills.code })
      .from(catalogQuestionSubskills)
      .innerJoin(catalogSubskills, eq(catalogSubskills.id, catalogQuestionSubskills.subskillId))
      .where(inArray(catalogQuestionSubskills.questionId, questionIds));
    for (const r of rows) map.set(r.qid, [...(map.get(r.qid) ?? []), r.code]);
    return map;
  }

  private toLoaded(
    q: typeof catalogQuestions.$inferSelect,
    v: typeof catalogQuestionVersions.$inferSelect,
    s: { id: string; code: string; skill: string },
    p: typeof catalogPassages.$inferSelect | null,
    topic: string | null,
    subskills: string[],
    item: { group_key: string | null; order_no: number; points: number },
  ): LoadedQuestion {
    const parsed = questionContentSchema.safeParse(v.content);
    if (!parsed.success) throw new Error(`question_version ${v.id} có content không hợp lệ: ${parsed.error.issues[0]?.message}`);
    return {
      question_id: q.id,
      question_version_id: v.id,
      question_type: parsed.data.type,
      section_id: s.id,
      section_code: s.code,
      skill_code: s.skill,
      group_key: item.group_key,
      order_no: item.order_no,
      points: item.points,
      content: parsed.data,
      passage: p ? { id: p.id, kind: p.kind, title: p.title ?? null, body: p.body ?? null, media_asset_id: p.mediaAssetId ?? null } : null,
      topic_code: topic,
      subskill_codes: subskills,
      exposure_count: q.exposureCount,
      correct_count: q.correctCount,
      avg_time_ms: q.avgTimeMs ?? null,
      program_code: q.programCode,
    };
  }

  /**
   * URL media (presigned/external) cho các asset id. Chỉ asset `ready`; URL ký hết hạn sau S3_PRESIGN_TTL_SECONDS (10′) –
   * `expires_at` để client gia hạn qua GET /attempts/{id}/media. Mọi định dạng nội dung đã xử lý đều phát được (mp3, webp, svg…).
   */
  async mediaUrls(assetIds: string[]): Promise<Map<string, MediaUrl>> {
    const out = new Map<string, MediaUrl>();
    const ids = [...new Set(assetIds.filter(Boolean))];
    if (ids.length === 0) return out;
    // Chỉ phát asset đã xử lý xong (uploading/processing/failed → không trả URL)
    const rows = await this.dbs.db
      .select({ id: catalogMediaAssets.id, kind: catalogMediaAssets.kind, externalUrl: catalogMediaAssets.externalUrl, storageKey: catalogMediaAssets.storageKey, durationMs: catalogMediaAssets.durationMs, metadata: catalogMediaAssets.metadata })
      .from(catalogMediaAssets)
      .where(and(inArray(catalogMediaAssets.id, ids), eq(catalogMediaAssets.status, 'ready')));
    const ttl = this.storage.defaultTtlSec;
    for (const m of rows) {
      let url = m.externalUrl ?? '';
      let expiresAt: string | null = null;
      if (!url && m.storageKey) {
        const bucket = (m.metadata as { bucket?: string } | null)?.bucket === 'recordings' ? 'recordings' : 'media';
        try {
          const issuedAt = Date.now();
          url = await this.storage.presignGet(bucket, m.storageKey, ttl);
          expiresAt = new Date(issuedAt + ttl * 1000).toISOString();
        } catch {
          url = '';
        }
      }
      out.set(m.id, { id: m.id, kind: m.kind, url, duration_ms: m.durationMs ?? null, expires_at: expiresAt });
    }
    return out;
  }

  /**
   * LoadedQuestion → QuestionPublic (không answer_key/explanation/evidence) + media URL.
   * `revealTranscript = false` (mặc định – GET/POST /attempts khi làm bài): passage `audio_script` không trả `body`; Part 1/2 TOEIC
   * xoá chữ đề bài/lựa chọn (được đọc trong audio). Chỉ Review sau khi nộp gọi với `revealTranscript = true`.
   */
  async toPublic(questions: LoadedQuestion[], opts: { revealTranscript?: boolean } = {}): Promise<QuestionPublic[]> {
    const reveal = opts.revealTranscript === true;
    const assetIds: string[] = [];
    for (const q of questions) {
      assetIds.push(...assetIdsOfContent(q.content));
      if (q.passage?.media_asset_id) assetIds.push(q.passage.media_asset_id);
    }
    const urls = await this.mediaUrls(assetIds);
    return questions.map((q) => {
      const media: QuestionPublic['media'] = [];
      const seen = new Set<string>();
      for (const id of assetIdsOfContent(q.content)) {
        const u = urls.get(id);
        if (u && !seen.has(id)) {
          seen.add(id);
          media.push(u);
        }
      }
      const content = toPublicContent(q.content);
      const hideSpoken = !reveal && isSpokenTextSection(q.program_code, q.section_code);
      const passageMedia = q.passage?.media_asset_id ? urls.get(q.passage.media_asset_id) : undefined;
      return {
        question_id: q.question_id,
        question_version_id: q.question_version_id,
        question_type: q.question_type,
        section_code: q.section_code,
        group_key: q.group_key,
        order_no: q.order_no,
        content: hideSpoken ? redactSpokenText(content) : content,
        media,
        passage: q.passage
          ? {
              id: q.passage.id,
              kind: q.passage.kind,
              title: q.passage.title,
              body: q.passage.kind === 'audio_script' && !reveal ? null : q.passage.body,
              media_url: passageMedia?.url ?? null,
              media_asset_id: q.passage.media_asset_id,
              media_expires_at: passageMedia?.expires_at ?? null,
            }
          : null,
      };
    });
  }

  /**
   * Cập nhật thống kê exposure/correct/avg_time_ms sau khi chấm (gọi trong transaction submit). Gộp theo câu, khoá hàng theo
   * thứ tự id (tránh deadlock giữa các lượt nộp đồng thời) rồi cập nhật bằng MỘT câu lệnh (đề 200 câu: 2 truy vấn thay vì 200).
   * Khoá `FOR NO KEY UPDATE` (không phải FOR UPDATE): INSERT attempt_answers trong cùng transaction giữ FOR KEY SHARE trên
   * catalog.questions (kiểm tra FK) – FOR UPDATE xung đột với KEY SHARE của lượt nộp khác → deadlock; NO KEY UPDATE thì không.
   * Gọi ở cuối transaction để giữ khoá hàng "nóng" ngắn nhất. avg_time_ms: trung bình cộng dồn (bigint để không tràn số).
   */
  async bumpQuestionStats(tx: DbOrTx, updates: Array<{ question_id: string; correct: boolean; time_ms: number | null }>): Promise<void> {
    if (updates.length === 0) return;
    const agg = new Map<string, { n: number; correct: number; timeSum: number; timeN: number }>();
    for (const u of updates) {
      const a = agg.get(u.question_id) ?? { n: 0, correct: 0, timeSum: 0, timeN: 0 };
      a.n++;
      if (u.correct) a.correct++;
      if (u.time_ms !== null && u.time_ms >= 0) {
        a.timeSum += u.time_ms;
        a.timeN++;
      }
      agg.set(u.question_id, a);
    }
    const ids = [...agg.keys()].sort();
    await tx.execute(sql`select id from catalog.questions where id = any(${param(ids)}::uuid[]) order by id for no key update`);
    const values = sql.join(
      ids.map((id) => {
        const a = agg.get(id)!;
        return sql`(${id}::uuid, ${a.n}::int, ${a.correct}::int, ${a.timeN ? Math.round(a.timeSum / a.timeN) : null}::bigint)`;
      }),
      sql`, `,
    );
    await tx.execute(sql`
      update catalog.questions q set
        exposure_count = q.exposure_count + v.n,
        correct_count = q.correct_count + v.c,
        avg_time_ms = case when v.t is null then q.avg_time_ms
                           when q.avg_time_ms is null or q.exposure_count = 0 then v.t::int
                           else ((q.avg_time_ms::bigint * q.exposure_count + v.t * v.n) / (q.exposure_count + v.n))::int end
      from (values ${values}) as v(id, n, c, t)
      where q.id = v.id`);
  }

  async requireTestSetPublished(id: string) {
    const row = await this.testSetById(id);
    if (!row || row.ts.status !== 'published') throw new NotFound('test_set', id);
    return row;
  }

  async lessons(program: string) {
    return this.dbs.db.select().from(schema.catalogLessons).where(and(eq(schema.catalogLessons.programCode, program), eq(schema.catalogLessons.status, 'published'))).orderBy(schema.catalogLessons.sortOrder);
  }

  async lessonWithSteps(id: string) {
    const [lesson] = await this.dbs.db.select().from(schema.catalogLessons).where(eq(schema.catalogLessons.id, id)).limit(1);
    if (!lesson) return null;
    const steps = await this.dbs.db.select().from(schema.catalogLessonSteps).where(eq(schema.catalogLessonSteps.lessonId, id)).orderBy(schema.catalogLessonSteps.sortOrder);
    return { lesson, steps };
  }

  async vocabLists(program: string) {
    return this.dbs.db.select().from(schema.catalogVocabLists).where(eq(schema.catalogVocabLists.programCode, program)).orderBy(schema.catalogVocabLists.sortOrder);
  }

  async vocabListItems(listId: string) {
    return this.dbs.db
      .select({ item: schema.catalogVocabItems, sort: schema.catalogVocabListItems.sortOrder })
      .from(schema.catalogVocabListItems)
      .innerJoin(schema.catalogVocabItems, eq(schema.catalogVocabItems.id, schema.catalogVocabListItems.vocabItemId))
      .where(eq(schema.catalogVocabListItems.listId, listId))
      .orderBy(schema.catalogVocabListItems.sortOrder);
  }


}
