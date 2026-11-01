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
import { defaultVoiceFor, normalizeScript, SPEECH_PROVIDER, VOICE_PATTERN, type SpeechProvider } from './speech-provider.js';

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

  /**
   * Giọng hợp lệ cho API công khai (S6): bí danh spec `en-US-neural-f|m`, `en-GB-neural-f|m` hoặc tên Azure `xx-YY-<Name>Neural`;
   * khác → 400 (chống chèn SSML). Trả { voice, locale }.
   */
  resolveVoice(voice?: string | null): { voice: string; locale: string } {
    const aliases: Record<string, string> = { 'en-US-neural-f': this.env.TTS_DEFAULT_VOICE, 'en-US-neural-m': 'en-US-GuyNeural', 'en-GB-neural-f': 'en-GB-SoniaNeural', 'en-GB-neural-m': 'en-GB-RyanNeural' };
    const v = !voice ? this.env.TTS_DEFAULT_VOICE : (aliases[voice] ?? voice);
    if (!VOICE_PATTERN.test(v)) throw new ValidationFailed({ issues: [{ path: 'voice', message: 'unsupported voice' }] });
    const [lang, region] = v.split('-');
    return { voice: v, locale: `${lang}-${region}` };
  }

  /** URL ký (TTL S3_PRESIGN_TTL_SECONDS) cho audio TTS ĐÃ cache; chưa có → null (không sinh) */
  async cachedAudio(text: string, voice?: string | null): Promise<{ url: string; durationMs: number; expiresAt: string; voice: string } | null> {
    const normalized = normalizeScript(text);
    if (!normalized) return null;
    const { voice: v, locale } = this.resolveVoice(voice);
    const textHash = ttsTextHash(this.provider.name, locale, normalized);
    const [hit] = await this.dbs.db.select().from(aiTtsCache).where(and(eq(aiTtsCache.textHash, textHash), eq(aiTtsCache.voice, v))).limit(1);
    if (!hit) return null;
    const ttl = this.env.S3_PRESIGN_TTL_SECONDS;
    return { url: await this.storage.presignGet('media', hit.storageKey, ttl), durationMs: hit.durationMs ?? 0, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), voice: v };
  }

  /** GET /tts: sinh (hoặc lấy cache) rồi trả URL ký */
  async audioUrl(text: string, voice?: string | null): Promise<{ url: string; durationMs: number; expiresAt: string; cached: boolean; voice: string }> {
    const { voice: v, locale } = this.resolveVoice(voice);
    const r = await this.forScript(text, v, locale);
    const ttl = this.env.S3_PRESIGN_TTL_SECONDS;
    return { url: await this.storage.presignGet('media', r.storageKey, ttl), durationMs: r.durationMs, expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), cached: r.cached, voice: r.voice };
  }

  private readonly inflight = new Set<string>();
  /** Sinh nền (không chờ) – tra từ trả nhanh, lần sau có audio_url; trùng trong process bỏ qua */
  warmInBackground(text: string, voice?: string | null): void {
    const key = `${voice ?? ''}|${normalizeScript(text)}`;
    if (!normalizeScript(text) || this.inflight.has(key)) return;
    this.inflight.add(key);
    const { voice: v, locale } = this.resolveVoice(voice);
    void this.forScript(text, v, locale)
      .catch((err: Error) => this.logger.warn({ err: err.message.slice(0, 200) }, 'background tts failed'))
      .finally(() => this.inflight.delete(key));
  }

  /** TTS → catalog.media_assets (audio, ready) cho CMS; cùng script + giọng → cùng asset */
  async createAsset(text: string, voice: string | undefined, locale: string, createdBy?: string | null): Promise<{ mediaAssetId: string; durationMs: number; cached: boolean; voice: string }> {
    const r = await this.forScript(text, voice, locale);
    const a = await this.media.upsertTtsAsset({ storageKey: r.storageKey, durationMs: r.durationMs, sizeBytes: r.sizeBytes, mime: r.mime, text: normalizeScript(text), tts: { voice: r.voice, locale, provider: this.provider.name, text_hash: r.textHash }, createdBy });
    return { mediaAssetId: a.mediaAssetId, durationMs: r.durationMs, cached: r.cached, voice: r.voice };
  }
}
