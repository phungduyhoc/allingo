import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload';
import { ValidationError } from 'payload';
import { isAdmin, isLoggedIn, isReviewer, roleOf } from '../lib/access';
import type { TestSet } from '../payload-types';
import { describeError, publishTestSet } from '../lib/internal-api';
import { PROGRAM_OPTIONS, TOEIC_SECTIONS } from '../lib/reference';
import { findUnpublishedItems, relationshipId, validateTestSetStructure, type TestSetShape } from '../lib/validate';

/**
 * Bộ đề soạn trong CMS; khi `published` gọi `POST /internal/content/test-sets/publish` (ADR-0019).
 * Ràng buộc: TOEIC full đủ Part 1–7 đúng số câu; mini/part_drill ≥ 1 câu; mọi câu phải đã `published`.
 */

/** `data` là Partial<TestSet>, `originalDoc` là TestSet (payload-types.ts) */
type TestSetData = Partial<TestSet>;

function fail(path: string, message: string, req: PayloadRequest): never {
  throw new ValidationError({ collection: 'test_sets', errors: [{ path, message }], req });
}

function toShape(d: TestSetData): TestSetShape {
  return {
    program: d.program ?? 'toeic',
    kind: d.kind ?? 'mini',
    sections: (d.sections ?? []).map((s) => ({ sectionCode: s.sectionCode ?? '', durationSec: s.durationSec ?? null })),
    items: (d.items ?? []).map((it) => ({ question: it.question, sectionCode: it.sectionCode ?? '', sortOrder: it.sortOrder ?? 0, groupKey: it.groupKey ?? null, points: it.points ?? null })),
  };
}

const validateAndPublish: CollectionBeforeChangeHook<TestSet> = async ({ data, operation, originalDoc, req }) => {
  const ctx = req.context as { skipWorkflow?: boolean };
  const original = originalDoc;
  const merged: TestSetData = { ...original, ...data };
  const shape = toShape(merged);

  const structural = validateTestSetStructure(shape);
  if (structural.length) fail('items', structural.join(' '), req);

  // Mọi câu trong items phải đã published (đã có trong catalog)
  const ids = Array.from(new Set(shape.items.map((it) => relationshipId(it.question)).filter((v): v is string => v !== null)));
  const statusById = new Map<string, string>();
  const refById = new Map<string, string>();
  if (ids.length) {
    const found = await req.payload.find({ collection: 'questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, req, overrideAccess: true, pagination: false });
    for (const q of found.docs) {
      statusById.set(String(q.id), String(q.status));
      if (q.externalRef) refById.set(String(q.id), String(q.externalRef));
    }
  }
  const unpublished = findUnpublishedItems(shape.items, statusById);
  if (unpublished.length && !ctx.skipWorkflow) {
    const list = unpublished.slice(0, 5).map((u) => `#${u.index + 1} (${u.status ?? 'không tìm thấy'})`);
    fail('items', `Mọi câu trong bộ đề phải ở trạng thái "published". Chưa đạt: ${list.join(', ')}${unpublished.length > 5 ? ` và ${unpublished.length - 5} câu khác` : ''}.`, req);
  }

  const from = original?.status ?? 'draft';
  const to = data.status ?? from;
  if (ctx.skipWorkflow) return data;

  const role = roleOf(req);
  if (to === 'published' && from !== 'published') {
    if (role !== 'teacher' && role !== 'admin') fail('status', 'Chỉ teacher/admin được phát hành bộ đề.', req);
    if (operation === 'create') fail('status', 'Lưu bộ đề ở trạng thái nháp trước, rồi phát hành.', req);
    const externalRef = merged.externalRef ?? (original?.id ? String(original.id) : null);
    if (!externalRef) fail('status', 'Thiếu externalRef – lưu bộ đề trước khi phát hành.', req);
    const missingRef = ids.filter((id) => !refById.get(id));
    if (missingRef.length) fail('items', `Câu hỏi thiếu externalRef: ${missingRef.join(', ')}.`, req);
    try {
      const res = await publishTestSet({
        external_ref: externalRef,
        program: shape.program,
        code: merged.code ?? '',
        title: { vi: merged.title?.vi ?? '', en: merged.title?.en ?? merged.title?.vi ?? '' },
        kind: shape.kind,
        is_free: merged.isFree === true,
        duration_sec: merged.durationSec ?? null,
        sections: shape.sections.map((s) => ({ section_code: s.sectionCode, duration_sec: s.durationSec ?? null })),
        items: shape.items.map((it) => ({
          question_external_ref: refById.get(relationshipId(it.question) ?? '') ?? '',
          section_code: it.sectionCode,
          sort_order: it.sortOrder,
          group_key: it.groupKey ?? null,
          points: it.points ?? 1,
        })),
      });
      data.publishedRef = { testSetId: res.test_set_id, publishedAt: new Date().toISOString() };
    } catch (err) {
      fail('status', `Phát hành bộ đề thất bại, giữ trạng thái nháp. ${describeError(err)}`, req);
    }
  }
  return data;
};

export const TestSets: CollectionConfig = {
  slug: 'test_sets',
  labels: { singular: { vi: 'Bộ đề', en: 'Test set' }, plural: { vi: 'Bộ đề', en: 'Test sets' } },
  admin: {
    useAsTitle: 'code',
    group: { vi: 'Nội dung', en: 'Content' },
    defaultColumns: ['code', 'program', 'kind', 'isFree', 'status', 'updatedAt'],
    description: {
      vi: 'TOEIC full cần đủ Part 1–7 (6/25/39/30/30/16/54 câu). Mini/part_drill ≥ 1 câu. Mọi câu phải đã phát hành.',
      en: 'TOEIC full requires Part 1–7 (6/25/39/30/30/16/54). Mini/part_drill ≥ 1 item. All items must be published.',
    },
  },
  access: { read: isLoggedIn, create: isReviewer, update: isReviewer, delete: isAdmin },
  hooks: {
    beforeChange: [validateAndPublish],
    afterChange: [
      async ({ doc, operation, req }) => {
        if (operation === 'create' && !doc.externalRef) {
          await req.payload.update({ collection: 'test_sets', id: doc.id, data: { externalRef: String(doc.id) }, req, depth: 0, overrideAccess: true, context: { skipWorkflow: true } });
          return { ...doc, externalRef: String(doc.id) };
        }
        return doc;
      },
    ],
  },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'program', type: 'select', required: true, defaultValue: 'toeic', options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình', en: 'Program' } },
        { name: 'code', type: 'text', required: true, unique: true, label: { vi: 'Mã đề (duy nhất)', en: 'Code (unique)' } },
        {
          name: 'kind',
          type: 'select',
          required: true,
          defaultValue: 'mini',
          options: [
            { label: { vi: 'Đề đầy đủ (full)', en: 'Full' }, value: 'full' },
            { label: { vi: 'Đề mini', en: 'Mini' }, value: 'mini' },
            { label: { vi: 'Luyện theo Part', en: 'Part drill' }, value: 'part_drill' },
            { label: { vi: 'Chẩn đoán', en: 'Diagnostic' }, value: 'diagnostic' },
            { label: { vi: 'Gói chủ đề', en: 'Topic pack' }, value: 'topic_pack' },
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
      type: 'row',
      fields: [
        { name: 'isFree', type: 'checkbox', defaultValue: false, label: { vi: 'Miễn phí', en: 'Free' } },
        { name: 'durationSec', type: 'number', min: 0, label: { vi: 'Thời lượng (giây, trống = không giới hạn)', en: 'Duration (sec)' } },
      ],
    },
    {
      name: 'sections',
      type: 'array',
      required: true,
      minRows: 1,
      label: { vi: 'Các phần', en: 'Sections' },
      admin: { description: { vi: `TOEIC: ${TOEIC_SECTIONS.map((s) => s.code).join(', ')}`, en: `TOEIC: ${TOEIC_SECTIONS.map((s) => s.code).join(', ')}` } },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'sectionCode', type: 'text', required: true, label: 'section_code' },
            { name: 'durationSec', type: 'number', min: 0, label: { vi: 'Thời lượng phần (giây)', en: 'Section duration (sec)' } },
          ],
        },
      ],
    },
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      label: { vi: 'Câu hỏi', en: 'Items' },
      fields: [
        { name: 'question', type: 'relationship', relationTo: 'questions', required: true, label: { vi: 'Câu hỏi (đã phát hành)', en: 'Question (published)' } },
        {
          type: 'row',
          fields: [
            { name: 'sectionCode', type: 'text', required: true, label: 'section_code' },
            { name: 'sortOrder', type: 'number', required: true, min: 0, label: { vi: 'Thứ tự', en: 'Sort order' } },
            { name: 'groupKey', type: 'text', label: { vi: 'Nhóm (passage)', en: 'Group key' } },
            { name: 'points', type: 'number', min: 0, defaultValue: 1, label: { vi: 'Điểm', en: 'Points' } },
          ],
        },
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
      ],
      label: { vi: 'Trạng thái', en: 'Status' },
      admin: { position: 'sidebar' },
    },
    { name: 'externalRef', type: 'text', admin: { position: 'sidebar', readOnly: true }, index: true },
    {
      name: 'publishedRef',
      type: 'group',
      label: { vi: 'Tham chiếu catalog', en: 'Catalog reference' },
      admin: { position: 'sidebar', readOnly: true },
      fields: [
        { name: 'testSetId', type: 'text', label: 'test_set_id' },
        { name: 'publishedAt', type: 'date', label: 'published_at' },
      ],
    },
  ],
};
