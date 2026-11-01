/**
 * SpeechProvider (ADR-0008, ADR-0025): mọi lời gọi dịch vụ giọng nói (TTS, Pronunciation Assessment, sau này STT)
 * đi qua interface này – module nghiệp vụ không gọi Azure trực tiếp (CLAUDE.md §5.2).
 */

export const SPEECH_PROVIDER = Symbol('SPEECH_PROVIDER');

export type SpeechProviderName = 'mock' | 'azure';

export interface SynthesisResult {
  audio: Buffer;
  /** Thời lượng (ms) – mock: chính xác theo số từ; azure: ước tính từ bitrate CBR 48 kbps */
  durationMs: number;
  mime: string;
}

export interface AudioInput {
  data: Buffer;
  /** MIME của dữ liệu – Azure REST nhận audio/wav (PCM 16 kHz mono) hoặc audio/ogg (Opus) */
  mime: string;
}

export interface PronunciationWord {
  word: string;
  accuracy: number;
  /** None | Mispronunciation | Omission | Insertion | UnexpectedBreak | MissingBreak | Monotone */
  errorType: string;
  offsetMs: number | null;
  durationMs: number | null;
}

export interface PronunciationAssessment {
  provider: SpeechProviderName;
  /** Thang 0–100 */
  accuracy: number;
  fluency: number;
  /** null khi dịch vụ không trả prosody (ngôn ngữ/khu vực không hỗ trợ) */
  prosody: number | null;
  completeness: number;
  pronScore: number;
  recognizedText: string;
  words: PronunciationWord[];
  /** Thời lượng lời nói nhận diện được (ms) nếu có */
  durationMs: number | null;
}

/** Interface chung; `transcribe` (STT) bổ sung ở S6/S9 */
export interface SpeechProvider {
  readonly name: SpeechProviderName;
  synthesize(text: string, voice: string, locale: string): Promise<SynthesisResult>;
  assessPronunciation(audio: AudioInput, referenceText: string, locale: string): Promise<PronunciationAssessment>;
}

export class SpeechProviderError extends Error {
  constructor(
    readonly reason: 'not_configured' | 'http_error' | 'timeout' | 'invalid_response' | 'unsupported_input' | 'no_match',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}

/** Giọng mặc định theo locale (Azure Neural); không khớp → TTS_DEFAULT_VOICE */
const DEFAULT_VOICES: Record<string, string> = {
  'en-US': 'en-US-JennyNeural',
  'en-GB': 'en-GB-SoniaNeural',
  'en-AU': 'en-AU-NatashaNeural',
  'ja-JP': 'ja-JP-NanamiNeural',
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'ko-KR': 'ko-KR-SunHiNeural',
  'vi-VN': 'vi-VN-HoaiMyNeural',
};

export function defaultVoiceFor(locale: string, fallback: string): string {
  const exact = DEFAULT_VOICES[locale];
  if (exact) return exact;
  const lang = locale.split('-')[0]!.toLowerCase();
  const byLang = Object.entries(DEFAULT_VOICES).find(([k]) => k.toLowerCase().startsWith(`${lang}-`));
  return byLang?.[1] ?? fallback;
}

/** Tên giọng Azure hợp lệ (vd en-US-JennyNeural, zh-CN-XiaoxiaoMultilingualNeural) – chống chèn SSML */
export const VOICE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]{2,8})?-[A-Za-z0-9]{2,64}$/;
export const LOCALE_PATTERN = /^[a-z]{2,3}-[A-Z]{2}$/;

/** Chuẩn hoá script trước khi băm cache: NFC, gộp khoảng trắng */
export function normalizeScript(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  const t = normalizeScript(text);
  if (!t) return 0;
  // CJK không có khoảng trắng: mỗi ký tự ~ một "từ" cho mục đích ước tính thời lượng
  const cjk = (t.match(/[぀-ヿ㐀-鿿]/g) ?? []).length;
  const latin = t.replace(/[぀-ヿ㐀-鿿]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return latin + cjk;
}
