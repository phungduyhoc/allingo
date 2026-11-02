import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Global, Inject, Injectable, Module, Optional, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { ENV, type Env } from '../../config/env.js';
import { getLogger } from '../telemetry/logger.js';
import { FsStorageDriver } from './fs.driver.js';
import { registerFsStorageRoutes } from './fs-routes.js';
import { S3StorageDriver } from './s3.driver.js';
import type { Bucket, HeadObjectResult, PresignPutOptions, PutObjectOptions, StorageDriver, StorageDriverKind } from './storage.types.js';

export * from './storage.types.js';
export { FsStorageDriver, verifyFsRequest, fsSignature, deriveFsSigningKey, FS_ROUTE_PREFIX } from './fs.driver.js';

/** Giới hạn tải lên trực tiếp (OpenAPI /uploads/presign: size_bytes ≤ 20 MB) */
import { MAX_UPLOAD_BYTES } from '@allingo/schemas';

export { MAX_UPLOAD_BYTES };

/** Driver hiệu lực: STORAGE_DRIVER nếu đặt; rỗng → APP_ENV=test dùng fs, còn lại s3 */
export function resolveStorageDriver(env: Pick<Env, 'STORAGE_DRIVER' | 'APP_ENV'>): StorageDriverKind {
  return env.STORAGE_DRIVER ?? (env.APP_ENV === 'test' ? 'fs' : 's3');
}

/**
 * Lưu trữ đối tượng (CLAUDE.md §9): driver `s3` (MinIO/R2/S3) hoặc `fs` (dev/test, ADR-0025).
 * API chung: putObject/putFile, getObject (stream) / getObjectBuffer, headObject, deleteObject, presignPut, presignGet.
 * URL ký mặc định S3_PRESIGN_TTL_SECONDS (10 phút).
 */
@Injectable()
export class StorageService {
  readonly driver: StorageDriver;
  private readonly logger = getLogger({ component: 'storage' });

  constructor(@Inject(ENV) private readonly env: Env) {
    const kind = resolveStorageDriver(env);
    if (kind === 'fs') {
      if (env.APP_ENV === 'production' || env.APP_ENV === 'staging') this.logger.warn('STORAGE_DRIVER=fs on staging/production is not supported (dev/test only)');
      this.driver = new FsStorageDriver({
        rootDir: env.STORAGE_FS_DIR,
        publicBaseUrl: env.API_PUBLIC_URL,
        secret: env.AUTH_SECRET,
        bucketNames: { media: env.S3_BUCKET_MEDIA, recordings: env.S3_BUCKET_RECORDINGS, invoices: env.S3_BUCKET_INVOICES },
      });
    } else {
      this.driver = new S3StorageDriver(env);
    }
  }

  get driverKind(): StorageDriverKind {
    return this.driver.kind;
  }

  get defaultTtlSec(): number {
    return this.env.S3_PRESIGN_TTL_SECONDS;
  }

  putObject(bucket: Bucket, key: string, body: Buffer, opts: PutObjectOptions): Promise<void> {
    return this.driver.putObject(bucket, key, body, opts);
  }

  putFile(bucket: Bucket, key: string, filePath: string, opts: PutObjectOptions): Promise<void> {
    return this.driver.putFile(bucket, key, filePath, opts);
  }

  /** Stream nội dung; ném StorageNotFoundError nếu không có */
  getObject(bucket: Bucket, key: string): Promise<Readable> {
    return this.driver.getObject(bucket, key);
  }

  async getObjectBuffer(bucket: Bucket, key: string): Promise<Buffer> {
    const stream = await this.driver.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
    return Buffer.concat(chunks);
  }

  /** Tải đối tượng về tệp cục bộ (job xử lý media) */
  async downloadToFile(bucket: Bucket, key: string, filePath: string): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(await this.driver.getObject(bucket, key), fs.createWriteStream(filePath));
  }

  headObject(bucket: Bucket, key: string): Promise<HeadObjectResult | null> {
    return this.driver.headObject(bucket, key);
  }

  async presignGet(bucket: Bucket, key: string, ttlSec = this.env.S3_PRESIGN_TTL_SECONDS): Promise<string> {
    return this.driver.presignGet(bucket, key, ttlSec);
  }

  /** URL PUT có hạn. Tham số thứ 3: Content-Type (tương thích Sprint 0) hoặc tuỳ chọn đầy đủ. */
  async presignPut(bucket: Bucket, key: string, contentTypeOrOpts: string | PresignPutOptions, ttlSec = this.env.S3_PRESIGN_TTL_SECONDS): Promise<string> {
    const opts: PresignPutOptions = typeof contentTypeOrOpts === 'string' ? { contentType: contentTypeOrOpts } : contentTypeOrOpts;
    return this.driver.presignPut(bucket, key, { ...opts, ttlSec: opts.ttlSec ?? ttlSec });
  }

  /** Xoá đối tượng (xoá dữ liệu cá nhân theo iam.deletion_requests). Trả false khi lỗi để caller ghi nhận và thử lại. */
  async deleteObject(bucket: Bucket, key: string): Promise<boolean> {
    try {
      await this.driver.deleteObject(bucket, key);
      return true;
    } catch {
      return false;
    }
  }
}

/** Đăng ký route `/v1/storage/fs/*` khi driver = fs và đang chạy HTTP (worker không có HTTP adapter) */
@Injectable()
export class FsStorageRoutes implements OnModuleInit {
  private readonly logger = getLogger({ component: 'storage' });
  constructor(
    private readonly storage: StorageService,
    @Optional() private readonly adapterHost?: HttpAdapterHost,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!(this.storage.driver instanceof FsStorageDriver)) return;
    const adapter = this.adapterHost?.httpAdapter;
    if (!adapter) return;
    const fastify = adapter.getInstance<FastifyInstance>();
    await registerFsStorageRoutes(fastify, this.storage.driver, { maxBodyBytes: MAX_UPLOAD_BYTES + 64 * 1024 });
    this.logger.info({ root: this.storage.driver.root }, 'storage driver fs: signed routes /v1/storage/fs/* enabled');
  }
}

@Global()
@Module({ providers: [StorageService, FsStorageRoutes], exports: [StorageService] })
export class StorageModule {}
