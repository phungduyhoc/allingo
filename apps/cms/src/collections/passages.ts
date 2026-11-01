import type { CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { DIFFICULTY_CODES, PROGRAM_OPTIONS } from '../lib/reference';

/** Đoạn văn/script/ảnh đề dùng chung cho nhóm câu (Part 3/4/6/7, IELTS Reading) */
export const Passages: CollectionConfig = {
  slug: 'passages',
  labels: { singular: { vi: 'Đoạn văn / script', en: 'Passage' }, plural: { vi: 'Đoạn văn / script', en: 'Passages' } },
  admin: { useAsTitle: 'title', group: { vi: 'Nội dung', en: 'Content' }, defaultColumns: ['title', 'program', 'kind', 'status', 'updatedAt'] },
  access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  fields: [
    { name: 'title', type: 'text', required: true, label: { vi: 'Tiêu đề (nội bộ)', en: 'Title' } },
    {
      type: 'row',
      fields: [
        { name: 'program', type: 'select', required: true, options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình', en: 'Program' } },
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'reading_passage',
          options: [
            { label: { vi: 'Đoạn đọc', en: 'Reading passage' }, value: 'reading_passage' },
            { label: { vi: 'Script audio', en: 'Audio script' }, value: 'audio_script' },
            { label: { vi: 'Ảnh đề', en: 'Image prompt' }, value: 'image_prompt' },
            { label: { vi: 'Biểu đồ', en: 'Chart prompt' }, value: 'chart_prompt' },
            { label: { vi: 'Hội thoại', en: 'Dialogue' }, value: 'dialogue' },
          ],
          label: { vi: 'Loại', en: 'Kind' },
        },
        { name: 'difficulty', type: 'select', options: DIFFICULTY_CODES.map((d) => ({ label: d, value: d })), label: { vi: 'Độ khó', en: 'Difficulty' } },
      ],
    },
    { name: 'body', type: 'textarea', label: { vi: 'Nội dung (markdown nhẹ)', en: 'Body (light markdown)' }, admin: { rows: 12 } },
    { name: 'media', type: 'relationship', relationTo: 'media', hasMany: true, label: { vi: 'Media đính kèm', en: 'Media' } },
    { name: 'wordCount', type: 'number', min: 0, label: { vi: 'Số từ', en: 'Word count' }, admin: { position: 'sidebar' } },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: { vi: 'Nháp', en: 'Draft' }, value: 'draft' },
        { label: { vi: 'Sẵn sàng', en: 'Ready' }, value: 'ready' },
        { label: { vi: 'Ngừng dùng', en: 'Retired' }, value: 'retired' },
      ],
      label: { vi: 'Trạng thái', en: 'Status' },
      admin: { position: 'sidebar' },
    },
  ],
};
