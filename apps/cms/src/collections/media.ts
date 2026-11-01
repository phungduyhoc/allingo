import path from 'node:path';
import type { CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';

/**
 * Tệp media soạn thảo (audio Listening, ảnh Part 1, biểu đồ). Lưu cục bộ `apps/cms/media/`;
 * khi phát hành, job đồng bộ (Sprint 1) đẩy lên S3 bucket `media` và tạo catalog.media_assets.
 */
export function buildMedia(mediaDir: string): CollectionConfig {
  return {
    slug: 'media',
    labels: { singular: { vi: 'Tệp media', en: 'Media' }, plural: { vi: 'Tệp media', en: 'Media' } },
    admin: { useAsTitle: 'filename', group: { vi: 'Nội dung', en: 'Content' }, defaultColumns: ['filename', 'kind', 'license', 'updatedAt'] },
    access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
    upload: {
      staticDir: path.resolve(mediaDir),
      mimeTypes: ['audio/*', 'image/*'],
      imageSizes: [{ name: 'thumbnail', width: 320, height: 240, position: 'centre' }],
      adminThumbnail: 'thumbnail',
    },
    fields: [
      {
        name: 'kind',
        type: 'select',
        required: true,
        defaultValue: 'audio',
        options: [
          { label: 'Audio', value: 'audio' },
          { label: { vi: 'Ảnh', en: 'Image' }, value: 'image' },
        ],
        label: { vi: 'Loại', en: 'Kind' },
      },
      { name: 'durationMs', type: 'number', min: 0, label: { vi: 'Thời lượng (ms)', en: 'Duration (ms)' }, admin: { condition: (data) => data?.kind === 'audio' } },
      {
        name: 'license',
        type: 'text',
        required: true,
        defaultValue: 'own',
        label: { vi: 'Giấy phép', en: 'License' },
        admin: { description: { vi: 'own | cc-by | licensed:<mã hợp đồng>. Không dùng audio/ảnh của ETS/Cambridge.', en: 'own | cc-by | licensed:<ref>' } },
        validate: (value: unknown) => {
          const v = typeof value === 'string' ? value.trim() : '';
          if (v === 'own' || v === 'cc-by' || /^licensed:[\w.-]+$/.test(v)) return true;
          return 'Giấy phép phải là own, cc-by hoặc licensed:<mã>.';
        },
      },
      { name: 'transcript', type: 'textarea', label: { vi: 'Transcript / mô tả', en: 'Transcript / description' } },
      { name: 'alt', type: 'text', label: { vi: 'Văn bản thay thế (ảnh)', en: 'Alt text' } },
      { name: 'syncedAssetId', type: 'text', label: { vi: 'catalog.media_assets.id (sau đồng bộ)', en: 'Synced asset id' }, admin: { readOnly: true, position: 'sidebar' } },
    ],
  };
}
