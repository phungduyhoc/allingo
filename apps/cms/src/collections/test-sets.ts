import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload';
import { ValidationError } from 'payload';
import { isAdmin, isLoggedIn, isReviewer, roleOf } from '../lib/access';
import type { TestSet } from '../payload-types';
import { describeError, publishTestSet } from '../lib/internal-api';
import { PROGRAM_OPTIONS, TOEIC_SECTIONS } from '../lib/reference';
import { catalogLevelOf, findUnpublishedItems, relationshipId, testSetCheckIssues, validateTestSetStructure, type ItemCheckInfo, type TestSetShape } from '../lib/validate';
import { blueprintErrors, blueprintReport, countsByMarks, countUnitLabel, marksOfContent } from '../lib/test-set-builder';
import { testSetStructureEndpoint } from '../endpoints/test-set-structure';

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

/** C3 – hình thức IELTS Reading (→ catalog.test_sets.level): bảng quy đổi band Reading Academic/GT khác nhau */
export const IELTS_MODULE_OPTIONS = [
  { label: { vi: 'Academic', en: 'Academic' }, value: 'academic' },
  { label: { vi: 'General Training', en: 'General Training' }, value: 'general_training' },
] as const;

/** Media audio của passage (relationship hasMany đã populate depth 1) */
function passageAudioId(media: unknown): string | null {
  if (!Array.isArray(media)) return null;
  for (const m of media) if (m && typeof m === 'object' && (m as { kind?: unknown }).kind === 'audio' && 'id' in m) return String((m as { id: unknown }).id);
  return null;
}

/**
 * C3 – thông tin kiểm tra cấp bộ đề cho từng câu: content (số mục) + audio của câu (`content.media.audio_asset_id`) hoặc của passage
 * script (media kind = audio).
 */
async function loadCheckInfo(req: PayloadRequest, docs: ReadonlyArray<{ id: unknown; content?: unknown; passage?: unknown }>): Promise<Map<string, ItemCheckInfo>> {
  const passageIds = [...new Set(docs.map((q) => relationshipId(q.passage)).filter((v): v is string => v !== null))];
  const audioByPassage = new Map<string, string | null>();
  if (passageIds.length) {
    const ps = await req.payload.find({ collection: 'passages', where: { id: { in: passageIds } }, limit: passageIds.length, depth: 1, req, overrideAccess: true, pagination: false });
    for (const p of ps.docs) audioByPassage.set(String(p.id), passageAudioId(p.media));
  }
  const out = new Map<string, ItemCheckInfo>();
  for (const q of docs) {
    const media = q.content && typeof q.content === 'object' ? (q.content as { media?: { audio_asset_id?: unknown } }).media : undefined;
    const own = typeof media?.audio_asset_id === 'string' ? media.audio_asset_id : null;
    const fromPassage = audioByPassage.get(relationshipId(q.passage) ?? '') ?? null;
    const audioKey = fromPassage ?? own;
    out.set(String(q.id), { content: q.content, hasAudio: audioKey !== null, audioKey });
  }
  return out;
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
  const perItem = countsByMarks(shape.program);
  let checkInfo = new Map<string, ItemCheckInfo>();
  if (ids.length) {
    const found = await req.payload.find({ collection: 'questions', where: { id: { in: ids } }, limit: ids.length, depth: 0, req, overrideAccess: true, pagination: false });
    for (const q of found.docs) {
      statusById.set(String(q.id), String(q.status));
      if (q.externalRef) refById.set(String(q.id), String(q.externalRef));
    }
    if (perItem) checkInfo = await loadCheckInfo(req, found.docs);
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
    // A26/B5: blueprint (nếu khai báo) – đủ đúng số câu mỗi Part trước khi xuất bản (C3: IELTS đếm theo câu hỏi/mục)
    const bp = (merged.blueprint ?? []).filter((b) => b.sectionCode && typeof b.count === 'number').map((b) => ({ sectionCode: b.sectionCode, count: b.count }));
    if (bp.length) {
      const marksOf = perItem ? (qid: string) => (checkInfo.has(qid) ? marksOfContent(checkInfo.get(qid)!.content) : 1) : undefined;
      const items = shape.items.map((it) => ({ sectionCode: it.sectionCode, question: relationshipId(it.question) ?? '' }));
      const errs = blueprintErrors(blueprintReport(bp, { items }, marksOf), countUnitLabel(shape.program));
      if (errs.length) fail('blueprint', `Chưa đạt blueprint: ${errs.join(' ')}`, req);
    }
    // C3: kiểm tra tự động cấp bộ đề (40 câu hỏi, số mục từng part/passage, đánh số liên tục, audio mỗi part Listening)
    if (perItem) {
      const checks = testSetCheckIssues(shape, checkInfo);
      if (checks.errors.length) fail('items', `Chưa đạt kiểm tra bộ đề: ${checks.errors.join(' ')}`, req);
    }
    if (shape.program === 'ielts' && !merged.ieltsModule && shape.items.some((it) => it.sectionCode.startsWith('reading_'))) {
      fail('ieltsModule', 'Đề IELTS có Reading phải chọn hình thức Academic hoặc General Training (bảng quy đổi band khác nhau).', req);
    }
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
        level: catalogLevelOf(merged),
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
      vi: 'TOEIC full cần đủ Part 1–7 (6/25/39/30/30/16/54 câu). IELTS full đếm theo câu hỏi (mục đánh số): Reading 3 passage 13/13/14 = 40, Listening 4 part × 10 = 40, mỗi part Listening có audio; đề có Reading chọn Academic/General Training. Mini/part_drill ≥ 1 câu. Mọi câu phải đã phát hành. Dùng "Trình dựng kéo thả" để sắp xếp Part/nhóm/câu và kiểm tra blueprint.',
      en: 'TOEIC full requires Part 1–7 (6/25/39/30/30/16/54). IELTS full counts numbered questions: Reading 3 passages 13/13/14 = 40, Listening 4 parts × 10 = 40, every listening part has audio; tests with Reading pick Academic/General Training. Mini/part_drill ≥ 1 item. All items must be published. Use the drag-and-drop builder to order parts/groups/items and check the blueprint.',
    },
    components: { edit: { beforeDocumentControls: ['/components/test-set-builder-link#TestSetBuilderLink'] } },
  },
  access: { read: isLoggedIn, create: isReviewer, update: isReviewer, delete: isAdmin },
  endpoints: [testSetStructureEndpoint],
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
        {
          // C3: catalog.test_sets.level – bảng band Reading Academic/GT khác nhau; đề chỉ Listening để trống
          name: 'ieltsModule',
          type: 'select',
          options: [...IELTS_MODULE_OPTIONS],
          label: { vi: 'Hình thức IELTS (Reading)', en: 'IELTS module (Reading)' },
          admin: { condition: (d) => (d as TestSetData | undefined)?.program === 'ielts' },
        },
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
      // A26/B5: số câu mỗi Part bắt buộc khi xuất bản (trống = chỉ kiểm cấu trúc theo loại đề)
      name: 'blueprint',
      type: 'array',
      label: { vi: 'Blueprint (số câu mỗi Part)', en: 'Blueprint (questions per part)' },
      admin: { initCollapsed: true, description: { vi: 'Trình dựng kéo thả chặn xuất bản khi số câu từng Part lệch blueprint.', en: 'Publishing is blocked when a part does not match the blueprint.' } },
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'sectionCode', type: 'text', required: true, label: 'section_code' },
            { name: 'count', type: 'number', required: true, min: 1, max: 200, label: { vi: 'Số câu (IELTS: số câu hỏi/mục)', en: 'Count (IELTS: numbered questions)' } },
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
