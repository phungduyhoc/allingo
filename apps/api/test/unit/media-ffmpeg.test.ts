import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { ffmpeg } from '../../src/modules/speech/index.js';

const { DEFAULT_FFMPEG: cfg, bucketPeaks, computeWaveform, convertImageToWebp, ffmpegAvailable, generateTestMedia, normalizeAudio, probeMedia, sniffMedia } = ffmpeg;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-ffmpeg-unit-'));
const hasFfmpeg = ffmpegAvailable(cfg);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('nhận dạng chữ ký tệp (không tin MIME khai báo)', () => {
  const pad = (b: Buffer) => Buffer.concat([b, Buffer.alloc(16)]);
  it('nhận đúng wav/ogg/webm/mp3/mp4/png/jpeg/webp và từ chối văn bản (HLS playlist)', () => {
    expect(sniffMedia(pad(Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1')))?.container).toBe('wav');
    expect(sniffMedia(pad(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')))?.kind).toBe('image');
    expect(sniffMedia(pad(Buffer.from('OggS\0\x02', 'latin1')))?.demuxer).toBe('ogg');
    expect(sniffMedia(pad(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))?.container).toBe('webm');
    expect(sniffMedia(pad(Buffer.from('ID3\x04', 'latin1')))?.container).toBe('mp3');
    expect(sniffMedia(pad(Buffer.from([0xff, 0xfb, 0x90, 0x44])))?.container).toBe('mp3');
    expect(sniffMedia(pad(Buffer.from('\0\0\0\x20ftypM4A ', 'latin1')))?.demuxer).toBe('mov');
    expect(sniffMedia(pad(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))?.mime).toBe('image/png');
    expect(sniffMedia(pad(Buffer.from([0xff, 0xd8, 0xff, 0xe0])))?.container).toBe('jpeg');
    expect(sniffMedia(pad(Buffer.from('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\nfile:///etc/passwd', 'latin1')))).toBeNull();
    expect(sniffMedia(Buffer.from('short'))).toBeNull();
  });

  it('bucketPeaks gộp đúng số đỉnh, lấy max theo đoạn', () => {
    expect(bucketPeaks([], 200)).toEqual([]);
    expect(bucketPeaks([0.1, 0.9, 0.2, 0.3], 2)).toEqual([0.9, 0.3]);
    expect(bucketPeaks([0.5], 4)).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect(bucketPeaks(Array.from({ length: 1000 }, (_, i) => i / 1000), 200)).toHaveLength(200);
  });
});

describe.skipIf(!hasFfmpeg)('ffmpeg thật trên tệp sinh tạm', () => {
  it('waveform 200 đỉnh: 2 s sine + 1 s im lặng → phần đầu cao, phần cuối ≈ 0; duration ≈ 3 s', async () => {
    const tone = path.join(tmp, 'tone.wav');
    const silence = path.join(tmp, 'silence.wav');
    const joined = path.join(tmp, 'joined.wav');
    await generateTestMedia(cfg, { kind: 'sine', durationMs: 2000, format: 'wav' }, tone);
    spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '1', '-c:a', 'pcm_s16le', '-y', silence]);
    spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-i', tone, '-i', silence, '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-c:a', 'pcm_s16le', '-y', joined]);
    const probe = await probeMedia(cfg, joined, 'wav');
    expect(probe.durationMs).toBeGreaterThan(2950);
    expect(probe.durationMs).toBeLessThan(3050);
    const peaks = await computeWaveform(cfg, joined, 200, 'wav');
    expect(peaks).toHaveLength(200);
    const head = peaks.slice(0, 120);
    const tail = peaks.slice(140);
    expect(Math.min(...head)).toBeGreaterThan(0.05);
    expect(Math.max(...tail)).toBeLessThan(0.01);
    expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
  });

  it('chuẩn hoá audio → MP3 48 kbps mono 24 kHz, giữ thời lượng', async () => {
    const src = path.join(tmp, 'stereo.ogg');
    const out = path.join(tmp, 'norm.mp3');
    await generateTestMedia(cfg, { kind: 'sine', durationMs: 4000, format: 'ogg', sampleRate: 44100 }, src);
    await normalizeAudio(cfg, src, 'ogg', out);
    const p = await probeMedia(cfg, out, 'mp3');
    const a = p.streams.find((s) => s.codecType === 'audio')!;
    expect(a.codecName).toBe('mp3');
    expect(a.channels).toBe(1);
    expect(a.sampleRate).toBe(24000);
    expect(Math.abs((p.bitRate ?? 0) - 48000)).toBeLessThan(4000);
    expect(Math.abs((p.durationMs ?? 0) - 4000)).toBeLessThan(120);
  });

  it('ảnh → WebP + thumbnail 320 px (không phóng to ảnh nhỏ)', async () => {
    const png = path.join(tmp, 'big.png');
    const small = path.join(tmp, 'small.jpg');
    await generateTestMedia(cfg, { kind: 'image', width: 800, height: 600, format: 'png' }, png);
    await generateTestMedia(cfg, { kind: 'image', width: 200, height: 100, format: 'jpeg' }, small);
    await convertImageToWebp(cfg, png, 'png_pipe', path.join(tmp, 'big.webp'));
    await convertImageToWebp(cfg, png, 'png_pipe', path.join(tmp, 'big-thumb.webp'), 320);
    await convertImageToWebp(cfg, small, 'jpeg_pipe', path.join(tmp, 'small-thumb.webp'), 320);
    const dim = async (f: string) => (await probeMedia(cfg, path.join(tmp, f), 'webp_pipe')).streams[0]!;
    expect(await dim('big.webp')).toMatchObject({ codecName: 'webp', width: 800, height: 600 });
    expect(await dim('big-thumb.webp')).toMatchObject({ width: 320, height: 240 });
    expect(await dim('small-thumb.webp')).toMatchObject({ width: 200, height: 100 });
  });
});
