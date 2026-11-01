/**
 * Sinh tệp media cho nội dung seed demo (ADR-0025): `pnpm --filter @allingo/api seed:media [--force]`.
 * Chạy SAU `pnpm db:seed --set demo`. Asset seed (`catalog.media_assets.checksum = 'seed:<key>'`, status `uploading`)
 * được sinh từ nguồn trong `@allingo/db/seed` (listeningMediaSources):
 * - TTS: mỗi segment một giọng theo người nói + accent (SpeechProvider: Azure khi có khoá, mock = MP3 im lặng đúng thời lượng),
 *   ghép bằng ffmpeg với khoảng lặng, transcript có mốc thời gian `[{start_ms,end_ms,speaker,text}]`.
 * - Ảnh SVG Part 1: lưu nguyên SVG (image/svg+xml, bucket media; chỉ nội dung biên soạn, không nhận SVG từ người học).
 * Idempotent: chỉ xử lý asset chưa `ready` (hoặc mọi asset seed với --force).
 */
import 'reflect-metadata';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq, like, ne } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { listeningMediaSources, type ScriptSegment, type SeedMediaSource } from '@allingo/db/seed';
import { loadEnv } from '../src/config/env.js';
import { DbService } from '../src/shared/db/db.module.js';
import { StorageService } from '../src/shared/storage/storage.module.js';
import { TtsService, ffmpeg } from '../src/modules/speech/index.js';
import { withScriptContext } from '../src/cli/script-context.js';

const { catalogMediaAssets } = schema;
const force = process.argv.includes('--force');

/** Giọng Azure Neural theo accent; M1/M2 và W1/W2 khác giọng. Người dẫn (N) cố định en-US. */
const VOICES: Record<ScriptSegment['accent'], { locale: string; M1: string; M2: string; W1: string; W2: string }> = {
  us: {
    locale: 'en-US',
    M1: 'en-US-GuyNeural',
    M2: 'en-US-DavisNeural',
    W1: 'en-US-JennyNeural',
    W2: 'en-US-AriaNeural',
  },
  uk: {
    locale: 'en-GB',
    M1: 'en-GB-RyanNeural',
    M2: 'en-GB-ThomasNeural',
    W1: 'en-GB-SoniaNeural',
    W2: 'en-GB-LibbyNeural',
  },
  au: {
    locale: 'en-AU',
    M1: 'en-AU-WilliamNeural',
    M2: 'en-AU-DarrenNeural',
    W1: 'en-AU-NatashaNeural',
    W2: 'en-AU-AnnetteNeural',
  },
  ca: {
    locale: 'en-CA',
    M1: 'en-CA-LiamNeural',
    M2: 'en-US-BrandonNeural',
    W1: 'en-CA-ClaraNeural',
    W2: 'en-US-MichelleNeural',
  },
};
const NARRATOR = { locale: 'en-US', voice: 'en-US-ChristopherNeural' };

export function voiceFor(seg: ScriptSegment): { voice: string; locale: string } {
  if (seg.speaker === 'N') return NARRATOR;
  const voice = VOICES[seg.accent][seg.speaker];
  // Locale theo tên giọng (en-CA dùng thêm giọng en-US cho người nói thứ hai)
  return { voice, locale: voice.slice(0, 5) };
}

function runFfmpeg(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stderr.on('data', (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr}`));
    });
  });
}

const env = loadEnv();
const cfg = {
  ffmpegPath: env.FFMPEG_PATH,
  ffprobePath: env.FFPROBE_PATH,
  timeoutMs: env.MEDIA_FFMPEG_TIMEOUT_SECONDS * 1000,
};
if (!ffmpeg.ffmpegAvailable(cfg)) {
  process.stderr.write('✖ cần ffmpeg/ffprobe (FFMPEG_PATH/FFPROBE_PATH)\n');
  process.exit(1);
}

const sources = listeningMediaSources();
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'allingo-seed-media-'));

async function buildTts(
  storage: StorageService,
  tts: TtsService,
  key: string,
  src: Extract<SeedMediaSource, { type: 'tts' }>,
) {
  const parts: string[] = [];
  const transcript: Array<{ start_ms: number; end_ms: number; speaker: string; text: string }> = [];
  let cursor = 0;
  const gapFile = path.join(tmp, `gap-${src.gap_ms}.mp3`);
  if (src.gap_ms > 0) await fs.writeFile(gapFile, await ffmpeg.silenceMp3(cfg, src.gap_ms));
  for (const [i, seg] of src.segments.entries()) {
    const { voice, locale } = voiceFor(seg);
    const r = await tts.forScript(seg.text, voice, locale);
    const file = path.join(tmp, `${key.replace(/[^a-z0-9-]/gi, '_')}-${i}.mp3`);
    await fs.writeFile(file, await storage.getObjectBuffer('media', r.storageKey));
    if (i > 0 && src.gap_ms > 0) {
      parts.push(gapFile);
      cursor += src.gap_ms;
    }
    parts.push(file);
    transcript.push({ start_ms: cursor, end_ms: cursor + r.durationMs, speaker: seg.speaker, text: seg.text });
    cursor += r.durationMs;
  }
  const list = path.join(tmp, 'list.txt');
  await fs.writeFile(list, parts.map((p) => `file '${p}'`).join('\n'));
  const out = path.join(tmp, 'out.mp3');
  // Mã hoá lại một lần (các đoạn có thể khác sample rate giữa provider/giọng): mono 64 kbps đủ cho giọng nói
  await runFfmpeg(
    cfg.ffmpegPath,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '64k',
      out,
    ],
    cfg.timeoutMs,
  );
  const body = await fs.readFile(out);
  const probe = await ffmpeg.probeMedia(cfg, out);
  const durationMs = probe.durationMs ?? cursor;
  const waveform = await ffmpeg.computeWaveform(cfg, out, 200).catch(() => null);
  return { body, durationMs, transcript, waveform, mime: 'audio/mpeg', ext: 'mp3', providerName: tts.providerName };
}

let done = 0;
let skipped = 0;
try {
  await withScriptContext(async (app) => {
    const dbs = app.get(DbService);
    const storage = app.get(StorageService);
    const tts = app.get(TtsService);
    const rows = await dbs.db
      .select()
      .from(catalogMediaAssets)
      .where(
        force
          ? like(catalogMediaAssets.checksum, 'seed:%')
          : and(like(catalogMediaAssets.checksum, 'seed:%'), ne(catalogMediaAssets.status, 'ready')),
      );
    for (const row of rows) {
      const meta = (row.metadata ?? {}) as Record<string, unknown> & { seed?: { key?: string } };
      const key = meta.seed?.key;
      const src = key ? sources.get(key) : undefined;
      if (!key || !src) {
        skipped++;
        continue;
      }
      const safe = key.replace(/[^a-z0-9:-]/gi, '_').replace(/:/g, '/');
      if (src.type === 'svg') {
        const storageKey = `seed/${safe}.svg`;
        const body = Buffer.from(src.svg, 'utf8');
        await storage.putObject('media', storageKey, body, {
          contentType: 'image/svg+xml',
          cacheControl: 'public, max-age=86400',
        });
        await dbs.db
          .update(catalogMediaAssets)
          .set({
            storageKey,
            mimeType: 'image/svg+xml',
            sizeBytes: body.length,
            width: 800,
            height: 600,
            status: 'ready',
            metadata: { ...meta, bucket: 'media', processed_at: new Date().toISOString(), error: null },
          })
          .where(eq(catalogMediaAssets.id, row.id));
      } else {
        const r = await buildTts(storage, tts, key, src);
        const storageKey = `seed/${safe}.${r.ext}`;
        await storage.putObject('media', storageKey, r.body, {
          contentType: r.mime,
          cacheControl: 'public, max-age=86400',
        });
        await dbs.db
          .update(catalogMediaAssets)
          .set({
            storageKey,
            mimeType: r.mime,
            sizeBytes: r.body.length,
            durationMs: r.durationMs,
            transcript: r.transcript,
            status: 'ready',
            metadata: {
              ...meta,
              bucket: 'media',
              origin: 'tts',
              tts: { provider: r.providerName, locale: src.locale },
              waveform: r.waveform
                ? { count: r.waveform.length, sample_rate: ffmpeg.WAVEFORM_SAMPLE_RATE, peaks: r.waveform }
                : null,
              processed_at: new Date().toISOString(),
              error: null,
            },
          })
          .where(eq(catalogMediaAssets.id, row.id));
      }
      done++;
      if (done % 20 === 0) process.stdout.write(`… ${done}/${rows.length}\n`);
    }
    process.stdout.write(
      `✔ seed media: ${done} asset sẵn sàng, bỏ qua ${skipped} (provider TTS: ${tts.providerName})\n`,
    );
  });
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}
// Kết nối Redis/BullMQ đã đóng trong app.close(); thoát dứt khoát để CLI không treo vì handle còn sót
process.exit(0);
