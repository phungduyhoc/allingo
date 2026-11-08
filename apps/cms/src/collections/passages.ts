import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { describeError, syncPassage } from '../lib/internal-api';
import { mergedBody, toSyncPassage, type PassageDocLike } from '../lib/passages';
import { DIFFICULTY_CODES, PROGRAM_OPTIONS } from '../lib/reference';

/** B5: passage có ≥ 2 văn bản → body = bản gộp `[Tiêu đề]` (dự phòng cho client cũ/AI giải thích, giống catalog) */
const mergeParts: CollectionBeforeChangeHook = ({ data }) => {
  const parts = (data.parts ?? []) as Array<{ title?: string | null; body?: string | null }>;
  if (parts.filter((p) => (p.body ?? '').trim()).length >= 2) data.body = mergedBody(parts);
  return data;
};

/** B5: mỗi lần lưu → catalog.passages + passage_parts (API nội bộ). API chưa chạy → lưu CMS vẫn thành công, câu hỏi đồng bộ lại sau */
const syncToCatalog: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if ((context as { skipCatalogSync?: boolean }).skipCatalogSync) return doc;
  try {
    await syncPassage(toSyncPassage(doc as PassageDocLike));
  } catch (err) {
    req.payload.logger.warn({ msg: 'catalog passage sync deferred', err: describeError(err) });
  }
  return doc;
};

/** Đoạn văn/script/ảnh đề dùng chung cho nhóm câu (Part 3/4/6/7, IELTS Reading); B5: bộ đôi/bộ ba Part 7 nhập từng văn bản */
export const Passages: CollectionConfig = {
  slug: 'passages',
  labels: { singular: { vi: 'Đoạn văn / script', en: 'Passage' }, plural: { vi: 'Đoạn văn / script', en: 'Passages' } },
  admin: { useAsTitle: 'title', group: { vi: 'Nội dung', en: 'Content' }, defaultColumns: ['title', 'program', 'kind', 'status', 'updatedAt'] },
  access: { read: isLoggedIn, create: isLoggedIn, update: isLoggedIn, delete: isAdmin },
  hooks: { beforeChange: [mergeParts], afterChange: [syncToCatalog] },
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
    { name: 'body', type: 'textarea', label: { vi: 'Nội dung (markdown nhẹ)', en: 'Body (light markdown)' }, admin: { rows: 12, description: { vi: 'Passage nhiều văn bản: tự tạo từ "Các văn bản" bên dưới khi có ≥ 2 văn bản.', en: 'Multi-text passages: generated from "Texts" below when there are ≥ 2 texts.' } } },
    {
      name: 'parts',
      type: 'array',
      label: { vi: 'Các văn bản (TOEIC Part 7 bộ đôi/bộ ba)', en: 'Texts (TOEIC Part 7 double/triple)' },
      labels: { singular: { vi: 'Văn bản', en: 'Text' }, plural: { vi: 'Văn bản', en: 'Texts' } },
      maxRows: 5,
      admin: {
        initCollapsed: false,
        description: {
          vi: 'Mỗi văn bản một mục theo đúng thứ tự (kéo để đổi thứ tự) – người học thấy tab từng văn bản. Đoạn đơn: để trống, chỉ nhập "Nội dung".',
          en: 'One entry per text, in order (drag to reorder) – learners see one tab per text. Single passage: leave empty and use "Body".',
        },
      },
      fields: [
        { name: 'title', type: 'text', label: { vi: 'Tiêu đề tab (vd. E-mail, Notice)', en: 'Tab title (e.g. E-mail, Notice)' } },
        { name: 'body', type: 'textarea', required: true, label: { vi: 'Nội dung văn bản', en: 'Text body' }, admin: { rows: 8 } },
      ],
    },
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
