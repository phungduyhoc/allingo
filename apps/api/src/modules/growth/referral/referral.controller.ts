import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { referralLandingSchema, referralSummarySchema } from '@allingo/schemas';
import { CurrentUser, Public, type AuthUser } from '../../../shared/auth/auth.guard.js';
import { ApiZod, ZodParams, ZodQuery } from '../../../shared/http/zod.js';
import { ReferralService } from './referral.service.js';

const codeParam = z.object({ code: z.string().trim().min(4).max(16).regex(/^[A-Za-z0-9]+$/) });
const utmQuery = z.object({ utm_source: z.string().max(100).optional(), utm_medium: z.string().max(100).optional(), utm_campaign: z.string().max(100).optional(), utm_content: z.string().max(100).optional(), utm_term: z.string().max(100).optional() });

/** Referral (S8): mã/link/thống kê của tôi, dữ liệu trang chia sẻ (công khai) và trang OG chuyển hướng */
@ApiTags('Growth')
@Controller()
export class ReferralController {
  constructor(private readonly referrals: ReferralService) {}

  /** Mã + link UTM + thống kê joined/started/upgraded + credit đã nhận; khách → 403 */
  @Get('me/referral')
  @ApiZod({ responses: { 200: referralSummarySchema, 403: 'empty' } })
  mine(@CurrentUser() user: AuthUser) {
    return this.referrals.summary(user);
  }

  /** Dữ liệu trang chia sẻ cho web (OG title/description/image, tên người giới thiệu đã che, thưởng cho người mới) */
  @Public()
  @Get('referrals/:code')
  @ApiZod({ responses: { 200: referralLandingSchema } })
  landing(@ZodParams(codeParam) p: z.infer<typeof codeParam>) {
    return this.referrals.landing(p.code);
  }

  /** Link chia sẻ: HTML có thẻ OG (crawler Facebook/Zalo) + chuyển hướng tới trang đăng ký của web kèm `ref` và UTM */
  @Public()
  @Get('r/:code')
  @ApiZod({ query: utmQuery, responses: { 200: 'empty' } })
  async share(@ZodParams(codeParam) p: z.infer<typeof codeParam>, @ZodQuery(utmQuery) q: z.infer<typeof utmQuery>, @Res() reply: FastifyReply) {
    const html = await this.referrals.landingHtml(p.code, q);
    // S11: trang chỉ có thẻ meta (OG + refresh) – CSP khoá script/style/frame (chống XSS phản chiếu nếu escape sót)
    return reply.status(200).header('content-type', 'text/html; charset=utf-8').header('cache-control', 'public, max-age=300').header('content-security-policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'").send(html);
  }
}
