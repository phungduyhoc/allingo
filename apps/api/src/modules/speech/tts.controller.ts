import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ttsQuerySchema, ttsResultSchema } from '@allingo/schemas';
import { ApiZod, ZodQuery } from '../../shared/http/zod.js';
import { TtsService } from './tts.service.js';

/** GET /tts (S6): audio TTS cho chuỗi ≤ 500 ký tự, cache ai.tts_cache, URL ký 10 phút */
@ApiTags('Speech')
@Controller('tts')
export class TtsController {
  constructor(private readonly tts: TtsService) {}

  @Get()
  @ApiZod({ query: ttsQuerySchema, responses: { 200: ttsResultSchema, 400: 'empty' } })
  async get(@ZodQuery(ttsQuerySchema) q: z.infer<typeof ttsQuerySchema>) {
    const r = await this.tts.audioUrl(q.text, q.voice);
    return { url: r.url, duration_ms: r.durationMs, expires_at: r.expiresAt, cached: r.cached, voice: r.voice };
  }
}
