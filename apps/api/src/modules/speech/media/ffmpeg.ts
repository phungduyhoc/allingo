import { spawn, spawnSync } from 'node:child_process';

/**
 * Tiện ích ffmpeg/ffprobe cho pipeline media (ADR-0025). Chạy tiến trình con với đối số mảng (không qua shell),
 * ép demuxer theo kết quả nhận dạng chữ ký tệp và `-protocol_whitelist file` để chặn playlist HLS/concat
 * (SSRF/đọc tệp cục bộ) từ tệp người dùng tải lên.
 */

export interface FfmpegConfig {
  ffmpegPath: string;
  ffprobePath: string;
  timeoutMs: number;
}

export const DEFAULT_FFMPEG: FfmpegConfig = { ffmpegPath: 'ffmpeg', ffprobePath: 'ffprobe', timeoutMs: 300_000 };

export class MediaToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'MediaToolError';
  }
}

interface RunOptions {
  input?: Buffer;
  timeoutMs: number;
  /** Giới hạn stdout gom vào bộ nhớ (byte) */
  maxStdout?: number;
  onStdout?: (chunk: Buffer) => void;
}

function run(bin: string, args: string[], opts: RunOptions): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: [opts.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let outLen = 0;
    let stderr = '';
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve({ stdout: Buffer.concat(out), stderr });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new MediaToolError(bin, `${bin} timed out after ${opts.timeoutMs} ms`, stderr));
    }, opts.timeoutMs);
    child.stdout?.on('data', (c: Buffer) => {
      if (opts.onStdout) return opts.onStdout(c);
      outLen += c.length;
      if (opts.maxStdout && outLen > opts.maxStdout) {
        child.kill('SIGKILL');
        return finish(new MediaToolError(bin, `${bin} output exceeds ${opts.maxStdout} bytes`, stderr));
      }
      out.push(c);
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr = (stderr + c.toString('utf8')).slice(-4000);
    });
    child.on('error', (err) => finish(new MediaToolError(bin, `${bin} failed to start: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(null);
      else finish(new MediaToolError(bin, `${bin} exited with code ${code}`, stderr));
    });
    if (opts.input && child.stdin) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(opts.input);
    }
  });
}

const availability = new Map<string, boolean>();
/** ffmpeg + ffprobe chạy được (cache theo đường dẫn) */
export function ffmpegAvailable(cfg: Pick<FfmpegConfig, 'ffmpegPath' | 'ffprobePath'> = DEFAULT_FFMPEG): boolean {
  const k = `${cfg.ffmpegPath}|${cfg.ffprobePath}`;
  let ok = availability.get(k);
  if (ok === undefined) {
    ok = [cfg.ffmpegPath, cfg.ffprobePath].every((b) => {
      try {
        return spawnSync(b, ['-version'], { stdio: 'ignore', timeout: 5000 }).status === 0;
      } catch {
        return false;
      }
    });
    availability.set(k, ok);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Nhận dạng định dạng bằng chữ ký tệp (magic bytes) – không tin MIME client khai báo
// ---------------------------------------------------------------------------

export type MediaContainer = 'wav' | 'ogg' | 'webm' | 'mp3' | 'mp4' | 'png' | 'jpeg' | 'webp';

export interface SniffResult {
  kind: 'audio' | 'image';
  container: MediaContainer;
  /** Demuxer ffmpeg ép buộc (-f) */
  demuxer: string;
  mime: string;
}

const ascii = (b: Buffer, start: number, len: number) => b.subarray(start, start + len).toString('latin1');

export function sniffMedia(head: Buffer): SniffResult | null {
  if (head.length < 12) return null;
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return { kind: 'audio', container: 'wav', demuxer: 'wav', mime: 'audio/wav' };
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return { kind: 'image', container: 'webp', demuxer: 'webp_pipe', mime: 'image/webp' };
  if (ascii(head, 0, 4) === 'OggS') return { kind: 'audio', container: 'ogg', demuxer: 'ogg', mime: 'audio/ogg' };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { kind: 'audio', container: 'webm', demuxer: 'matroska', mime: 'audio/webm' };
  if (head[0] === 0x89 && ascii(head, 1, 3) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a) return { kind: 'image', container: 'png', demuxer: 'png_pipe', mime: 'image/png' };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', container: 'jpeg', demuxer: 'jpeg_pipe', mime: 'image/jpeg' };
  if (ascii(head, 4, 4) === 'ftyp') return { kind: 'audio', container: 'mp4', demuxer: 'mov', mime: 'audio/mp4' };
  if (ascii(head, 0, 3) === 'ID3') return { kind: 'audio', container: 'mp3', demuxer: 'mp3', mime: 'audio/mpeg' };
  // Khung MPEG audio Layer III không có ID3: 11 bit đồng bộ + layer bits = 01
  if (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 && ((head[1]! >> 1) & 0x03) === 0x01) return { kind: 'audio', container: 'mp3', demuxer: 'mp3', mime: 'audio/mpeg' };
  return null;
}

// ---------------------------------------------------------------------------
// ffprobe
// ---------------------------------------------------------------------------

export interface ProbeStream {
  codecType: string;
  codecName: string | null;
  width: number | null;
  height: number | null;
  channels: number | null;
  sampleRate: number | null;
  bitRate: number | null;
}

export interface ProbeResult {
  formatName: string | null;
  durationMs: number | null;
  bitRate: number | null;
  streams: ProbeStream[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function probeMedia(cfg: FfmpegConfig, filePath: string, demuxer?: string): Promise<ProbeResult> {
  const args = ['-v', 'error', '-protocol_whitelist', 'file', ...(demuxer ? ['-f', demuxer] : []), '-show_entries', 'format=format_name,duration,bit_rate:stream=codec_type,codec_name,width,height,channels,sample_rate,bit_rate', '-of', 'json', filePath];
  const { stdout } = await run(cfg.ffprobePath, args, { timeoutMs: Math.min(cfg.timeoutMs, 60_000), maxStdout: 1024 * 1024 });
  const json = JSON.parse(stdout.toString('utf8')) as { format?: Record<string, unknown>; streams?: Array<Record<string, unknown>> };
  const duration = num(json.format?.duration);
  return {
    formatName: typeof json.format?.format_name === 'string' ? json.format.format_name : null,
    durationMs: duration === null ? null : Math.round(duration * 1000),
    bitRate: num(json.format?.bit_rate),
    streams: (json.streams ?? []).map((s) => ({
      codecType: typeof s.codec_type === 'string' ? s.codec_type : '',
      codecName: typeof s.codec_name === 'string' ? s.codec_name : null,
      width: num(s.width),
      height: num(s.height),
      channels: num(s.channels),
      sampleRate: num(s.sample_rate),
      bitRate: num(s.bit_rate),
    })),
  };
}

const BASE = ['-nostdin', '-hide_banner', '-loglevel', 'error'];

/** Chuẩn hoá audio → MP3 48 kbps mono 24 kHz, chuẩn hoá âm lượng (loudnorm EBU R128 -16 LUFS), bỏ metadata */
export async function normalizeAudio(cfg: FfmpegConfig, inPath: string, demuxer: string, outPath: string): Promise<void> {
  await run(cfg.ffmpegPath, [...BASE, '-protocol_whitelist', 'file', '-f', demuxer, '-i', inPath, '-vn', '-sn', '-dn', '-map_metadata', '-1', '-ac', '1', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ar', '24000', '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', '-y', outPath], { timeoutMs: cfg.timeoutMs });
}

/** Chuyển ảnh → WebP (tối đa maxWidth, không phóng to), bỏ EXIF/GPS */
export async function convertImageToWebp(cfg: FfmpegConfig, inPath: string, demuxer: string, outPath: string, maxWidth?: number): Promise<void> {
  const vf = maxWidth ? ['-vf', `scale='min(${maxWidth},iw)':-1`] : [];
  await run(cfg.ffmpegPath, [...BASE, '-protocol_whitelist', 'file', '-f', demuxer, '-i', inPath, '-frames:v', '1', '-map_metadata', '-1', ...vf, '-c:v', 'libwebp', '-quality', '82', '-f', 'webp', '-y', outPath], { timeoutMs: cfg.timeoutMs });
}

/** MP3 im lặng 48 kbps mono (MockSpeechProvider) */
export async function silenceMp3(cfg: FfmpegConfig, durationMs: number): Promise<Buffer> {
  const sec = (Math.max(50, durationMs) / 1000).toFixed(3);
  const { stdout } = await run(cfg.ffmpegPath, [...BASE, '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', sec, '-c:a', 'libmp3lame', '-b:a', '48k', '-f', 'mp3', 'pipe:1'], { timeoutMs: cfg.timeoutMs, maxStdout: 64 * 1024 * 1024 });
  return stdout;
}

/** Sinh tệp thử (sine/ảnh test) – dùng cho test và PoC; nguồn lavfi, không đọc tệp ngoài */
export async function generateTestMedia(cfg: FfmpegConfig, spec: { kind: 'sine'; durationMs: number; frequency?: number; sampleRate?: number; format: 'wav' | 'mp3' | 'ogg' } | { kind: 'image'; width: number; height: number; format: 'png' | 'jpeg' }, outPath: string): Promise<void> {
  if (spec.kind === 'sine') {
    const sr = spec.sampleRate ?? 16000;
    const codec = spec.format === 'wav' ? ['-c:a', 'pcm_s16le'] : spec.format === 'mp3' ? ['-c:a', 'libmp3lame', '-b:a', '64k'] : ['-c:a', 'libvorbis'];
    await run(cfg.ffmpegPath, [...BASE, '-f', 'lavfi', '-i', `sine=frequency=${spec.frequency ?? 440}:sample_rate=${sr}:duration=${(spec.durationMs / 1000).toFixed(3)}`, '-ac', '1', ...codec, '-y', outPath], { timeoutMs: cfg.timeoutMs });
    return;
  }
  await run(cfg.ffmpegPath, [...BASE, '-f', 'lavfi', '-i', `testsrc=size=${spec.width}x${spec.height}:rate=1`, '-frames:v', '1', ...(spec.format === 'jpeg' ? ['-q:v', '4'] : []), '-y', outPath], { timeoutMs: cfg.timeoutMs });
}

/** Chuyển audio bất kỳ (đã nhận dạng) → WAV PCM 16 kHz mono (đầu vào Pronunciation Assessment REST) */
export async function toAssessmentWav(cfg: FfmpegConfig, inPath: string, demuxer: string, outPath: string): Promise<void> {
  await run(cfg.ffmpegPath, [...BASE, '-protocol_whitelist', 'file', '-f', demuxer, '-i', inPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', '-y', outPath], { timeoutMs: cfg.timeoutMs });
}

export const WAVEFORM_SAMPLE_RATE = 8000;
/** Mỗi đỉnh "mịn" = 10 ms ở 8 kHz */
const FINE_WINDOW = 80;

/** Gộp đỉnh mịn thành đúng `count` giá trị (max theo đoạn) */
export function bucketPeaks(fine: number[], count: number): number[] {
  if (fine.length === 0 || count <= 0) return [];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = Math.floor((i * fine.length) / count);
    const b = Math.max(a + 1, Math.floor(((i + 1) * fine.length) / count));
    let m = 0;
    for (let j = a; j < b && j < fine.length; j++) if (fine[j]! > m) m = fine[j]!;
    out.push(Math.round(m * 1000) / 1000);
  }
  return out;
}

/**
 * Waveform: giải mã → PCM s16le mono 8 kHz (stream, không giữ toàn bộ mẫu), đỉnh |biên độ| mỗi 10 ms
 * rồi gộp thành `count` đỉnh (0..1 so với full-scale; im lặng = 0).
 */
export async function computeWaveform(cfg: FfmpegConfig, filePath: string, count = 200, demuxer?: string): Promise<number[]> {
  const fine: number[] = [];
  let leftover: Buffer | null = null;
  let windowMax = 0;
  let inWindow = 0;
  const onStdout = (chunk: Buffer) => {
    let buf = chunk;
    if (leftover) {
      buf = Buffer.concat([leftover, chunk]);
      leftover = null;
    }
    const usable = buf.length - (buf.length % 2);
    for (let i = 0; i < usable; i += 2) {
      const v = Math.abs(buf.readInt16LE(i)) / 32768;
      if (v > windowMax) windowMax = v;
      if (++inWindow === FINE_WINDOW) {
        fine.push(windowMax);
        windowMax = 0;
        inWindow = 0;
      }
    }
    if (usable < buf.length) leftover = buf.subarray(usable);
  };
  await run(cfg.ffmpegPath, [...BASE, '-protocol_whitelist', 'file', ...(demuxer ? ['-f', demuxer] : []), '-i', filePath, '-vn', '-ac', '1', '-ar', String(WAVEFORM_SAMPLE_RATE), '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], { timeoutMs: cfg.timeoutMs, onStdout });
  if (inWindow > 0) fine.push(windowMax);
  return bucketPeaks(fine, count);
}
