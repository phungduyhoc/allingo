import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { dictionaryEntrySchema, dictionaryLookupQuerySchema, srsCardCreateSchema, srsCardSchema, type DictionaryEntry, type SrsCardCreate } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ExamLocked } from '../../shared/exam/exam-mode.js';
import { ApiZod, ZodBody, ZodQuery } from '../../shared/http/zod.js';
import { DictionaryService } from '../catalog/index.js';
import { SrsService } from './srs.service.js';

/**
 * Tra từ (tag Catalog) + thẻ SRS (tag Learning) – S6. Controller ở learning vì DictionaryEntry.saved cần learn.srs_cards
 * (catalog tầng 1 không đọc bảng của learning – CLAUDE.md §5.1).
 */
@Controller()
export class VocabController {
  constructor(
    private readonly dictionary: DictionaryService,
    private readonly srs: SrsService,
  ) {}

  /** Đang thi → 403 exam_mode_locked cho MỌI lần tra (A73) */
  @ApiTags('Catalog')
  @Get('dictionary/lookup')
  @ExamLocked()
  @ApiZod({ query: dictionaryLookupQuerySchema, responses: { 200: dictionaryEntrySchema, 400: 'empty', 429: 'empty' } })
  async lookup(@CurrentUser() user: AuthUser, @ZodQuery(dictionaryLookupQuerySchema) q: z.infer<typeof dictionaryLookupQuerySchema>): Promise<DictionaryEntry> {
    const r = await this.dictionary.lookup({ userId: user.id, query: (q.q ?? q.term)!, program: q.program, context: q.context ?? null, locale: q.locale ?? null, ai: q.ai });
    const cards = r.vocab_item_id ? await this.srs.vocabCardsFor(user.id, [r.vocab_item_id]) : new Map<string, string>();
    const cardId = r.vocab_item_id ? (cards.get(r.vocab_item_id) ?? null) : null;
    return { ...r, saved: !!cardId, srs_card_id: cardId };
  }

  /** Thêm thẻ (vocab) – 201 mới, 200 đã có (idempotent) */
  @ApiTags('Learning')
  @Post('me/srs/cards')
  @HttpCode(201)
  @ApiZod({ body: srsCardCreateSchema, responses: { 200: srsCardSchema, 201: srsCardSchema, 400: 'empty', 404: 'empty', 429: 'empty' } })
  async addCard(@CurrentUser() user: AuthUser, @ZodBody(srsCardCreateSchema) body: SrsCardCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    const card = await this.srs.addCard(user.id, body);
    if (card.created === false) void reply.status(200);
    return card;
  }
}
