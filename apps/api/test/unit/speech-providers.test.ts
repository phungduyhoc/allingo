import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AzureSpeechProvider,
  buildSsml,
  countWords,
  defaultVoiceFor,
  ffmpeg,
  MockSpeechProvider,
  MOCK_MS_PER_WORD,
  parseAssessmentResponse,
  pronunciationBandFromPa,
  retryDelayMs,
  SpeechProviderError,
  ttsTextHash,
  wavDurationMs,
  type FetchLike,
} from '../../src/modules/speech/index.js';

const cfg = ffmpeg.DEFAULT_FFMPEG;
const hasFfmpeg = ffmpeg.ffmpegAvailable(cfg);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-speech-unit-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** fetch giả ghi lại request (không gọi mạng) */
function fakeFetch(respond: (url: string, init: Parameters<FetchLike>[1]) => { status: number; body: Buffer | string; headers?: Record<string, string> }) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  const fn: FetchLike = (url, init) => {
    calls.push({ url, init });
    const r = respond(url, init);
    const buf = typeof r.body === 'string' ? Buffer.from(r.body) : r.body;
    return Promise.resolve({ ok: r.status < 400, status: r.status, headers: { get: (n: string) => r.headers?.[n.toLowerCase()] ?? null }, arrayBuffer: () => Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer), text: () => Promise.resolve(buf.toString('utf8')) });
  };
  return { fn, calls };
}

describe.skipIf(!hasFfmpeg)('MockSpeechProvider – TTS im lặng bằng ffmpeg', () => {
  it('thời lượng ≈ số từ × 350 ms; MP3 mono 48 kbps', async () => {
    const p = new MockSpeechProvider(cfg);
    const text = 'Please submit the quarterly invoice before Friday afternoon.';
    const out = await p.synthesize(text, 'en-US-JennyNeural', 'en-US');
    expect(countWords(text)).toBe(8);
    expect(out.durationMs).toBe(8 * MOCK_MS_PER_WORD);
    expect(out.mime).toBe('audio/mpeg');
    const f = path.join(tmp, 'mock.mp3');
    fs.writeFileSync(f, out.audio);
    const probe = await ffmpeg.probeMedia(cfg, f, 'mp3');
    expect(Math.abs((probe.durationMs ?? 0) - out.durationMs)).toBeLessThan(120);
    expect(probe.streams[0]).toMatchObject({ codecName: 'mp3', channels: 1 });
  });
});

describe('MockSpeechProvider – Pronunciation Assessment xác định', () => {
  const p = new MockSpeechProvider(cfg);
  const audio = { data: Buffer.from('RIFF0000WAVEfake-audio-bytes'), mime: 'audio/wav' };
  it('cùng đầu vào → cùng điểm; khác reference → khác; điểm trong 0–100; số từ khớp', async () => {
    const a = await p.assessPronunciation(audio, 'The meeting starts at nine.', 'en-US');
    const b = await p.assessPronunciation(audio, 'The meeting starts at nine.', 'en-US');
    const c = await p.assessPronunciation(audio, 'The meeting ends at five.', 'en-US');
    expect(a).toEqual(b);
    expect([c.accuracy, c.fluency, c.prosody]).not.toEqual([a.accuracy, a.fluency, a.prosody]);
    for (const v of [a.accuracy, a.fluency, a.prosody!, a.completeness, a.pronScore]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(a.words.map((w) => w.word)).toEqual(['The', 'meeting', 'starts', 'at', 'nine']);
  });

  it('đọc thời lượng từ header WAV', () => {
    const sr = 16000;
    const data = Buffer.alloc(sr * 2); // 1 s PCM16 mono
    const h = Buffer.alloc(44);
    h.write('RIFF', 0, 'latin1');
    h.writeUInt32LE(36 + data.length, 4);
    h.write('WAVEfmt ', 8, 'latin1');
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(sr, 24);
    h.writeUInt32LE(sr * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write('data', 36, 'latin1');
    h.writeUInt32LE(data.length, 40);
    expect(wavDurationMs(Buffer.concat([h, data]))).toBe(1000);
    expect(wavDurationMs(Buffer.from('not a wav file at all, nope......................'))).toBeNull();
  });
});

describe('AzureSpeechProvider (REST, fetch giả)', () => {
  it('TTS: đúng endpoint vùng, header khoá/định dạng, SSML escape; thời lượng theo CBR 48 kbps', async () => {
    const audio = Buffer.alloc(6000, 1); // 6000 B × 8 / 48 = 1000 ms
    const f = fakeFetch(() => ({ status: 200, body: audio }));
    const p = new AzureSpeechProvider({ key: 'k-123', region: 'southeastasia', fetch: f.fn });
    const out = await p.synthesize('Tom & Jerry <say> "hi"', 'en-US-JennyNeural', 'en-US');
    expect(out).toMatchObject({ durationMs: 1000, mime: 'audio/mpeg' });
    expect(f.calls[0]!.url).toBe('https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(f.calls[0]!.init.headers).toMatchObject({ 'Ocp-Apim-Subscription-Key': 'k-123', 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3' });
    expect(String(f.calls[0]!.init.body)).toContain('Tom &amp; Jerry &lt;say&gt; &quot;hi&quot;');
    expect(buildSsml('a', 'en-US-JennyNeural', 'en-US')).toContain('<voice name="en-US-JennyNeural">a</voice>');
  });

  it('TTS lỗi HTTP 401 → SpeechProviderError(http_error), không thử lại; thiếu khoá → not_configured', async () => {
    const f = fakeFetch(() => ({ status: 401, body: 'unauthorized' }));
    const sleeps: number[] = [];
    const p = new AzureSpeechProvider({ key: 'bad', region: 'eastus', fetch: f.fn, sleep: async (ms) => void sleeps.push(ms) });
    await expect(p.synthesize('hello', 'en-US-JennyNeural', 'en-US')).rejects.toMatchObject({ reason: 'http_error', status: 401 });
    expect(f.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(() => new AzureSpeechProvider({ key: '', region: 'eastus' })).toThrow(SpeechProviderError);
  });

  it('429 (F0 20 giao dịch/60 s) → chờ theo Retry-After rồi thử lại thành công; 503 cũng thử lại', async () => {
    const audio = Buffer.alloc(600, 1);
    let n = 0;
    const f = fakeFetch(() => {
      n++;
      if (n === 1) return { status: 429, body: 'too many', headers: { 'retry-after': '2' } };
      if (n === 2) return { status: 503, body: 'busy' };
      return { status: 200, body: audio };
    });
    const sleeps: number[] = [];
    const p = new AzureSpeechProvider({ key: 'k', region: 'southeastasia', fetch: f.fn, sleep: async (ms) => void sleeps.push(ms) });
    await expect(p.synthesize('hello', 'en-US-JennyNeural', 'en-US')).resolves.toMatchObject({ mime: 'audio/mpeg' });
    expect(f.calls).toHaveLength(3);
    expect(sleeps[0]).toBe(2250);
    expect(sleeps[1]).toBeGreaterThanOrEqual(5000); // lần thử thứ 2 không Retry-After → backoff 10 s, jitter nửa trên
    expect(sleeps[1]).toBeLessThanOrEqual(10_000);
  });

  it('429 liên tục quá maxRetries → SpeechProviderError(http_error, 429) sau maxRetries + 1 lần gọi', async () => {
    const f = fakeFetch(() => ({ status: 429, body: 'too many' }));
    const sleeps: number[] = [];
    const p = new AzureSpeechProvider({ key: 'k', region: 'southeastasia', fetch: f.fn, maxRetries: 2, sleep: async (ms) => void sleeps.push(ms) });
    await expect(p.synthesize('hello', 'en-US-JennyNeural', 'en-US')).rejects.toMatchObject({ reason: 'http_error', status: 429 });
    expect(f.calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('retryDelayMs: Retry-After (giây, trần 120 s) hoặc backoff 5 s × 2^n trần 60 s, jitter nửa trên', () => {
    expect(retryDelayMs('5', 0)).toBe(5250);
    expect(retryDelayMs('999', 0)).toBe(120_250);
    expect(retryDelayMs(null, 0, () => 0)).toBe(2500);
    expect(retryDelayMs(null, 0, () => 1)).toBe(5000);
    expect(retryDelayMs(undefined, 3, () => 1)).toBe(40_000);
    expect(retryDelayMs('', 10, () => 1)).toBe(60_000);
    expect(retryDelayMs('abc', 1, () => 0)).toBe(5000);
  });

  it('Pronunciation Assessment: header base64 JSON + content-type WAV 16 kHz; phân tích NBest (điểm lồng)', async () => {
    const response = {
      RecognitionStatus: 'Success',
      Duration: 21_000_000,
      NBest: [
        {
          Display: 'Good morning everyone.',
          PronunciationAssessment: { AccuracyScore: 91, FluencyScore: 88, CompletenessScore: 100, PronScore: 90.2, ProsodyScore: 84 },
          Words: [
            { Word: 'good', Offset: 5_000_000, Duration: 3_000_000, PronunciationAssessment: { AccuracyScore: 99, ErrorType: 'None' } },
            { Word: 'morning', Offset: 8_000_000, Duration: 5_000_000, PronunciationAssessment: { AccuracyScore: 55, ErrorType: 'Mispronunciation' } },
          ],
        },
      ],
    };
    const f = fakeFetch(() => ({ status: 200, body: JSON.stringify(response) }));
    const p = new AzureSpeechProvider({ key: 'k', region: 'southeastasia', fetch: f.fn });
    const r = await p.assessPronunciation({ data: Buffer.from('RIFF....WAVE'), mime: 'audio/wav' }, 'Good morning everyone.', 'en-US');
    const call = f.calls[0]!;
    expect(call.url).toBe('https://southeastasia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed');
    expect(call.init.headers['Content-Type']).toBe('audio/wav; codecs=audio/pcm; samplerate=16000');
    const cfgHeader = JSON.parse(Buffer.from(call.init.headers['Pronunciation-Assessment']!, 'base64').toString('utf8')) as Record<string, unknown>;
    expect(cfgHeader).toMatchObject({ ReferenceText: 'Good morning everyone.', GradingSystem: 'HundredMark', Dimension: 'Comprehensive' });
    expect(r).toMatchObject({ provider: 'azure', accuracy: 91, fluency: 88, prosody: 84, completeness: 100, pronScore: 90.2, durationMs: 2100 });
    expect(r.words[1]).toEqual({ word: 'morning', accuracy: 55, errorType: 'Mispronunciation', offsetMs: 800, durationMs: 500 });
    // Dạng điểm phẳng (API cũ) và NoMatch
    expect(parseAssessmentResponse({ RecognitionStatus: 'Success', NBest: [{ AccuracyScore: 70, FluencyScore: 60, CompletenessScore: 90 }] }).prosody).toBeNull();
    expect(() => parseAssessmentResponse({ RecognitionStatus: 'NoMatch' })).toThrow(/NoMatch/);
    await expect(p.assessPronunciation({ data: Buffer.from('x'), mime: 'audio/webm' }, 'x', 'en-US')).rejects.toMatchObject({ reason: 'unsupported_input' });
  });
});

describe('PA → band IELTS (scoring_rules.ielts_pronunciation_from_pa)', () => {
  it('đúng các mốc biên của bảng tạm PoC', () => {
    expect(pronunciationBandFromPa({ accuracy: 95, fluency: 90, prosody: 90 })).toMatchObject({ paScore: 92.5, band: 8 });
    expect(pronunciationBandFromPa({ accuracy: 90, fluency: 86, prosody: 86 }).band).toBe(7.5); // 88 & prosody ≥ 85
    expect(pronunciationBandFromPa({ accuracy: 92, fluency: 90, prosody: 78 }).band).toBe(7); // 88 nhưng prosody < 85
    expect(pronunciationBandFromPa({ accuracy: 86, fluency: 76, prosody: 76 }).band).toBe(6.5); // 81 & accuracy ≥ 85
    expect(pronunciationBandFromPa({ accuracy: 70, fluency: 76, prosody: 70 }).band).toBe(5.5); // 71.5 & fluency ≥ 75
    expect(pronunciationBandFromPa({ accuracy: 50, fluency: 50, prosody: 50 }).band).toBe(3.5);
    const imputed = pronunciationBandFromPa({ accuracy: 80, fluency: 80, prosody: null });
    expect(imputed).toMatchObject({ paScore: 80, prosodyImputed: true });
  });

  it('giọng mặc định theo locale và khoá cache TTS gồm provider', () => {
    expect(defaultVoiceFor('en-GB', 'x')).toBe('en-GB-SoniaNeural');
    expect(defaultVoiceFor('ja-JP', 'x')).toBe('ja-JP-NanamiNeural');
    expect(defaultVoiceFor('fr-FR', 'en-US-JennyNeural')).toBe('en-US-JennyNeural');
    expect(ttsTextHash('mock', 'en-US', 'hi')).not.toBe(ttsTextHash('azure', 'en-US', 'hi'));
  });
});
