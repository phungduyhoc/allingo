import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  isSafeKey,
  StorageNotFoundError,
  type Bucket,
  type HeadObjectResult,
  type PresignPutOptions,
  type PutObjectOptions,
  type StorageDriver,
} from './storage.types.js';

/** Đường dẫn route nội bộ phục vụ driver fs (đăng ký trong fs-routes.ts, chỉ khi driver = fs) */
export const FS_ROUTE_PREFIX = '/v1/storage/fs';

export type FsMethod = 'GET' | 'PUT';

export interface FsSignParams {
  method: FsMethod;
  bucket: Bucket;
  key: string;
  /** Hết hạn (giây Unix) */
  exp: number;
  /** PUT: Content-Type đã ký */
  contentType?: string;
  /** PUT: kích thước tối đa (byte) */
  maxBytes?: number;
}

export type FsVerifyResult =
  | { ok: true; params: FsSignParams }
  | { ok: false; reason: 'malformed' | 'expired' | 'bad_signature' };

/** Khoá HMAC dẫn xuất từ AUTH_SECRET (HKDF) – không cần thêm secret riêng cho dev/test */
export function deriveFsSigningKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'allingo', 'storage-fs-v1', 32));
}

function canonical(p: FsSignParams): string {
  return [p.method, p.bucket, p.key, String(p.exp), p.contentType ?? '', p.maxBytes === undefined ? '' : String(p.maxBytes)].join('\n');
}

export function fsSignature(key: Buffer, p: FsSignParams): string {
  return createHmac('sha256', key).update(canonical(p)).digest('base64url');
}

/** Query string ký cho URL fs (exp, ct, max, sig) */
export function fsSignedQuery(key: Buffer, p: FsSignParams): string {
  const q = new URLSearchParams({ exp: String(p.exp) });
  if (p.contentType !== undefined) q.set('ct', p.contentType);
  if (p.maxBytes !== undefined) q.set('max', String(p.maxBytes));
  q.set('sig', fsSignature(key, p));
  return q.toString();
}

export function encodeKeyPath(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

/** Kiểm tra chữ ký + hạn của một request tới route fs. So sánh hằng thời gian. */
export function verifyFsRequest(
  key: Buffer,
  req: { method: FsMethod; bucket: string; objectKey: string; query: Record<string, unknown> },
  nowSec = Math.floor(Date.now() / 1000),
): FsVerifyResult {
  const { query } = req;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const expRaw = str(query.exp);
  const sig = str(query.sig);
  if (!expRaw || !sig || !/^\d{1,12}$/.test(expRaw)) return { ok: false, reason: 'malformed' };
  if (req.bucket !== 'media' && req.bucket !== 'recordings' && req.bucket !== 'invoices') return { ok: false, reason: 'malformed' };
  if (!isSafeKey(req.objectKey)) return { ok: false, reason: 'malformed' };
  const maxRaw = str(query.max);
  if (maxRaw !== undefined && !/^\d{1,12}$/.test(maxRaw)) return { ok: false, reason: 'malformed' };
  const params: FsSignParams = {
    method: req.method,
    bucket: req.bucket,
    key: req.objectKey,
    exp: Number(expRaw),
    contentType: str(query.ct),
    maxBytes: maxRaw === undefined ? undefined : Number(maxRaw),
  };
  const expected = Buffer.from(fsSignature(key, params));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };
  // Kiểm tra hạn SAU chữ ký: không tiết lộ thông tin hạn cho URL giả mạo
  if (params.exp < nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, params };
}

interface FsMeta {
  contentType: string;
  size: number;
  etag: string;
  createdAt: string;
}

/**
 * Driver hệ thống tệp cho dev/test (ADR-0025): `<root>/<bucket>/<key>` + metadata `<root>/.meta/<bucket>/<key>.json`.
 * URL ký HMAC trỏ tới route nội bộ của chính API (`/v1/storage/fs/:bucket/*`). Không dùng cho staging/prod.
 */
export class FsStorageDriver implements StorageDriver {
  readonly kind = 'fs' as const;
  readonly root: string;
  readonly signingKey: Buffer;
  private ensured = false;

  constructor(
    private readonly opts: { rootDir: string; publicBaseUrl: string; secret: string; bucketNames: Record<Bucket, string> },
  ) {
    this.root = path.resolve(opts.rootDir);
    this.signingKey = deriveFsSigningKey(opts.secret);
  }

  /** Tạo thư mục gốc + .gitignore bên trong (tệp tải lên không bao giờ vào git) */
  private async ensureRoot(): Promise<void> {
    if (this.ensured) return;
    await fsp.mkdir(this.root, { recursive: true });
    const gi = path.join(this.root, '.gitignore');
    if (!fs.existsSync(gi)) await fsp.writeFile(gi, '# Thư mục lưu trữ driver fs (dev/test) – không commit\n*\n');
    this.ensured = true;
  }

  /** Đường dẫn tệp dữ liệu; ném lỗi nếu key không an toàn */
  filePath(bucket: Bucket, key: string): string {
    if (!isSafeKey(key)) throw new Error('Unsafe storage key');
    const dir = path.join(this.root, this.opts.bucketNames[bucket]);
    const p = path.join(dir, key);
    if (!p.startsWith(dir + path.sep)) throw new Error('Unsafe storage key');
    return p;
  }

  private metaPath(bucket: Bucket, key: string): string {
    if (!isSafeKey(key)) throw new Error('Unsafe storage key');
    return path.join(this.root, '.meta', this.opts.bucketNames[bucket], `${key}.json`);
  }

  private async writeMeta(bucket: Bucket, key: string, meta: FsMeta): Promise<void> {
    const mp = this.metaPath(bucket, key);
    await fsp.mkdir(path.dirname(mp), { recursive: true });
    await fsp.writeFile(mp, JSON.stringify(meta));
  }

  async putObject(bucket: Bucket, key: string, body: Buffer, opts: PutObjectOptions): Promise<void> {
    await this.ensureRoot();
    const p = this.filePath(bucket, key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomBytes(6).toString('hex')}`;
    await fsp.writeFile(tmp, body);
    await fsp.rename(tmp, p);
    await this.writeMeta(bucket, key, { contentType: opts.contentType, size: body.length, etag: createHash('md5').update(body).digest('hex'), createdAt: new Date().toISOString() });
  }

  async putFile(bucket: Bucket, key: string, filePath: string, opts: PutObjectOptions): Promise<void> {
    await this.ensureRoot();
    const p = this.filePath(bucket, key);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${randomBytes(6).toString('hex')}`;
    const hash = createHash('md5');
    const src = fs.createReadStream(filePath);
    src.on('data', (c) => hash.update(c));
    await pipeline(src, fs.createWriteStream(tmp));
    await fsp.rename(tmp, p);
    const st = await fsp.stat(p);
    await this.writeMeta(bucket, key, { contentType: opts.contentType, size: st.size, etag: hash.digest('hex'), createdAt: new Date().toISOString() });
  }

  async getObject(bucket: Bucket, key: string): Promise<Readable> {
    const p = this.filePath(bucket, key);
    try {
      await fsp.access(p);
    } catch {
      throw new StorageNotFoundError(bucket, key);
    }
    return fs.createReadStream(p);
  }

  /** Đọc một đoạn byte (route GET hỗ trợ Range) */
  createRangeStream(bucket: Bucket, key: string, start: number, end: number): Readable {
    return fs.createReadStream(this.filePath(bucket, key), { start, end });
  }

  async headObject(bucket: Bucket, key: string): Promise<HeadObjectResult | null> {
    let st: fs.Stats;
    try {
      st = await fsp.stat(this.filePath(bucket, key));
    } catch {
      return null;
    }
    let meta: Partial<FsMeta> = {};
    try {
      meta = JSON.parse(await fsp.readFile(this.metaPath(bucket, key), 'utf8')) as FsMeta;
    } catch {
      /* metadata thiếu → vẫn trả kích thước */
    }
    return { size: st.size, contentType: meta.contentType ?? null, etag: meta.etag ?? null, lastModified: st.mtime };
  }

  async deleteObject(bucket: Bucket, key: string): Promise<void> {
    await fsp.rm(this.filePath(bucket, key), { force: true });
    await fsp.rm(this.metaPath(bucket, key), { force: true });
  }

  private url(bucket: Bucket, key: string, p: FsSignParams): string {
    const base = this.opts.publicBaseUrl.replace(/\/$/, '');
    return `${base}${FS_ROUTE_PREFIX}/${bucket}/${encodeKeyPath(key)}?${fsSignedQuery(this.signingKey, p)}`;
  }

  async presignPut(bucket: Bucket, key: string, opts: PresignPutOptions & { ttlSec: number }): Promise<string> {
    if (!isSafeKey(key)) throw new Error('Unsafe storage key');
    const exp = Math.floor(Date.now() / 1000) + opts.ttlSec;
    return this.url(bucket, key, { method: 'PUT', bucket, key, exp, contentType: opts.contentType, maxBytes: opts.contentLength });
  }

  async presignGet(bucket: Bucket, key: string, ttlSec: number): Promise<string> {
    if (!isSafeKey(key)) throw new Error('Unsafe storage key');
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return this.url(bucket, key, { method: 'GET', bucket, key, exp });
  }
}
