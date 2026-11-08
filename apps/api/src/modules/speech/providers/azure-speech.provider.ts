import { getLogger } from '../../../shared/telemetry/logger.js';
import { baseMime } from '../../../shared/storage/storage.module.js';
import { normalizeScript, SpeechProviderError, type AudioInput, type PronunciationAssessment, type PronunciationWord, type SpeechProvider, type SynthesisResult } from '../speech-provider.js';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string | Buffer | Uint8Array; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

/** 429 (vượt hạn mức – F0 chỉ 20 giao dịch/60 s cho TTS) và 503 (thiếu tài nguyên tạm thời) → thử lại */
const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * Thời gian chờ trước lần thử lại thứ `attempt` (0-based): theo `Retry-After` (giây) nếu có, tối đa 120 s;
 * không có → backoff luỹ thừa 5 s, 10 s, 20 s… trần 60 s, jitter nửa trên (tránh dồn cùng lúc).
 */
export function retryDelayMs(retryAfter: string | null | undefined, attempt: number, random: () => number = Math.random): number {
  const sec = retryAfter != null && retryAfter.trim() !== '' ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec, 120) * 1000 + 250;
  const base = Math.min(60_000, 5_000 * 2 ** attempt);
  return Math.round(base / 2 + random() * (base / 2));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Định dạng đầu ra TTS khớp pipeline media: MP3 48 kbps mono 24 kHz */
export const AZURE_TTS_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const TTS_BITRATE_KBPS = 48;

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function buildSsml(text: string, voice: string, locale: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(locale)}"><voice name="${escapeXml(voice)}">${escapeXml(normalizeScript(text))}</voice></speak>`;
}

/** Header `Pronunciation-Assessment` (base64 JSON) cho REST short-audio */
export function pronunciationAssessmentHeader(referenceText: string): string {
  const cfg = { ReferenceText: normalizeScript(referenceText), GradingSystem: 'HundredMark', Granularity: 'Word', Dimension: 'Comprehensive', EnableMiscue: true, EnableProsodyAssessment: 'True' };
  return Buffer.from(JSON.stringify(cfg), 'utf8').toString('base64');
}

type AzureScores = { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; PronScore?: number; ProsodyScore?: number; ErrorType?: string };
interface AzureNBest extends AzureScores {
  Lexical?: string;
  Display?: string;
  PronunciationAssessment?: AzureScores;
  Words?: Array<AzureScores & { Word?: string; Offset?: number; Duration?: number; PronunciationAssessment?: AzureScores }>;
}
interface AzureRecognition {
  RecognitionStatus?: string;
  Duration?: number;
  DisplayText?: string;
  NBest?: AzureNBest[];
}

const TICKS_PER_MS = 10_000;
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Chuẩn hoá phản hồi REST (hai dạng: điểm phẳng trên NBest hoặc lồng trong PronunciationAssessment) */
export function parseAssessmentResponse(json: AzureRecognition): PronunciationAssessment {
  if (json.RecognitionStatus !== 'Success') throw new SpeechProviderError('no_match', `Recognition status: ${json.RecognitionStatus ?? 'unknown'}`);
  const best = json.NBest?.[0];
  if (!best) throw new SpeechProviderError('invalid_response', 'NBest missing');
  const s: AzureScores = { ...best, ...(best.PronunciationAssessment ?? {}) };
  const accuracy = n(s.AccuracyScore);
  const fluency = n(s.FluencyScore);
  const completeness = n(s.CompletenessScore);
  if (accuracy === null || fluency === null || completeness === null) throw new SpeechProviderError('invalid_response', 'Pronunciation scores missing');
  const prosody = n(s.ProsodyScore);
  const words: PronunciationWord[] = (best.Words ?? []).map((w) => {
    const ws: AzureScores = { ...w, ...(w.PronunciationAssessment ?? {}) };
    return { word: w.Word ?? '', accuracy: n(ws.AccuracyScore) ?? 0, errorType: ws.ErrorType ?? 'None', offsetMs: n(w.Offset) === null ? null : Math.round(w.Offset! / TICKS_PER_MS), durationMs: n(w.Duration) === null ? null : Math.round(w.Duration! / TICKS_PER_MS) };
  });
  return {
    provider: 'azure',
    accuracy,
    fluency,
    prosody,
    completeness,
    pronScore: n(s.PronScore) ?? Math.round((0.6 * accuracy + 0.2 * fluency + 0.2 * completeness) * 10) / 10,
    recognizedText: best.Display ?? json.DisplayText ?? best.Lexical ?? '',
    words,
    durationMs: n(json.Duration) === null ? null : Math.round(json.Duration! / TICKS_PER_MS),
  };
}

/**
 * Azure AI Speech qua REST (không dùng SDK native): TTS `cognitiveservices/v1` (SSML) và
 * Pronunciation Assessment trên REST short-audio (≤ 30 s/đoạn, WAV PCM 16 kHz mono hoặc OGG Opus).
 * Không log nội dung văn bản/ghi âm.
 */
export class AzureSpeechProvider implements SpeechProvider {
  readonly name = 'azure' as const;

  constructor(
    private readonly opts: { key: string; region: string; timeoutMs?: number; fetch?: FetchLike; maxRetries?: number; sleep?: (ms: number) => Promise<void> },
  ) {
    if (!opts.key || !opts.region) throw new SpeechProviderError('not_configured', 'AZURE_SPEECH_KEY/AZURE_SPEECH_REGION missing');
  }

  private get fetcher(): FetchLike {
    return this.opts.fetch ?? globalThis.fetch;
  }

  private async call(url: string, headers: Record<string, string>, body: string | Buffer) {
    const maxRetries = this.opts.maxRetries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.timeout(this.opts.timeoutMs ?? 30_000);
      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await this.fetcher(url, { method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': this.opts.key, 'User-Agent': 'allingo-api', ...headers }, body, signal });
      } catch (err) {
        const e = err as Error;
        if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new SpeechProviderError('timeout', 'Azure Speech request timed out');
        throw new SpeechProviderError('http_error', `Azure Speech request failed: ${e.message}`);
      }
      if (res.ok) return res;
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        const delayMs = retryDelayMs(res.headers?.get('retry-after'), attempt);
        getLogger({ component: 'speech.azure' }).warn({ status: res.status, attempt: attempt + 1, max_retries: maxRetries, delay_ms: delayMs }, 'azure speech throttled – retrying');
        await (this.opts.sleep ?? defaultSleep)(delayMs);
        continue;
      }
      throw new SpeechProviderError('http_error', `Azure Speech HTTP ${res.status}`, res.status);
    }
  }

  async synthesize(text: string, voice: string, locale: string): Promise<SynthesisResult> {
    const url = `https://${this.opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const res = await this.call(url, { 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': AZURE_TTS_FORMAT }, buildSsml(text, voice, locale));
    const audio = Buffer.from(await res.arrayBuffer());
    if (audio.length === 0) throw new SpeechProviderError('invalid_response', 'Empty TTS audio');
    // CBR 48 kbps → ms = bytes × 8 / 48
    return { audio, durationMs: Math.round((audio.length * 8) / TTS_BITRATE_KBPS), mime: 'audio/mpeg' };
  }

  async assessPronunciation(audio: AudioInput, referenceText: string, locale: string): Promise<PronunciationAssessment> {
    const mime = baseMime(audio.mime);
    const contentType = mime === 'audio/wav' || mime === 'audio/x-wav' || mime === 'audio/wave' ? 'audio/wav; codecs=audio/pcm; samplerate=16000' : mime === 'audio/ogg' ? 'audio/ogg; codecs=opus' : null;
    if (!contentType) throw new SpeechProviderError('unsupported_input', `Unsupported audio for assessment: ${mime}`);
    const q = new URLSearchParams({ language: locale, format: 'detailed' });
    const url = `https://${this.opts.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?${q.toString()}`;
    const res = await this.call(url, { 'Content-Type': contentType, Accept: 'application/json', 'Pronunciation-Assessment': pronunciationAssessmentHeader(referenceText) }, audio.data);
    let json: AzureRecognition;
    try {
      json = JSON.parse(await res.text()) as AzureRecognition;
    } catch {
      throw new SpeechProviderError('invalid_response', 'Invalid JSON from Azure Speech');
    }
    return parseAssessmentResponse(json);
  }
}
