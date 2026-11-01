import { Body, type CanActivate, Controller, type ExecutionContext, Get, HttpCode, Inject, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { ENV, type Env } from '../../config/env.js';
import { InternalTokenGuard, Public } from '../../shared/auth/auth.guard.js';
import { AppError, ValidationFailed } from '../../shared/http/errors.js';
import { ZodValidationPipe } from '../../shared/http/zod.js';
import { baseMime, MAX_UPLOAD_BYTES } from '../../shared/storage/storage.module.js';
import { MediaAssetsService } from './media/media-assets.service.js';
import { ALLOWED_AUDIO_MIME, ALLOWED_IMAGE_MIME } from './media/media.types.js';
import { LOCALE_PATTERN, SpeechProviderError, VOICE_PATTERN } from './speech-provider.js';
import { TtsService } from './tts.service.js';
import { HttpStatus } from '@nestjs/common';

/** Guard X-Internal-Token (CMS → API, ADR-0019) */
@Injectable()
export class SpeechInternalTokenGuard implements CanActivate {
  private readonly inner: InternalTokenGuard;
  constructor(@Inject(ENV) env: Env) {
    this.inner = new InternalTokenGuard(env.INTERNAL_API_TOKEN);
  }
  canActivate(ctx: ExecutionContext): boolean {
    return this.inner.canActivate(ctx);
  }
}

export const internalPresignSchema = z
  .object({
    kind: z.enum(['audio', 'image']),
    mime_type: z.string().min(3).max(100),
    size_bytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
    license: z.string().regex(/^(own|cc-by|licensed:[\w.-]+)$/).default('own'),
  })
  .superRefine((v, ctx) => {
    const allowed: readonly string[] = v.kind === 'audio' ? ALLOWED_AUDIO_MIME : ALLOWED_IMAGE_MIME;
    if (!allowed.includes(baseMime(v.mime_type))) ctx.addIssue({ code: 'custom', path: ['mime_type'], message: `mime_type must be one of ${allowed.join(', ')}` });
  });

const processSchema = z.object({ media_asset_id: z.uuid(), force: z.boolean().default(false) });
const ttsSchema = z.object({
  text: z.string().min(1).max(5000),
  voice: z.string().regex(VOICE_PATTERN).optional(),
  locale: z.string().regex(LOCALE_PATTERN).default('en-US'),
});

/** Lỗi dịch vụ giọng nói → 502/503 với envelope chuẩn */
function speechError(err: unknown): never {
  if (err instanceof SpeechProviderError) {
    const status = err.reason === 'not_configured' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.BAD_GATEWAY;
    throw new AppError(err.reason === 'not_configured' ? 'feature_disabled' : 'internal', 'Speech service error', status, { reason: err.reason });
  }
  throw err;
}

/**
 * API nội bộ media cho CMS (không thuộc OpenAPI công khai, X-Internal-Token):
 * presign (tạo asset uploading) → PUT upload_url → process (job media.process) → GET (URL ký 10 phút, waveform);
 * tts (Azure/mock qua SpeechProvider, cache ai.tts_cache).
 */
@ApiExcludeController()
@Controller('internal/media')
@Public()
@UseGuards(SpeechInternalTokenGuard)
export class InternalMediaController {
  constructor(
    private readonly media: MediaAssetsService,
    private readonly tts: TtsService,
  ) {}

  @Post('presign')
  @HttpCode(201)
  async presign(@Body(new ZodValidationPipe(internalPresignSchema)) body: z.infer<typeof internalPresignSchema>) {
    const r = await this.media.createUpload({ kind: body.kind, mimeType: body.mime_type, sizeBytes: body.size_bytes, origin: 'cms', bucket: 'media', license: body.license });
    return { media_asset_id: r.mediaAssetId, upload_url: r.uploadUrl, expires_at: r.expiresAt.toISOString() };
  }

  /** CMS báo đã tải lên xong → xếp job (202); Redis degrade → xử lý đồng bộ */
  @Post('process')
  @HttpCode(202)
  async process(@Body(new ZodValidationPipe(processSchema)) body: z.infer<typeof processSchema>) {
    const r = await this.media.requestProcessing(body.media_asset_id, { force: body.force });
    return { media_asset_id: r.mediaAssetId, status: r.status, mode: r.mode };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw new ValidationFailed({ field: 'id' });
    return this.media.view(id);
  }

  @Post('tts')
  @HttpCode(201)
  async synthesize(@Body(new ZodValidationPipe(ttsSchema)) body: z.infer<typeof ttsSchema>) {
    try {
      const r = await this.tts.createAsset(body.text, body.voice, body.locale);
      return { media_asset_id: r.mediaAssetId, duration_ms: r.durationMs, cached: r.cached, voice: r.voice, provider: this.tts.providerName };
    } catch (err) {
      speechError(err);
    }
  }
}
