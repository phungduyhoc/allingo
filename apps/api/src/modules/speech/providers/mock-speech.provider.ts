import { createHash } from 'node:crypto';
import { silenceMp3, type FfmpegConfig } from '../media/ffmpeg.js';
import { countWords, normalizeScript, type AudioInput, type PronunciationAssessment, type SpeechProvider, type SynthesisResult } from '../speech-provider.js';

/** Thời lượng giả lập mỗi từ (ms) */
export const MOCK_MS_PER_WORD = 350;

/** Đọc thời lượng từ header WAV (RIFF/fmt/data) nếu có – không cần ffprobe */
export function wavDurationMs(buf: Buffer): number | null {
  if (buf.length < 44 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('latin1', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 16 <= buf.length) byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') {
      const dataSize = Math.min(size, buf.length - off - 8);
      return byteRate > 0 ? Math.round((dataSize / byteRate) * 1000) : null;
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

/** Số giả ngẫu nhiên xác định trong [min, max] từ hash + nhãn */
function det(hash: Buffer, label: string, min: number, max: number): number {
  const h = createHash('sha256').update(hash).update(label).digest();
  const r = h.readUInt32BE(0) / 0xffffffff;
  return Math.round((min + r * (max - min)) * 10) / 10;
}

/**
 * Mock cho dev/test (không gọi mạng): TTS = MP3 im lặng 48 kbps mono dài ≈ số từ × 350 ms (ffmpeg anullsrc);
 * Pronunciation Assessment = số liệu XÁC ĐỊNH theo hash(audio, reference) – chỉ để kiểm chứng luồng, không phản ánh phát âm thật.
 */
export class MockSpeechProvider implements SpeechProvider {
  readonly name = 'mock' as const;
  synthesizeCalls = 0;

  constructor(private readonly ffmpeg: FfmpegConfig) {}

  async synthesize(text: string, _voice: string, _locale: string): Promise<SynthesisResult> {
    this.synthesizeCalls++;
    const durationMs = Math.max(1, countWords(text)) * MOCK_MS_PER_WORD;
    const audio = await silenceMp3(this.ffmpeg, durationMs);
    return { audio, durationMs, mime: 'audio/mpeg' };
  }

  async assessPronunciation(audio: AudioInput, referenceText: string, _locale: string): Promise<PronunciationAssessment> {
    const ref = normalizeScript(referenceText);
    const hash = createHash('sha256').update(audio.data).update('\u0000').update(ref).digest();
    const accuracy = det(hash, 'accuracy', 55, 98);
    const fluency = det(hash, 'fluency', 50, 98);
    const prosody = det(hash, 'prosody', 45, 95);
    const completeness = det(hash, 'completeness', 70, 100);
    const words = ref
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => {
        const acc = det(hash, `w${i}`, Math.max(0, accuracy - 25), Math.min(100, accuracy + 10));
        return { word: w.replace(/[^\p{L}\p{N}'-]/gu, ''), accuracy: acc, errorType: acc < 60 ? 'Mispronunciation' : 'None', offsetMs: i * MOCK_MS_PER_WORD, durationMs: MOCK_MS_PER_WORD };
      });
    const pronScore = Math.round((0.4 * accuracy + 0.2 * fluency + 0.2 * prosody + 0.2 * completeness) * 10) / 10;
    return { provider: 'mock', accuracy, fluency, prosody, completeness, pronScore, recognizedText: ref, words, durationMs: wavDurationMs(audio.data) };
  }
}
