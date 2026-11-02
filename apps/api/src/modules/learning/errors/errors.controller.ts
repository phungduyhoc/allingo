import { Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { attemptSchema, errorDrillInputSchema, errorLogEntrySchema, errorLogPageSchema, errorLogQuerySchema, errorPatchSchema, type ErrorDrillInput, type ErrorPatch } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ExamLocked } from '../../../shared/exam/exam-mode.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { ErrorLogService } from './error-log.service.js';

const entryParam = z.object({ entryId: z.uuid() });

/**
 * Sổ lỗi S10: GET /me/errors, PATCH /me/errors/{entryId}, POST /me/errors/drill. Đọc/sửa sổ lỗi lộ đáp án → khoá khi đang
 * thi (Exam Mode – CLAUDE.md §5.8); tạo drill không khoá (giống POST /attempts).
 */
@ApiTags('Learning')
@Controller('me/errors')
export class ErrorsController {
  constructor(private readonly errors: ErrorLogService) {}

  @Get()
  @ExamLocked()
  @ApiZod({ query: errorLogQuerySchema, responses: { 200: errorLogPageSchema } })
  list(@CurrentUser() user: AuthUser, @ZodQuery(errorLogQuerySchema) q: z.infer<typeof errorLogQuerySchema>) {
    return this.errors.list(user.id, q);
  }

  @Post('drill')
  @HttpCode(201)
  @ApiZod({ body: errorDrillInputSchema, responses: { 201: attemptSchema, 400: 'empty', 404: 'empty', 429: 'empty' } })
  drill(@CurrentUser() user: AuthUser, @ZodBody(errorDrillInputSchema) body: ErrorDrillInput) {
    return this.errors.drill(user.id, body);
  }

  @Patch(':entryId')
  @ExamLocked()
  @ApiZod({ body: errorPatchSchema, responses: { 200: errorLogEntrySchema, 400: 'empty', 404: 'empty' } })
  patch(@CurrentUser() user: AuthUser, @ZodParams(entryParam) p: z.infer<typeof entryParam>, @ZodBody(errorPatchSchema) body: ErrorPatch) {
    return this.errors.patch(user.id, p.entryId, body);
  }
}
