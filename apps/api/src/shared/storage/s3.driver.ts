import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../../config/env.js';
import { StorageNotFoundError, type Bucket, type HeadObjectResult, type PresignPutOptions, type PutObjectOptions, type StorageDriver } from './storage.types.js';

const isNotFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

/** S3-compatible (MinIO dev, R2/S3 staging-prod). URL ký mặc định 10 phút (CLAUDE.md §9). */
export class S3StorageDriver implements StorageDriver {
  readonly kind = 's3' as const;
  readonly client: S3Client;

  constructor(private readonly env: Env) {
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    });
  }

  bucketName(bucket: Bucket): string {
    return bucket === 'media' ? this.env.S3_BUCKET_MEDIA : this.env.S3_BUCKET_RECORDINGS;
  }

  async putObject(bucket: Bucket, key: string, body: Buffer, opts: PutObjectOptions): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, Body: body, ContentType: opts.contentType, CacheControl: opts.cacheControl, ContentLength: body.length }));
  }

  async putFile(bucket: Bucket, key: string, filePath: string, opts: PutObjectOptions): Promise<void> {
    const st = await fsp.stat(filePath);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, Body: fs.createReadStream(filePath), ContentType: opts.contentType, CacheControl: opts.cacheControl, ContentLength: st.size }));
  }

  async getObject(bucket: Bucket, key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
      if (!res.Body) throw new StorageNotFoundError(bucket, key);
      return res.Body as Readable;
    } catch (err) {
      if (isNotFound(err)) throw new StorageNotFoundError(bucket, key);
      throw err;
    }
  }

  async headObject(bucket: Bucket, key: string): Promise<HeadObjectResult | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
      return { size: Number(res.ContentLength ?? 0), contentType: res.ContentType ?? null, etag: res.ETag?.replace(/"/g, '') ?? null, lastModified: res.LastModified ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(bucket: Bucket, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucketName(bucket), Key: key }));
  }

  async presignPut(bucket: Bucket, key: string, opts: PresignPutOptions & { ttlSec: number }): Promise<string> {
    const cmd = new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, ContentType: opts.contentType, ContentLength: opts.contentLength });
    // Ký cả content-type và content-length: S3 từ chối tệp khác kích thước/kiểu đã khai báo (giới hạn 20 MB thực thi ở server)
    const signableHeaders = new Set(['content-type', ...(opts.contentLength !== undefined ? ['content-length'] : [])]);
    return getSignedUrl(this.client, cmd, { expiresIn: opts.ttlSec, signableHeaders });
  }

  async presignGet(bucket: Bucket, key: string, ttlSec: number): Promise<string> {
    if (bucket === 'media' && this.env.S3_PUBLIC_BASE_URL) return `${this.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }), { expiresIn: ttlSec });
  }
}
