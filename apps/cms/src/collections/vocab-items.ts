import type { CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { DIFFICULTY_CODES, PROGRAM_OPTIONS } from '../lib/reference';

/** Từ vựng (catalog.vocab_items) – soạn trong CMS, đồng bộ ở Sprint 1 */
export const VocabItems: CollectionConfig = {
  slug: 'vocab_items',
  labels: { singular: { vi: 'Từ vựng', en: 'Vocab item' }, plural: { vi: 'Từ vựng', en: 'Vocab items' } },
  admin: { useAsTitle: 'headword', group: { vi: 'Nội dung', en: 'Content' }, defaultColumns: ['headword', 'program', 'kind', 'pos', 'level', 'status'] },
  access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'program', type: 'select', required: true, defaultValue: 'toeic', options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình', en: 'Program' } },
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'word',
          options: ['word', 'collocation', 'phrasal_verb', 'kanji', 'hanzi', 'grammar_point'].map((v) => ({ label: v, value: v })),
          label: { vi: 'Loại', en: 'Kind' },
        },
        { name: 'level', type: 'select', options: DIFFICULTY_CODES.map((d) => ({ label: d, value: d })), label: { vi: 'Cấp độ', en: 'Level' } },
      ],
    },
    {
      type: 'row',
      fields: [
        { name: 'headword', type: 'text', required: true, label: { vi: 'Từ', en: 'Headword' } },
        { name: 'pos', type: 'text', label: { vi: 'Từ loại', en: 'Part of speech' } },
        { name: 'ipa', type: 'text', label: 'IPA / reading' },
      ],
    },
    { name: 'meanings', type: 'json', required: true, label: { vi: 'Nghĩa ({vi,en} hoặc mảng)', en: 'Meanings' }, defaultValue: { vi: '', en: '' } },
    { name: 'examples', type: 'json', label: { vi: 'Ví dụ (mảng chuỗi hoặc {text, translation})', en: 'Examples' }, defaultValue: [] },
    { name: 'topicCode', type: 'text', label: { vi: 'Chủ đề', en: 'Topic' } },
    { name: 'audio', type: 'relationship', relationTo: 'media', label: { vi: 'Audio phát âm', en: 'Audio' } },
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
