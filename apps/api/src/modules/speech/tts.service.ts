import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { ENV, type Env } from '../../config/env.js';
import { DbService } from '../../shared/db/db.module.js';
import { ValidationFailed } from '../../shared/http/errors.js';
import { StorageService } from '../../shared/storage/storage.module.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { MediaAssetsService } from './media/media-assets.service.js';
import { defaultVoiceFor, normalizeScript, SPEECH_PROVIDER, type SpeechProvider } from './speech-provider.js';

const { aiTtsCache } = schema;

export interface TtsResult {
  storageKey: string;
  durationMs: number;
  sizeBytes: number;
  mime: string;
  voice: string;
  locale: string;
  textHash: string;
  cached: boolean;
}

/** Băm cache TTS: gồm provider + locale để audio mock không bị dùng lại khi chuyển sang Azure */
export function ttsTextHash(provider: string, locale: string, normalizedText: string): string {
  return createHash('sha256').update(`tts-v1|${provider}|${locale}|${normalizedText}`).digest('hex');
}

/**
 * TTS cho audio_script khi soạn nội dung (ADR-0025): cache `ai.tts_cache(text_hash, voice)` → tệp MP3 trong bucket media
 * (`tts/<hh>/<hash>.mp3`, bất biến). Cache hit nhưng thiếu tệp → sinh lại và cập nhật.
 */
@Injectable()
export class TtsService {
  private readonly logger = getLogger({ component: 'speech.tts' });

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(SPEECH_PROVIDER) private readonly provider: SpeechProvider,
    private readonly dbs: DbService,
    private readonly storage: StorageService,
    private readonly media: MediaAssetsService,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  async forScript(text: string, voice?: string, locale = 'en-US'): Promise<TtsResult> {
    const normalized = normalizeScript(text);
    if (!normalized) throw new ValidationFailed({ field: 'text' }, 'Text is empty');
    const v = voice ?? defaultVoiceFor(locale, this.env.TTS_DEFAULT_VOICE);
    const textHash = ttsTextHash(this.provider.name, locale, normalized);

    const [hit] = await this.dbs.db.select().from(aiTtsCache).where(and(eq(aiTtsCache.textHash, textHash), eq(aiTtsCache.voice, v))).limit(1);
    if (hit) {
      const head = await this.storage.headObject('media', hit.storageKey);
      if (head) return { storageKey: hit.storageKey, durationMs: hit.durationMs ?? 0, sizeBytes: head.size, mime: head.contentType ?? 'audio/mpeg', voice: v, locale, textHash, cached: true };
      this.logger.warn({ text_hash: textHash.slice(0, 12) }, 'tts cache hit but object missing – regenerating');
    }

    const started = Date.now();
    const out = await this.provider.synthesize(normalized, v, locale);
    const key = `tts/${textHash.slice(0, 2)}/${textHash}.mp3`;
    await this.storage.putObject('media', key, out.audio, { contentType: out.mime, cacheControl: 'public, max-age=31536000, immutable' });
    await this.dbs.db
      .insert(aiTtsCache)
      .values({ textHash, voice: v, storageKey: key, durationMs: out.durationMs })
      .onConflictDoUpdate({ target: [aiTtsCache.textHash, aiTtsCache.voice], set: { storageKey: key, durationMs: out.durationMs, createdAt: sql`now()` } });
    this.logger.info({ provider: this.provider.name, voice: v, chars: normalized.length, ms: Date.now() - started }, 'tts synthesized');
    return { storageKey: key, durationMs: out.durationMs, sizeBytes: out.audio.length, mime: out.mime, voice: v, locale, textHash, cached: false };
  }

  /** TTS → catalog.media_assets (audio, ready) cho CMS; cùng script + giọng → cùng asset */
  async createAsset(text: string, voice: string | undefined, locale: string, createdBy?: string | null): Promise<{ mediaAssetId: string; durationMs: number; cached: boolean; voice: string }> {
    const r = await this.forScript(text, voice, locale);
    const a = await this.media.upsertTtsAsset({ storageKey: r.storageKey, durationMs: r.durationMs, sizeBytes: r.sizeBytes, mime: r.mime, text: normalizeScript(text), tts: { voice: r.voice, locale, provider: this.provider.name, text_hash: r.textHash }, createdBy });
    return { mediaAssetId: a.mediaAssetId, durationMs: r.durationMs, cached: r.cached, voice: r.voice };
  }
}
