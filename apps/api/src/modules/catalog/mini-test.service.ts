import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@allingo/db';
import {
  DEFAULT_PROGRAM,
  DOMAIN_EVENTS,
  MINI_SEED_MAX,
  TOEIC_MINI_BLUEPRINT_60,
  fnv1a32,
  generateMiniTest,
  localizedTextSchema,
  miniBlueprintSchema,
  programCodeSchema,
  validateTestSetStructure,
  type MiniBlueprint,
  type MiniShortfall,
  type StructureReport,
} from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { OutboxService } from '../../shared/events/outbox.service.js';
import { ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { CatalogQueryService } from './catalog-query.service.js';

const { catalogSections, catalogSkills, catalogTestSets, catalogTestSetItems, catalogTestSetSections } = schema;

/** POST /admin/test-sets/generate (v1.1 – Sprint 4) */
export const generateTestSetInputSchema = z.object({
  program: programCodeSchema.default(DEFAULT_PROGRAM),
  /** Bỏ trống → seed ngẫu nhiên (trả lại trong phản hồi để tạo lại đúng đề) */
  seed: z.number().int().min(0).max(MINI_SEED_MAX).optional(),
  /** Bỏ trống → blueprint mặc định của chương trình (TOEIC: 60 câu L&R) */
  blueprint: miniBlueprintSchema.optional(),
  /** Mã đề; mặc định `<program>-mini-gen-<seed>` (blueprint tuỳ chỉnh thêm hậu tố băm) – cùng mã → cập nhật đề cũ (idempotent) */
  code: z.string().regex(/^[a-z0-9][a-z0-9_-]{2,63}$/).optional(),
  title: localizedTextSchema.optional(),
  is_free: z.boolean().default(true),
  /** false → lưu `draft` (không hiện cho người học) */
  publish: z.boolean().default(true),
  /** Bỏ trống → ước tính theo tỷ lệ TOEIC (Listening 27 s/câu ≈ 45′/100, Reading 45 s/câu ≈ 75′/100) */
  duration_sec: z.number().int().min(60).max(4 * 3600).optional(),
});
export type GenerateTestSetInput = z.infer<typeof generateTestSetInputSchema>;

export const generateTestSetResultSchema = z.object({
  test_set_id: z.uuid(),
  code: z.string(),
  status: z.enum(['draft', 'published']),
  seed: z.number().int(),
  blueprint: miniBlueprintSchema,
  bank_fingerprint: z.string(),
  question_count: z.number().int(),
  duration_sec: z.number().int(),
  by_section: z.record(z.string(), z.number().int()),
  shortfall: z.array(z.object({ section_code: z.string(), requested: z.number().int(), selected: z.number().int(), reason: z.string() })),
  structure: z.object({ ok: z.boolean(), total: z.number().int(), by_section: z.record(z.string(), z.number().int()), issues: z.array(z.record(z.string(), z.unknown())) }),
});
export type GenerateTestSetResult = z.infer<typeof generateTestSetResultSchema>;

const DEFAULT_BLUEPRINTS: Partial<Record<string, MiniBlueprint>> = { toeic: TOEIC_MINI_BLUEPRINT_60 };
/** Giây/câu ước tính khi không chỉ định duration_sec */
const SEC_PER_QUESTION: Record<string, number> = { listening: 27, reading: 45 };

/**
 * Sinh đề mini từ ngân hàng câu đã phát hành (Sprint 4). Hàm thuần `generateMiniTest` (packages/schemas, PRNG mulberry32) chọn câu;
 * service kiểm tra cấu trúc bằng `validateTestSetStructure('mini', …)` rồi ghi `catalog.test_sets kind = mini` + sections + items
 * trong một transaction. Seed/blueprint/vân tay ngân hàng lưu ở `catalog.test_sets.metadata` (B5 – SPEC-ISSUES S30 đã xử lý) và vẫn
 * ghi `ops.audit_logs` (action `test_set.generated`); seed vẫn nằm trong mã đề `toeic-mini-gen-<seed>`.
 */
@Injectable()
export class MiniTestService {
  private readonly logger = getLogger({ component: 'catalog.mini-test' });

  constructor(
    private readonly dbs: DbService,
    private readonly catalog: CatalogQueryService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async generate(input: GenerateTestSetInput, actor: { id: string | null; roles: string[] }, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<GenerateTestSetResult> {
    const blueprint = input.blueprint ?? DEFAULT_BLUEPRINTS[input.program];
    if (!blueprint) throw new ValidationFailed({ issues: [{ path: 'blueprint', message: `no default blueprint for program ${input.program}` }] });
    const sections = await this.dbs.db
      .select({ id: catalogSections.id, code: catalogSections.code, skill: catalogSkills.code, questionCount: catalogSections.questionCount, sortOrder: catalogSections.sortOrder })
      .from(catalogSections)
      .innerJoin(catalogSkills, eq(catalogSkills.id, catalogSections.skillId))
      .where(eq(catalogSections.programCode, input.program));
    const byCode = new Map(sections.map((s) => [s.code, s]));
    const issues: Array<{ path: string; message: string }> = [];
    for (const [i, sec] of blueprint.sections.entries()) {
      const spec = byCode.get(sec.section_code);
      if (!spec) issues.push({ path: `blueprint.sections.${i}.section_code`, message: `unknown section ${sec.section_code}` });
      else if (spec.questionCount !== null && sec.count > spec.questionCount) issues.push({ path: `blueprint.sections.${i}.count`, message: `${sec.section_code} allows at most ${spec.questionCount} questions` });
    }
    if (issues.length) throw new ValidationFailed({ issues });

    const seed = input.seed ?? randomInt(1, MINI_SEED_MAX);
    const bank = await this.catalog.publishedBank(input.program, blueprint.sections.map((s) => s.section_code));
    const gen = generateMiniTest(bank, blueprint, seed);
    if (gen.items.length === 0) throw new ValidationFailed({ issues: [{ path: 'blueprint', message: 'no published questions for the blueprint sections' }], shortfall: gen.shortfall });
    const structure: StructureReport = validateTestSetStructure(
      'mini',
      sections.map((s) => ({ code: s.code, skill: s.skill, question_count: s.questionCount ?? null, sort_order: s.sortOrder })),
      gen.items.map((it) => ({ question_ref: it.question_id, section_code: it.section_code, sort_order: it.sort_order, group_key: it.group_key })),
    );
    if (!structure.ok) throw new ValidationFailed({ issues: structure.issues.map((i) => ({ path: `items${i.section ? `.${i.section}` : ''}`, message: i.message, code: i.code })), structure });

    const isDefault = blueprint === DEFAULT_BLUEPRINTS[input.program];
    const code = input.code ?? `${input.program}-mini-gen-${seed}${isDefault ? '' : `-${fnv1a32(JSON.stringify(blueprint)).slice(0, 6)}`}`;
    const durationSec =
      input.duration_sec ??
      Math.ceil(gen.items.reduce((sum, it) => sum + (SEC_PER_QUESTION[byCode.get(it.section_code)?.skill ?? ''] ?? 60), 0) / 60) * 60;
    const title = input.title ?? { vi: `Đề mini ${input.program.toUpperCase()} #${seed} (sinh tự động, ${gen.items.length} câu)`, en: `${input.program.toUpperCase()} mini test #${seed} (generated, ${gen.items.length} questions)` };
    const status = input.publish ? ('published' as const) : ('draft' as const);
    const presentSections = blueprint.sections.map((s) => s.section_code).filter((c, i, arr) => arr.indexOf(c) === i && (gen.by_section[c] ?? 0) > 0);

    // S30 (B5): seed/blueprint/vân tay ngân hàng lưu ở catalog.test_sets.metadata (vẫn ghi audit log)
    const metadata = { source: 'mini_generator', seed, blueprint, bank_fingerprint: gen.bank_fingerprint, by_section: gen.by_section, shortfall: gen.shortfall, generated_at: new Date().toISOString() };
    const testSetId = await this.dbs.db.transaction(async (tx) => {
      const [ts] = await tx
        .insert(catalogTestSets)
        .values({ programCode: input.program, code, title, kind: 'mini', isFree: input.is_free, durationSec, status, publishedAt: input.publish ? new Date() : null, metadata })
        .onConflictDoUpdate({ target: [catalogTestSets.programCode, catalogTestSets.code], set: { title, kind: 'mini', isFree: input.is_free, durationSec, status, publishedAt: input.publish ? new Date() : null, metadata } })
        .returning({ id: catalogTestSets.id });
      const id = ts!.id;
      await tx.delete(catalogTestSetSections).where(eq(catalogTestSetSections.testSetId, id));
      // Đồng hồ chung cho cả đề (duration_sec của section = NULL), như đề Reading full (A33)
      await tx.insert(catalogTestSetSections).values(presentSections.map((c, i) => ({ testSetId: id, sectionId: byCode.get(c)!.id, sortOrder: i + 1, durationSec: null })));
      await tx.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, id));
      await tx.insert(catalogTestSetItems).values(gen.items.map((it) => ({ testSetId: id, questionId: it.question_id, sectionId: byCode.get(it.section_code)!.id, sortOrder: it.sort_order, groupKey: it.group_key, points: '1' })));
      await this.audit.log(
        {
          action: 'test_set.generated',
          actorUserId: actor.id,
          actorRole: actor.roles.join(',') || null,
          entityType: 'test_set',
          entityId: id,
          after: { code, seed, blueprint, bank_fingerprint: gen.bank_fingerprint, by_section: gen.by_section, shortfall: gen.shortfall, status },
          ip: meta.ip ?? null,
          userAgent: meta.userAgent ?? null,
        },
        tx,
      );
      if (input.publish) await this.outbox.write(tx, { aggregateType: 'test_set', aggregateId: id, eventType: DOMAIN_EVENTS.CONTENT_PUBLISHED, payload: { entity: 'test_set', test_set_id: id, program: input.program, code } });
      return id;
    });
    this.logger.info({ test_set_id: testSetId, code, seed, questions: gen.items.length, shortfall: gen.shortfall.length }, 'mini test generated');
    return {
      test_set_id: testSetId,
      code,
      status,
      seed,
      blueprint,
      bank_fingerprint: gen.bank_fingerprint,
      question_count: gen.items.length,
      duration_sec: durationSec,
      by_section: gen.by_section,
      shortfall: gen.shortfall satisfies MiniShortfall[],
      structure: { ok: structure.ok, total: structure.total, by_section: structure.by_section, issues: structure.issues as unknown as Array<Record<string, unknown>> },
    };
  }
}
