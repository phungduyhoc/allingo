import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { answerInputSchema, diagnosticStartInputSchema, diagnosticStepSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody, ZodParams } from '../../../shared/http/zod.js';
import { DiagnosticService } from './diagnostic.service.js';

const attemptParam = z.object({ attemptId: z.uuid() });
/** AttemptAnswerInput; body rỗng `{}` = lấy lại câu đang chờ (không chấm) */
const nextBody = z
  .object({ question_id: z.uuid().optional(), answer: answerInputSchema.optional(), time_spent_ms: z.number().int().min(0).max(3_600_000).optional(), flagged: z.boolean().optional() })
  .refine((v) => (v.question_id === undefined) === (v.answer === undefined), { message: 'question_id and answer go together', path: ['answer'] });

/** Bài chẩn đoán thích ứng v1 (ADR-0031) – tag Learning theo spec */
@ApiTags('Learning')
@Controller('me/diagnostic')
export class DiagnosticController {
  constructor(private readonly diagnostic: DiagnosticService) {}

  /** Bắt đầu (hoặc tiếp tục bài đang làm) – v1.1 */
  @Post()
  @HttpCode(200)
  @ApiZod({ body: diagnosticStartInputSchema, responses: { 200: diagnosticStepSchema, 403: 'empty', 404: 'empty', 429: 'empty' } })
  start(@CurrentUser() user: AuthUser, @ZodBody(diagnosticStartInputSchema) body: z.infer<typeof diagnosticStartInputSchema>) {
    return this.diagnostic.start(user.id, body.program);
  }

  /** Câu đang chờ / kết quả (không chấm) – v1.1, cho tải lại trang */
  @Get(':attemptId/next')
  @ApiZod({ responses: { 200: diagnosticStepSchema, 403: 'empty', 404: 'empty' } })
  peek(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>) {
    return this.diagnostic.step(user.id, p.attemptId);
  }

  /** Gửi câu trả lời câu đang chờ → câu kế tiếp theo luật thích ứng, hoặc kết luận (`done`, `result`) */
  @Post(':attemptId/next')
  @HttpCode(200)
  @ApiZod({ body: nextBody, responses: { 200: diagnosticStepSchema, 400: 'empty', 403: 'empty', 404: 'empty', 409: 'empty' } })
  next(@CurrentUser() user: AuthUser, @ZodParams(attemptParam) p: z.infer<typeof attemptParam>, @ZodBody(nextBody) body: z.infer<typeof nextBody>) {
    return this.diagnostic.step(user.id, p.attemptId, body.question_id && body.answer ? { question_id: body.question_id, answer: body.answer, time_spent_ms: body.time_spent_ms } : undefined);
  }
}
