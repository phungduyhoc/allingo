import type { Readable } from 'node:stream';

/** Bucket logic: `media` (nội dung, có thể qua CDN) · `recordings` (dữ liệu cá nhân, chỉ URL ký 10 phút – CLAUDE.md §9) */
export type Bucket = 'media' | 'recordings';
export const BUCKETS: readonly Bucket[] = ['media', 'recordings'];

export type StorageDriverKind = 's3' | 'fs';

export interface PutObjectOptions {
  contentType: string;
  cacheControl?: string;
}

export interface PresignPutOptions {
  contentType: string;
  /** Kích thước khai báo – S3: ký header Content-Length (phải khớp đúng); fs: giới hạn tối đa */
  contentLength?: number;
  ttlSec?: number;
}

export interface HeadObjectResult {
  size: number;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

/** Không tìm thấy đối tượng (getObject) */
export class StorageNotFoundError extends Error {
  constructor(
    readonly bucket: Bucket,
    readonly key: string,
  ) {
    super(`Object not found: ${bucket}/${key}`);
    this.name = 'StorageNotFoundError';
  }
}

/** Driver lưu trữ (S3-compatible hoặc hệ thống tệp cục bộ cho dev/test) */
export interface StorageDriver {
  readonly kind: StorageDriverKind;
  putObject(bucket: Bucket, key: string, body: Buffer, opts: PutObjectOptions): Promise<void>;
  /** Tải tệp cục bộ lên (stream, biết trước kích thước) */
  putFile(bucket: Bucket, key: string, filePath: string, opts: PutObjectOptions): Promise<void>;
  getObject(bucket: Bucket, key: string): Promise<Readable>;
  headObject(bucket: Bucket, key: string): Promise<HeadObjectResult | null>;
  deleteObject(bucket: Bucket, key: string): Promise<void>;
  presignPut(bucket: Bucket, key: string, opts: PresignPutOptions & { ttlSec: number }): Promise<string>;
  presignGet(bucket: Bucket, key: string, ttlSec: number): Promise<string>;
}

/** Kiểm tra storage key an toàn (không traversal, ký tự giới hạn) – key do server sinh */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(key)) return false;
  if (key.startsWith('/') || key.endsWith('/')) return false;
  return key.split('/').every((seg) => seg.length > 0 && seg !== '.' && seg !== '..');
}

/** MIME gốc (bỏ tham số, chữ thường): `audio/webm;codecs=opus` → `audio/webm` */
/** Định nghĩa dùng chung ở @allingo/schemas (hợp đồng tải lên) */
export { baseMime } from '@allingo/schemas';
