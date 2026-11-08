import { Controller, Get, HttpCode, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CONTENT_REPORT_STATUSES, contentReportCreatedSchema, contentReportInputSchema, contentReportItemSchema, contentReportStatusInputSchema, pageSchema } from '@allingo/schemas';
import { CurrentUser, Public, Roles, type AuthUser } from '../../shared/auth/auth.guard.js';
import { RateLimit } from '../../shared/http/rate-limit.js';
import { ApiZod, ZodBody, ZodParams, ZodQuery } from '../../shared/http/zod.js';
import { ContentReportsService } from './content-reports.service.js';
import { InternalTokenGuardFactory } from './internal-content.controller.js';

const reportParam = z.object({ reportId: z.uuid() });
const idParam = z.object({ id: z.uuid() });
const boolish = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().optional());
const listQuery = z.object({
  status: z.enum(CONTENT_REPORT_STATUSES).optional(),
  overdue: boolish,
  question_id: z.uuid().optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const syncQuery = z.object({
  updated_since: z.iso.datetime({ offset: true }).default('1970-01-01T00:00:00Z'),
  status: z.enum(CONTENT_REPORT_STATUSES).optional(),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

/** Báo lỗi câu hỏi (S12): người học tạo; admin/giáo viên/biên tập xử lý (cùng dữ liệu với hàng đợi CMS) */
@ApiTags('Catalog')
@Controller()
export class ContentReportsController {
  constructor(private readonly reports: ContentReportsService) {}

  @Post('content-reports')
  @HttpCode(201)
  @RateLimit('feedback')
  @ApiZod({ body: contentReportInputSchema, responses: { 201: contentReportCreatedSchema, 404: 'empty' } })
  create(@CurrentUser() user: AuthUser, @ZodBody(contentReportInputSchema) body: z.infer<typeof contentReportInputSchema>) {
    return this.reports.create(user.id, body);
  }

  @Get('admin/content/reports')
  @Roles('admin', 'superadmin', 'teacher', 'editor')
  @ApiTags('Admin')
  @ApiZod({ query: listQuery, responses: { 200: pageSchema(contentReportItemSchema) } })
  list(@ZodQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.reports.list(q);
  }

  @Patch('admin/content/reports/:reportId')
  @Roles('admin', 'superadmin', 'teacher', 'editor')
  @ApiTags('Admin')
  @ApiZod({ body: contentReportStatusInputSchema, responses: { 200: contentReportItemSchema, 404: 'empty' } })
  setStatus(@CurrentUser() user: AuthUser, @ZodParams(reportParam) p: z.infer<typeof reportParam>, @ZodBody(contentReportStatusInputSchema) body: z.infer<typeof contentReportStatusInputSchema>) {
    return this.reports.setStatus(p.reportId, { status: body.status, resolution_note: body.resolution_note }, { id: user.id, roles: user.roles, via: 'admin' });
  }
}

/** API nội bộ cho CMS (X-Internal-Token): kéo báo cáo theo updated_at (đồng bộ collection content-reports) + đổi trạng thái */
@ApiExcludeController()
@Controller('internal/content-reports')
@Public()
@UseGuards(InternalTokenGuardFactory)
export class InternalContentReportsController {
  constructor(private readonly reports: ContentReportsService) {}

  @Get()
  sync(@ZodQuery(syncQuery) q: z.infer<typeof syncQuery>) {
    return this.reports.list({ updated_since: q.updated_since, status: q.status, cursor: q.cursor, limit: q.limit });
  }

  @Post(':id/status')
  @HttpCode(200)
  setStatus(@ZodParams(idParam) p: z.infer<typeof idParam>, @ZodBody(contentReportStatusInputSchema) body: z.infer<typeof contentReportStatusInputSchema>) {
    return this.reports.setStatus(p.id, body, { id: null, roles: [], via: 'cms' });
  }
}
