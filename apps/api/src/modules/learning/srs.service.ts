import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { type SrsCard, type SrsCardCreate } from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { FeatureGateService } from '../billing/index.js';
import { DictionaryService } from '../catalog/index.js';
import { UsersService } from '../iam/index.js';

const { learnSrsCards } = schema;
type CardRow = typeof learnSrsCards.$inferSelect;

/**
 * Thẻ SRS (S6 – "Thêm vào từ vựng của tôi"): chỉ `vocab`; thẻ mới `state = new`, `due_at = now` (lịch FSRS ở S10).
 * Idempotent theo UNIQUE (user, card_type, ref_id): thêm lại → trả thẻ cũ (`created: false`), không tiêu quota.
 * Thẻ mới tiêu quota `srs_new_cards` (billing.quotas – Free/Pro theo seed).
 */
@Injectable()
export class SrsService {
  constructor(
    private readonly dbs: DbService,
    private readonly dictionary: DictionaryService,
    private readonly gate: FeatureGateService,
    private readonly users: UsersService,
  ) {}

  toDto(r: CardRow, payload: Record<string, unknown>, created?: boolean): SrsCard {
    return {
      id: r.id,
      card_type: r.cardType,
      ref_id: r.refId,
      state: r.state,
      due_at: r.dueAt.toISOString(),
      stability: r.stability ?? null,
      difficulty: r.difficulty ?? null,
      reps: r.reps,
      lapses: r.lapses,
      payload,
      ...(created === undefined ? {} : { created }),
    };
  }

  async addCard(userId: string, input: SrsCardCreate): Promise<SrsCard> {
    if (input.card_type !== 'vocab') throw new ValidationFailed({ issues: [{ path: 'card_type', message: 'only vocab cards are supported in this version (others: Sprint 10)' }] });
    const user = await this.users.findById(userId);
    const locale = user?.explainLocale ?? 'vi';
    const item = await this.dictionary.resolveVocabItem(input.program, { id: input.ref_id, headword: input.headword, locale, context: input.context ?? null });
    if (!item) throw new NotFound('vocab_item', input.ref_id ?? input.headword);
    if (item.programCode !== input.program) throw new ValidationFailed({ issues: [{ path: 'program', message: 'vocab item belongs to another program' }] });
    const payload = DictionaryService.cardPayload(item, locale, input.context ?? null);

    const [existing] = await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, 'vocab'), eq(learnSrsCards.refId, item.id))).limit(1);
    if (existing) return this.toDto(existing, payload, false);

    // Gating S7 (FEATURE_GATES.srs_new_cards)
    const ticket = await this.gate.consume(userId, input.program, 'srs_new_cards');
    try {
      const [row] = await this.dbs.db
        .insert(learnSrsCards)
        .values({ userId, programCode: input.program, cardType: 'vocab', refId: item.id, sourceType: input.source_type ?? 'dictionary', sourceId: input.source_id ?? null, state: 'new', dueAt: new Date() })
        .onConflictDoNothing()
        .returning();
      if (row) return this.toDto(row, payload, true);
      // Đua: request song song vừa tạo → trả thẻ đó, hoàn quota
      await ticket.release();
      const [again] = await this.dbs.db.select().from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, 'vocab'), eq(learnSrsCards.refId, item.id))).limit(1);
      return this.toDto(again!, payload, false);
    } catch (err) {
      await ticket.release();
      throw err;
    }
  }

  /** Thẻ vocab của người dùng theo vocab_item_id (DictionaryEntry.saved / srs_card_id) */
  async vocabCardsFor(userId: string, vocabItemIds: string[]): Promise<Map<string, string>> {
    if (!vocabItemIds.length) return new Map();
    const rows = await this.dbs.db.select({ id: learnSrsCards.id, refId: learnSrsCards.refId }).from(learnSrsCards).where(and(eq(learnSrsCards.userId, userId), eq(learnSrsCards.cardType, 'vocab'), inArray(learnSrsCards.refId, vocabItemIds)));
    return new Map(rows.map((r) => [r.refId, r.id]));
  }
}
