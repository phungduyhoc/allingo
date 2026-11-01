import { Global, Inject, Injectable, Module } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV, type Env } from '../../config/env.js';

export type Bucket = 'media' | 'recordings';

/** S3-compatible (MinIO dev). URL ký 10 phút (CLAUDE.md §9). */
@Injectable()
export class StorageService {
  readonly client: S3Client;
  constructor(@Inject(ENV) private readonly env: Env) {
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

  async presignGet(bucket: Bucket, key: string, ttlSec = this.env.S3_PRESIGN_TTL_SECONDS): Promise<string> {
    if (bucket === 'media' && this.env.S3_PUBLIC_BASE_URL) return `${this.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucketName(bucket), Key: key }), { expiresIn: ttlSec });
  }

  async presignPut(bucket: Bucket, key: string, contentType: string, ttlSec = this.env.S3_PRESIGN_TTL_SECONDS): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucketName(bucket), Key: key, ContentType: contentType }), { expiresIn: ttlSec });
  }
}

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
