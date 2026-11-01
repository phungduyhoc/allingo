import { Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { noteCreateSchema, notePutSchema, noteSchema, notesListQuerySchema, noteUpdateSchema, pageSchema } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ExamLocked } from '../../shared/exam/exam-mode.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { NotesService } from './notes.service.js';

const noteParam = z.object({ noteId: z.uuid() });

/** Ghi chú người học (OpenAPI tag Attempts, v1.1 – S6). Ghi (POST/PUT/PATCH/DELETE) bị khoá khi đang thi; đọc thì không. */
@ApiTags('Attempts')
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  @ApiZod({ query: notesListQuerySchema, responses: { 200: pageSchema(noteSchema) } })
  list(@CurrentUser() user: AuthUser, @ZodQuery(notesListQuerySchema) q: z.infer<typeof notesListQuerySchema>) {
    return this.notes.list(user.id, q);
  }

  @Post()
  @HttpCode(201)
  @ExamLocked()
  @ApiZod({ body: noteCreateSchema, responses: { 201: noteSchema, 400: 'empty', 404: 'empty' } })
  create(@CurrentUser() user: AuthUser, @ZodBody(noteCreateSchema) body: z.infer<typeof noteCreateSchema>) {
    return this.notes.create(user.id, body);
  }

  @Put()
  @HttpCode(200)
  @ExamLocked()
  @ApiZod({ body: notePutSchema, responses: { 200: noteSchema } })
  put(@CurrentUser() user: AuthUser, @ZodBody(notePutSchema) body: z.infer<typeof notePutSchema>) {
    return this.notes.upsert(user.id, body);
  }

  @Patch(':noteId')
  @ExamLocked()
  @ApiZod({ body: noteUpdateSchema, responses: { 200: noteSchema, 404: 'empty' } })
  update(@CurrentUser() user: AuthUser, @ZodParams(noteParam) p: z.infer<typeof noteParam>, @ZodBody(noteUpdateSchema) body: z.infer<typeof noteUpdateSchema>) {
    return this.notes.update(user.id, p.noteId, body.body);
  }

  @Delete(':noteId')
  @HttpCode(204)
  @ExamLocked()
  @ApiZod({ responses: { 204: 'empty', 404: 'empty' } })
  async remove(@CurrentUser() user: AuthUser, @ZodParams(noteParam) p: z.infer<typeof noteParam>) {
    await this.notes.remove(user.id, p.noteId);
  }
}
