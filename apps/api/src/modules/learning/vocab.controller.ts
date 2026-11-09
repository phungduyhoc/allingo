import { Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_PROGRAM,
  dictionaryEntrySchema,
  dictionaryLookupQuerySchema,
  pageSchema,
  programCodeSchema,
  srsCardCreateSchema,
  srsCardListQuerySchema,
  srsCardSchema,
  srsDueListSchema,
  srsDueQuerySchema,
  srsReviewInputSchema,
  vocabEnrollResultSchema,
  vocabItemSchema,
  vocabListItemsQuerySchema,
  vocabListSchema,
  type DictionaryEntry,
  type SrsCardCreate,
  type SrsReviewInput,
} from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ExamLocked } from '../../shared/exam/exam-mode.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { DictionaryService } from '../catalog/index.js';
import { SrsService } from './srs.service.js';

const programQuery = z.object({ program: programCodeSchema.default(DEFAULT_PROGRAM) });
const listParam = z.object({ listId: z.uuid() });

/**
 * Tra từ (tag Catalog) + thẻ SRS/ôn tập FSRS + bộ từ (S6 → S10). Ở learning vì cần learn.srs_cards (catalog tầng 1 không đọc
 * bảng của learning – CLAUDE.md §5.1); GET /vocab/lists* chuyển từ CatalogController sang đây ở S10 (tiến độ theo người học).
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

  // ------------------------------------------------------------------ SRS
  @ApiTags('Learning')
  @Get('me/srs/due')
  @ApiZod({ query: srsDueQuerySchema, responses: { 200: srsDueListSchema, 404: 'empty' } })
  due(@CurrentUser() user: AuthUser, @ZodQuery(srsDueQuerySchema) q: z.infer<typeof srsDueQuerySchema>) {
    return this.srs.due(user.id, q);
  }

  @ApiTags('Learning')
  @Post('me/srs/review')
  @HttpCode(200)
  @ApiZod({ body: srsReviewInputSchema, responses: { 200: z.array(srsCardSchema), 400: 'empty', 404: 'empty', 429: 'empty' } })
  review(@CurrentUser() user: AuthUser, @ZodBody(srsReviewInputSchema) body: SrsReviewInput) {
    return this.srs.review(user.id, body);
  }

  @ApiTags('Learning')
  @Get('me/srs/cards')
  @ApiZod({ query: srsCardListQuerySchema, responses: { 200: pageSchema(srsCardSchema) } })
  cards(@CurrentUser() user: AuthUser, @ZodQuery(srsCardListQuerySchema) q: z.infer<typeof srsCardListQuerySchema>) {
    return this.srs.list(user.id, q);
  }

  /** Thêm thẻ – 201 mới, 200 đã có (idempotent) */
  @ApiTags('Learning')
  @Post('me/srs/cards')
  @HttpCode(201)
  @ApiZod({ body: srsCardCreateSchema, responses: { 200: srsCardSchema, 201: srsCardSchema, 400: 'empty', 404: 'empty' } })
  async addCard(@CurrentUser() user: AuthUser, @ZodBody(srsCardCreateSchema) body: SrsCardCreate, @Res({ passthrough: true }) reply: FastifyReply) {
    const card = await this.srs.addCard(user.id, body);
    if (card.created === false) void reply.status(200);
    return card;
  }

  // ------------------------------------------------------------------ bộ từ
  @ApiTags('Catalog')
  @Get('vocab/lists')
  @ApiZod({ query: programQuery, responses: { 200: z.array(vocabListSchema) } })
  lists(@CurrentUser() user: AuthUser, @ZodQuery(programQuery) q: z.infer<typeof programQuery>) {
    return this.srs.lists(user.id, q.program);
  }

  @ApiTags('Catalog')
  @Get('vocab/lists/:listId/items')
  @ApiZod({ query: vocabListItemsQuerySchema, responses: { 200: pageSchema(vocabItemSchema), 404: 'empty' } })
  items(@CurrentUser() user: AuthUser, @ZodParams(listParam) p: z.infer<typeof listParam>, @ZodQuery(vocabListItemsQuerySchema) q: z.infer<typeof vocabListItemsQuerySchema>) {
    return this.srs.listItems(user.id, p.listId, q);
  }

  @ApiTags('Learning')
  @Post('vocab/lists/:listId/enroll')
  @HttpCode(200)
  @ApiZod({ responses: { 200: vocabEnrollResultSchema, 403: 'empty', 404: 'empty' } })
  enroll(@CurrentUser() user: AuthUser, @ZodParams(listParam) p: z.infer<typeof listParam>) {
    return this.srs.enroll(user.id, p.listId);
  }
}
