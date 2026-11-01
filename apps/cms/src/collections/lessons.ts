import type { CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { PROGRAM_OPTIONS } from '../lib/reference';

/** Bài học (đơn giản cho Sprint 0) – đồng bộ sang catalog.lessons ở Sprint 1 */
export const Lessons: CollectionConfig = {
  slug: 'lessons',
  labels: { singular: { vi: 'Bài học', en: 'Lesson' }, plural: { vi: 'Bài học', en: 'Lessons' } },
  admin: { useAsTitle: 'code', group: { vi: 'Nội dung', en: 'Content' }, defaultColumns: ['code', 'program', 'kind', 'status', 'updatedAt'] },
  access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'code', type: 'text', required: true, unique: true, label: { vi: 'Mã bài', en: 'Code' } },
        { name: 'program', type: 'select', required: true, defaultValue: 'toeic', options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình', en: 'Program' } },
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'lesson',
          options: [
            { label: { vi: 'Bài học', en: 'Lesson' }, value: 'lesson' },
            { label: { vi: 'Ngữ pháp', en: 'Grammar' }, value: 'grammar' },
            { label: { vi: 'Phát âm', en: 'Pronunciation' }, value: 'pronunciation' },
            { label: { vi: 'Chiến lược', en: 'Strategy' }, value: 'strategy' },
          ],
          label: { vi: 'Loại', en: 'Kind' },
        },
      ],
    },
    {
      name: 'title',
      type: 'group',
      label: { vi: 'Tiêu đề', en: 'Title' },
      fields: [
        { name: 'vi', type: 'text', required: true, label: 'Tiếng Việt' },
        { name: 'en', type: 'text', label: 'English' },
      ],
    },
    {
      name: 'summary',
      type: 'group',
      label: { vi: 'Tóm tắt', en: 'Summary' },
      fields: [
        { name: 'vi', type: 'textarea', label: 'Tiếng Việt' },
        { name: 'en', type: 'textarea', label: 'English' },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'estMinutes', type: 'number', min: 1, defaultValue: 10, label: { vi: 'Thời lượng ước tính (phút)', en: 'Estimated minutes' } },
        { name: 'isFree', type: 'checkbox', defaultValue: false, label: { vi: 'Miễn phí', en: 'Free' } },
      ],
    },
    {
      name: 'steps',
      type: 'array',
      label: { vi: 'Các bước', en: 'Steps' },
      fields: [
        {
          name: 'type',
          type: 'select',
          required: true,
          defaultValue: 'text',
          options: [
            { label: { vi: 'Văn bản (markdown {vi,en})', en: 'Text' }, value: 'text' },
            { label: { vi: 'Luyện tập ({question_keys})', en: 'Practice' }, value: 'practice' },
          ],
        },
        { name: 'content', type: 'json', required: true, label: { vi: 'Nội dung bước (JSON)', en: 'Step content (JSON)' } },
      ],
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        { label: { vi: 'Nháp', en: 'Draft' }, value: 'draft' },
        { label: { vi: 'Đã phát hành', en: 'Published' }, value: 'published' },
        { label: { vi: 'Ngừng dùng', en: 'Retired' }, value: 'retired' },
      ],
      label: { vi: 'Trạng thái', en: 'Status' },
      admin: { position: 'sidebar' },
    },
  ],
};
