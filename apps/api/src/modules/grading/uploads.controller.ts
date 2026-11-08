import { Controller, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { uploadPresignResponseSchema, uploadPresignSchema, type UploadPresign } from '@allingo/schemas';
import { CurrentUser, type AuthUser } from '../../shared/auth/auth.guard.js';
import { ApiZod, ZodBody } from '../../shared/http/zod.js';
import { UploadsService } from './uploads.service.js';
import { RateLimit } from '../../shared/http/rate-limit.js';

/** Body/response theo docs/spec/allingo-openapi.yaml `/uploads/presign` – định nghĩa ở @allingo/schemas (dùng chung web/mobile) */

@ApiTags('Grading')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** URL PUT trực tiếp lên bucket riêng (ký Content-Type + Content-Length, hạn 10 phút). Yêu cầu đăng nhập (kể cả khách). */
  @Post('presign')
  @RateLimit('uploads')
  @HttpCode(201)
  @ApiZod({ body: uploadPresignSchema, responses: { 201: uploadPresignResponseSchema } })
  presign(@CurrentUser() user: AuthUser, @ZodBody(uploadPresignSchema) body: UploadPresign) {
    return this.uploads.presign(user, body);
  }
}
