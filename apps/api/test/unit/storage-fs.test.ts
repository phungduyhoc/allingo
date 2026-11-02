import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deriveFsSigningKey, FsStorageDriver, isSafeKey, resolveStorageDriver, verifyFsRequest } from '../../src/shared/storage/storage.module.js';
import { parseRange } from '../../src/shared/storage/fs-routes.js';

const SECRET = 'unit-test-secret-at-least-32-characters!!';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'allingo-fs-unit-'));
const driver = new FsStorageDriver({ rootDir: root, publicBaseUrl: 'http://api.test', secret: SECRET, bucketNames: { media: 'm-bucket', recordings: 'r-bucket', invoices: 'i-bucket' } });

/** Tách URL ký thành tham số verify */
function parts(url: string) {
  const u = new URL(url);
  const m = /^\/v1\/storage\/fs\/([^/]+)\/(.+)$/.exec(u.pathname)!;
  return { bucket: m[1]!, objectKey: decodeURIComponent(m[2]!), query: Object.fromEntries(u.searchParams.entries()) as Record<string, unknown> };
}

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe('storage driver fs – chữ ký HMAC + hạn', () => {
  it('URL PUT/GET hợp lệ được chấp nhận, đúng tham số đã ký', async () => {
    const put = await driver.presignPut('recordings', 'rec/2026/11/a.webm', { contentType: 'audio/webm', contentLength: 1234, ttlSec: 600 });
    expect(put.startsWith('http://api.test/v1/storage/fs/recordings/rec/2026/11/a.webm?')).toBe(true);
    const p = parts(put);
    const r = verifyFsRequest(driver.signingKey, { method: 'PUT', ...p });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.params).toMatchObject({ bucket: 'recordings', key: 'rec/2026/11/a.webm', contentType: 'audio/webm', maxBytes: 1234 });
    const get = parts(await driver.presignGet('media', 'content/x/audio.mp3', 600));
    expect(verifyFsRequest(driver.signingKey, { method: 'GET', ...get }).ok).toBe(true);
  });

  it('giả mạo key/kích thước/phương thức hoặc khoá khác → bad_signature', async () => {
    const p = parts(await driver.presignPut('media', 'content/a/original.wav', { contentType: 'audio/wav', contentLength: 10, ttlSec: 600 }));
    expect(verifyFsRequest(driver.signingKey, { method: 'PUT', ...p, objectKey: 'content/b/original.wav' })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyFsRequest(driver.signingKey, { method: 'PUT', ...p, query: { ...p.query, max: '999999' } })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyFsRequest(driver.signingKey, { method: 'GET', ...p })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyFsRequest(driver.signingKey, { method: 'PUT', ...p, bucket: 'recordings' })).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyFsRequest(deriveFsSigningKey('another-secret-another-secret-xxxxxxxx'), { method: 'PUT', ...p }).ok).toBe(false);
  });

  it('hết hạn → expired; thiếu tham số / key traversal → malformed', async () => {
    const p = parts(await driver.presignGet('media', 'content/a/audio.mp3', 60));
    const future = Math.floor(Date.now() / 1000) + 61;
    expect(verifyFsRequest(driver.signingKey, { method: 'GET', ...p }, future)).toEqual({ ok: false, reason: 'expired' });
    expect(verifyFsRequest(driver.signingKey, { method: 'GET', ...p, query: { exp: p.query.exp } })).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyFsRequest(driver.signingKey, { method: 'GET', ...p, objectKey: '../../etc/passwd' })).toEqual({ ok: false, reason: 'malformed' });
    expect(isSafeKey('a/../b')).toBe(false);
    expect(isSafeKey('/abs')).toBe(false);
    expect(isSafeKey('ok/key-1_2.mp3')).toBe(true);
    await expect(driver.presignGet('media', '../x', 60)).rejects.toThrow();
  });

  it('put/head/get/delete khứ hồi trên đĩa; .gitignore tự tạo', async () => {
    await driver.putObject('media', 'tts/ab/abc.mp3', Buffer.from('hello-bytes'), { contentType: 'audio/mpeg' });
    expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('*');
    const head = await driver.headObject('media', 'tts/ab/abc.mp3');
    expect(head).toMatchObject({ size: 11, contentType: 'audio/mpeg' });
    const chunks: Buffer[] = [];
    for await (const c of await driver.getObject('media', 'tts/ab/abc.mp3')) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('hello-bytes');
    await driver.deleteObject('media', 'tts/ab/abc.mp3');
    expect(await driver.headObject('media', 'tts/ab/abc.mp3')).toBeNull();
    await expect(driver.getObject('media', 'tts/ab/abc.mp3')).rejects.toThrow(/not found/i);
  });

  it('chọn driver: rỗng + test → fs; rỗng + dev → s3; đặt rõ thì theo biến', () => {
    expect(resolveStorageDriver({ STORAGE_DRIVER: undefined, APP_ENV: 'test' })).toBe('fs');
    expect(resolveStorageDriver({ STORAGE_DRIVER: undefined, APP_ENV: 'development' })).toBe('s3');
    expect(resolveStorageDriver({ STORAGE_DRIVER: 'fs', APP_ENV: 'development' })).toBe('fs');
    expect(resolveStorageDriver({ STORAGE_DRIVER: 's3', APP_ENV: 'test' })).toBe('s3');
  });

  it('parseRange: đoạn đầu/cuối/hậu tố và không hợp lệ', () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=100-120', 100)).toBe('invalid');
    expect(parseRange('items=0-1', 100)).toBe('invalid');
  });
});
