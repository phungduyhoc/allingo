import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { policiesSchema, type PolicyDocument } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { Public } from '../../../shared/auth/auth.guard.js';
import { ApiZod } from '../../../shared/http/zod.js';

const PENDING_NOTE = 'PLACEHOLDER – nội dung cần luật sư rà soát trước khi mở bán công khai (S12, SPEC-ISSUES S131).';

/**
 * Danh mục văn bản pháp lý có phiên bản (S12): terms/privacy theo POLICY_VERSION (đã ghi đồng ý khi đăng ký), chính sách hoàn
 * tiền (`refund_policy` – loại đồng ý mới), đồng ý xử lý giọng nói (`voice_consent` → loại `voice_processing`, chuẩn bị GĐ2).
 * Nội dung hiển thị nằm ở web (`web_path`); API chỉ phục vụ phiên bản + trạng thái duyệt.
 */
export function policyCatalog(env: Pick<Env, 'POLICY_VERSION' | 'REFUND_POLICY_VERSION' | 'VOICE_CONSENT_VERSION'>) {
  const row = (type: PolicyDocument, version: string, consent: string | null, requires: boolean, vi: string, en: string, path: string) => ({
    type,
    version,
    effective_date: effectiveDate(version),
    consent_type: consent,
    requires_consent: requires,
    status: 'draft_pending_legal_review' as const,
    title: { vi, en },
    web_path: path,
    note: PENDING_NOTE,
  });
  return [
    row('terms', env.POLICY_VERSION, 'terms', true, 'Điều khoản sử dụng', 'Terms of Service', '/legal/terms'),
    row('privacy', env.POLICY_VERSION, 'privacy', true, 'Chính sách quyền riêng tư', 'Privacy Policy', '/legal/privacy'),
    row('refund_policy', env.REFUND_POLICY_VERSION, 'refund_policy', false, 'Chính sách hoàn tiền', 'Refund Policy', '/legal/refund'),
    row('voice_consent', env.VOICE_CONSENT_VERSION, 'voice_processing', true, 'Đồng ý xử lý dữ liệu giọng nói', 'Voice Data Processing Consent', '/legal/voice-consent'),
  ];
}

/** "2026-11" → "2026-11-01"; "2026-11-15" giữ nguyên */
function effectiveDate(version: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(version)) return version;
  if (/^\d{4}-\d{2}$/.test(version)) return `${version}-01`;
  return version;
}

@ApiTags('Me')
@Controller('legal')
export class LegalController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  @Public()
  @Get('policies')
  @ApiZod({ responses: { 200: policiesSchema } })
  list(@Res({ passthrough: true }) reply: FastifyReply) {
    void reply.header('cache-control', 'public, max-age=300');
    return { data: policyCatalog(this.env) };
  }
}
