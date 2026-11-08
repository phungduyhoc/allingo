import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, inArray, param, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { JOB_NAMES } from '@allingo/schemas';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';

const { catalogQuestionVersions } = schema;

/** Thực thể embedding của bộ lọc trùng B2 (văn bản = đoạn văn rút gọn + đề bài – khác `question_version` của S5 chỉ có đề bài) */
export const DEDUP_ENTITY = 'question_dedup';
const PASSAGE_EXCERPT = 400;

export interface DuplicateFlag {
  flagged: boolean;
  method: 'embedding' | 'trigram' | 'in_batch' | null;
  of_question_id: string | null;
  similarity: number | null;
  embedding_similarity: number | null;
  trigram_similarity: number | null;
  similar: Array<{ question_id: string; similarity: number; method: 'embedding' | 'trigram' }>;
  threshold: number;
  trgm_threshold: number;
  embedding_model: string | null;
  embedding_error?: boolean;
  checked_at: string;
}

/**
 * Văn bản so trùng: đoạn văn (≤ 400 ký tự đầu, nếu có) + đề bài; đề bài ngắn (< 12 ký tự – Part 1/2) thêm phương án.
 * Câu cùng passage KHÔNG so với nhau (Part 6 "Question N: Choose…" có đề bài khuôn mẫu giống hệt nhau).
 */
export function dedupKeyText(content: { stem?: string; options?: Array<{ text: string }> }, passageBody?: string | null): string {
  const stem = (content.stem ?? '').replace(/\s+/g, ' ').trim();
  const opts = stem.length >= 12 ? '' : (content.options ?? []).map((o) => o.text).join(' ');
  const passage = (passageBody ?? '').replace(/\s+/g, ' ').trim().slice(0, PASSAGE_EXCERPT);
  return [passage, stem, opts].filter(Boolean).join(' \n ').trim();
}

interface Target {
  question_id: string;
  version_id: string;
  program: string;
  section_id: string;
  passage_id: string | null;
  text: string;
}

/**
 * B2 – lọc trùng bằng embedding (AiGateway → ai.embeddings/pgvector, cosine ≥ AI_DEDUP_COSINE_THRESHOLD), fallback pg_trgm
 * (≥ CONTENT_DEDUP_TRGM_THRESHOLD) khi embedding lỗi/chưa có. Ứng viên: bản head của câu CÙNG chương trình + section chưa bị
 * từ chối/gỡ (kể cả nháp – hai câu nháp trùng nhau cũng bị gắn cờ), trừ chính câu đó và câu cùng passage.
 * Kết quả ghi `question_versions.metadata.duplicate` (cùng dạng cờ của S5 + `similar[]`) → hàng chờ duyệt hiển thị/lọc.
 * Tạo câu qua API/CMS → job `content.dedup` (jobId theo version + băm nội dung, idempotent); nhập Excel/AI soạn đề gọi trực tiếp theo lô.
 */
@Injectable()
export class ContentDedupService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'catalog.dedup' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('content', JOB_NAMES.CONTENT_DEDUP, async (payload) => {
      const ids = Array.isArray(payload.question_version_ids) ? (payload.question_version_ids as string[]) : [];
      const r = await this.checkVersions(ids);
      return { checked: r.size, flagged: [...r.values()].filter((d) => d.flagged).length };
    });
  }

  /** Sau khi tạo/sửa câu (API/CMS): đưa vào job – lỗi hàng đợi không chặn thao tác chính */
  async enqueue(versionIds: string[]): Promise<void> {
    const ids = [...new Set(versionIds)].filter(Boolean);
    if (!ids.length) return;
    try {
      const rows = await this.dbs.db.select({ id: catalogQuestionVersions.id, content: catalogQuestionVersions.content }).from(catalogQuestionVersions).where(inArray(catalogQuestionVersions.id, ids));
      const hash = createHash('sha256').update(JSON.stringify(rows.map((r) => [r.id, r.content]))).digest('hex').slice(0, 12);
      const businessId = `${ids.length === 1 ? ids[0] : createHash('sha256').update(ids.join(',')).digest('hex').slice(0, 32)}-${hash}`;
      const d = await this.jobs.dispatch('content', JOB_NAMES.CONTENT_DEDUP, businessId, { question_version_ids: ids });
      d.done?.catch((err: unknown) => this.logger.warn({ err: (err as Error).message }, 'content.dedup failed'));
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'content.dedup enqueue failed');
    }
  }

  private async loadTargets(versionIds: string[]): Promise<Target[]> {
    if (!versionIds.length) return [];
    const rows = await this.dbs.db.execute<{ question_id: string; version_id: string; program: string; section_id: string; passage_id: string | null; content: Record<string, unknown>; passage_body: string | null }>(sql`
      select q.id as question_id, v.id as version_id, q.program_code as program, q.section_id, q.passage_id, v.content, p.body as passage_body
        from catalog.question_versions v
        join catalog.questions q on q.id = v.question_id
        left join catalog.passages p on p.id = q.passage_id
       where v.id = any(${param(versionIds)}::uuid[])`);
    return [...rows].map((r) => ({ question_id: r.question_id, version_id: r.version_id, program: r.program, section_id: r.section_id, passage_id: r.passage_id, text: dedupKeyText(r.content as { stem?: string }, r.passage_body) }));
  }

  /** Bản head của câu cùng chương trình + section (chưa rejected/retired) */
  private async candidates(program: string, sectionId: string): Promise<Array<{ question_id: string; version_id: string; passage_id: string | null; text: string }>> {
    const rows = await this.dbs.db.execute<{ question_id: string; version_id: string; passage_id: string | null; content: Record<string, unknown>; passage_body: string | null }>(sql`
      select q.id as question_id, h.id as version_id, q.passage_id, h.content, p.body as passage_body
        from catalog.questions q
        join lateral (select v.id, v.content from catalog.question_versions v where v.question_id = q.id order by v.version_no desc limit 1) h on true
        left join catalog.passages p on p.id = q.passage_id
       where q.program_code = ${program} and q.section_id = ${sectionId} and q.status not in ('rejected', 'retired')`);
    return [...rows].map((r) => ({ question_id: r.question_id, version_id: r.version_id, passage_id: r.passage_id, text: dedupKeyText(r.content as { stem?: string }, r.passage_body) })).filter((r) => r.text.length > 0);
  }

  /**
   * Chấm độ giống cho các văn bản cùng chương trình + section (không ghi DB) – dùng cho dry-run nhập Excel và cho checkVersions.
   * `vectors` truyền sẵn (đã embed) hoặc tự embed; embedding lỗi → chỉ pg_trgm (`embedding_error`).
   */
  async score(program: string, sectionId: string, items: Array<{ text: string; exclude_question_ids?: string[]; passage_id?: string | null }>, opts: { vectors?: number[][] | null; extraExclude?: string[] } = {}): Promise<DuplicateFlag[]> {
    const threshold = this.env.AI_DEDUP_COSINE_THRESHOLD;
    const trgm = this.env.CONTENT_DEDUP_TRGM_THRESHOLD;
    const limit = this.env.CONTENT_DEDUP_SIMILAR_LIMIT;
    const emb = this.gateway.embeddings;
    const bank = await this.candidates(program, sectionId);
    let vectors: number[][] | null = opts.vectors ?? null;
    try {
      await emb.ensure(DEDUP_ENTITY, bank.map((b) => ({ id: b.version_id, text: b.text })));
      if (!vectors) vectors = await emb.embed(items.map((t) => t.text || ' '));
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'dedup embedding unavailable → pg_trgm fallback');
      vectors = null;
    }
    const out: DuplicateFlag[] = [];
    for (let k = 0; k < items.length; k++) {
      const t = items[k]!;
      const exclude = new Set([...(t.exclude_question_ids ?? []), ...(opts.extraExclude ?? [])]);
      const pool = bank.filter((b) => !exclude.has(b.question_id) && !(t.passage_id && b.passage_id === t.passage_id));
      const byVersion = new Map(pool.map((b) => [b.version_id, b.question_id]));
      const similar: DuplicateFlag['similar'] = [];
      let bestEmb: { question_id: string; similarity: number } | null = null;
      if (vectors && pool.length && t.text) {
        const near = await emb.nearest(DEDUP_ENTITY, vectors[k]!, { limit, candidateIds: pool.map((b) => b.version_id) });
        for (const n of near) {
          const qid = byVersion.get(n.entity_id);
          if (!qid) continue;
          similar.push({ question_id: qid, similarity: n.similarity, method: 'embedding' });
          if (!bestEmb || n.similarity > bestEmb.similarity) bestEmb = { question_id: qid, similarity: n.similarity };
        }
      }
      let bestTri: { question_id: string; similarity: number } | null = null;
      if (pool.length && t.text) {
        const tri = await this.dbs.db.execute<{ question_id: string; sim: number }>(sql`
          select x.question_id, similarity(x.t, ${t.text}) as sim
            from unnest(${param(pool.map((b) => b.question_id))}::uuid[], ${param(pool.map((b) => b.text))}::text[]) as x(question_id, t)
           where x.t % ${t.text}
           order by sim desc
           limit ${limit}`);
        for (const r of tri) {
          const sim = Math.round(Number(r.sim) * 1000) / 1000;
          if (!bestTri || sim > bestTri.similarity) bestTri = { question_id: r.question_id, similarity: sim };
          if (!similar.some((x) => x.question_id === r.question_id)) similar.push({ question_id: r.question_id, similarity: sim, method: 'trigram' });
        }
      }
      similar.sort((a, b) => b.similarity - a.similarity);
      const flag: DuplicateFlag = {
        flagged: false,
        method: null,
        of_question_id: null,
        similarity: null,
        embedding_similarity: bestEmb?.similarity ?? null,
        trigram_similarity: bestTri?.similarity ?? null,
        similar: similar.slice(0, limit),
        threshold,
        trgm_threshold: trgm,
        embedding_model: vectors ? emb.model : null,
        ...(vectors ? {} : { embedding_error: true }),
        checked_at: new Date().toISOString(),
      };
      if (bestEmb && bestEmb.similarity >= threshold) Object.assign(flag, { flagged: true, method: 'embedding', of_question_id: bestEmb.question_id, similarity: bestEmb.similarity });
      else if (bestTri && bestTri.similarity >= trgm) Object.assign(flag, { flagged: true, method: 'trigram', of_question_id: bestTri.question_id, similarity: bestTri.similarity });
      out.push(flag);
    }
    return out;
  }

  /**
   * Kiểm tra trùng cho các phiên bản (một lô): ghi cờ vào metadata (+ embedding của phiên bản), trả cờ theo version id.
   * `extraExclude`: question id không coi là ứng viên (vd. các câu cùng lô nhập đã được kiểm trùng trong tệp).
   */
  async checkVersions(versionIds: string[], opts: { extraExclude?: string[] } = {}): Promise<Map<string, DuplicateFlag>> {
    const out = new Map<string, DuplicateFlag>();
    const targets = (await this.loadTargets([...new Set(versionIds)])).filter((t) => t.text.length > 0);
    if (!targets.length) return out;
    const emb = this.gateway.embeddings;
    const groups = new Map<string, Target[]>();
    for (const t of targets) groups.set(`${t.program}|${t.section_id}`, [...(groups.get(`${t.program}|${t.section_id}`) ?? []), t]);
    for (const list of groups.values()) {
      const first = list[0]!;
      let vectors: number[][] | null = null;
      try {
        await emb.upsert(DEDUP_ENTITY, list.map((t) => ({ id: t.version_id, text: t.text })));
        vectors = await emb.embed(list.map((t) => t.text));
      } catch (err) {
        this.logger.warn({ err: (err as Error).message }, 'dedup embedding unavailable → pg_trgm fallback');
      }
      const flags = await this.score(
        first.program,
        first.section_id,
        list.map((t) => ({ text: t.text, exclude_question_ids: [t.question_id], passage_id: t.passage_id })),
        { vectors: vectors ?? undefined, extraExclude: opts.extraExclude },
      );
      for (let k = 0; k < list.length; k++) {
        const t = list[k]!;
        const flag = flags[k]!;
        await this.dbs.db
          .update(catalogQuestionVersions)
          .set({ metadata: sql`${catalogQuestionVersions.metadata} || ${JSON.stringify({ duplicate: flag })}::jsonb` })
          .where(eq(catalogQuestionVersions.id, t.version_id));
        out.set(t.version_id, flag);
      }
    }
    return out;
  }
}
