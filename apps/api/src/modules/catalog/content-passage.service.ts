import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import { programCodeSchema } from '@allingo/schemas';
import { DbService, type DbOrTx } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { CatalogQueryService } from './catalog-query.service.js';

const { catalogPassages, catalogPassageParts, catalogTopics } = schema;

export const PASSAGE_KINDS = ['reading_passage', 'audio_script', 'image_prompt', 'chart_prompt', 'dialogue'] as const;

export const passagePartInputSchema = z.object({ title: z.string().trim().max(200).nullish(), body: z.string().min(1).max(20_000) });

/** CMS → catalog (B5): passage + văn bản từng phần; id catalog = id passage CMS (uuid) → idempotent theo id */
export const syncPassageSchema = z.object({
  passage_id: z.uuid(),
  program: programCodeSchema,
  kind: z.enum(PASSAGE_KINDS),
  title: z.string().max(300).nullish(),
  body: z.string().max(40_000).nullish(),
  difficulty: z.string().max(10).nullish(),
  topic_code: z.string().max(64).nullish(),
  /** draft | ready | retired (trạng thái CMS) */
  status: z.enum(['draft', 'ready', 'retired']).default('draft'),
  parts: z.array(passagePartInputSchema).max(5).default([]),
});
export type SyncPassageInput = z.infer<typeof syncPassageSchema>;

const STATUS_OF = { draft: 'draft', ready: 'published', retired: 'retired' } as const;
const DIFFICULTIES = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const wordCountOf = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Bản gộp `[Tiêu đề]\n…` (dự phòng passages.body cho client cũ/AI giải thích) – cùng quy ước seed (mergeGroupPassages) */
export function mergePartsBody(parts: ReadonlyArray<{ title?: string | null; body: string }>): string {
  return parts.map((p, i) => `[${(p.title ?? '').trim() || `Text ${i + 1}`}]\n${p.body.trim()}`).join('\n\n');
}

/**
 * Passage + văn bản từng phần (B5/S24). `passages.body` luôn là bản gộp khi có ≥ 2 part (client cũ/AI giải thích vẫn đọc được);
 * thay part = xoá rồi ghi lại theo thứ tự (sort_order 1…n). Dùng cho đồng bộ CMS, nhập Excel và AI soạn đề nháp.
 */
@Injectable()
export class ContentPassageService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly catalog: CatalogQueryService,
  ) {}

  /** Ghi lại toàn bộ part của passage (trong transaction của nơi gọi) */
  async replaceParts(tx: DbOrTx, passageId: string, parts: ReadonlyArray<{ title?: string | null; body: string; media_asset_id?: string | null }>): Promise<number> {
    await tx.delete(catalogPassageParts).where(eq(catalogPassageParts.passageId, passageId));
    const clean = parts.filter((p) => p.body.trim().length > 0);
    if (clean.length < 2) return 0;
    await tx.insert(catalogPassageParts).values(clean.map((p, i) => ({ passageId, sortOrder: i + 1, title: p.title?.trim() || null, body: p.body.trim(), mediaAssetId: p.media_asset_id ?? null })));
    return clean.length;
  }

  /** Tạo passage mới (nhập Excel / AI soạn đề) – ≥ 2 part → body gộp + passage_parts */
  async create(
    tx: DbOrTx,
    input: { program: string; kind: (typeof PASSAGE_KINDS)[number]; title: string | null; body: string | null; parts?: ReadonlyArray<{ title?: string | null; body: string }>; source: 'human' | 'ai' | 'licensed'; difficulty?: string | null; topicId?: string | null; createdBy: string | null },
  ): Promise<string> {
    const parts = (input.parts ?? []).filter((p) => p.body.trim());
    const body = parts.length >= 2 ? mergePartsBody(parts) : (input.body ?? parts[0]?.body ?? null);
    const [row] = await tx
      .insert(catalogPassages)
      .values({
        programCode: input.program,
        kind: input.kind,
        title: input.title,
        body,
        wordCount: body ? wordCountOf(body) : null,
        difficulty: input.difficulty && DIFFICULTIES.has(input.difficulty) ? (input.difficulty as never) : null,
        topicId: input.topicId ?? null,
        source: input.source,
        status: 'draft',
        createdBy: input.createdBy,
      })
      .returning({ id: catalogPassages.id });
    if (parts.length >= 2) await this.replaceParts(tx, row!.id, parts);
    return row!.id;
  }

  /** POST /internal/content/passages/sync (CMS mỗi lần lưu passage) */
  async syncFromCms(input: SyncPassageInput): Promise<{ passage_id: string; parts: number; status: string }> {
    const status = STATUS_OF[input.status];
    const parts = input.parts.filter((p) => p.body.trim());
    const body = parts.length >= 2 ? mergePartsBody(parts) : (input.body ?? parts[0]?.body ?? null);
    const result = await this.dbs.db.transaction(async (tx) => {
      const topic = input.topic_code ? (await tx.select({ id: catalogTopics.id }).from(catalogTopics).where(eq(catalogTopics.code, input.topic_code)).limit(1))[0] : undefined;
      const values = {
        programCode: input.program,
        kind: input.kind,
        title: input.title ?? null,
        body,
        wordCount: body ? wordCountOf(body) : null,
        difficulty: input.difficulty && DIFFICULTIES.has(input.difficulty) ? (input.difficulty as never) : null,
        topicId: topic?.id ?? null,
        status,
      };
      await tx
        .insert(catalogPassages)
        .values({ id: input.passage_id, ...values, source: 'human' })
        .onConflictDoUpdate({ target: catalogPassages.id, set: { ...values, updatedAt: sql`now()` } });
      const n = await this.replaceParts(tx, input.passage_id, parts);
      await this.audit.log({ action: 'content.passage_synced', entityType: 'passage', entityId: input.passage_id, after: { parts: n, status } }, tx);
      return { passage_id: input.passage_id, parts: n, status };
    });
    // Câu đang cache (Review/attempt) đọc lại passage + part mới
    this.catalog.invalidateVersionCache();
    return result;
  }
}
