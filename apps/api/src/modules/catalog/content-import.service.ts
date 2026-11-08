import { createHash, randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import {
  CONTENT_ROLES,
  DRAFT_DIFFICULTY_LEVELS,
  IMPORT_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  JOB_NAMES,
  PROGRAM_CODES,
  contentRoleOf,
  findBatchDuplicates,
  isExampleRow,
  missingImportColumns,
  parseImportRow,
  splitMergedPassage,
  type ContentImportInput,
  type ImportIssue,
  type ImportRowParsed,
  type ProgramCode,
} from '@allingo/schemas';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { AppError, Forbidden, NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { JobsService, type JobContext } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { ContentDedupService, dedupKeyText } from './content-dedup.service.js';
import { ContentPassageService } from './content-passage.service.js';
import { ContentWorkflowService, type Actor } from './content-workflow.service.js';
import { readXlsx, writeXlsx, XlsxError, type SheetSpec } from './import/xlsx.js';

const { catalogSections, catalogTopics, catalogQuestionVersions } = schema;

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEET_NAME = 'Cau_hoi';
const TEMPLATE_ROWS = 500;

interface ImportPayload {
  actor: Actor;
  file_name: string;
  fingerprint: string;
  dry_run: boolean;
  skip_bank_duplicates: boolean;
  rows: Array<{ row: number; values: Record<string, string> }>;
  file_issues: ImportIssue[];
  examples_skipped: number;
}

export interface ImportReport {
  file_name: string;
  fingerprint: string;
  dry_run: boolean;
  total_rows: number;
  examples_skipped: number;
  valid: number;
  created: number;
  skipped: number;
  error_rows: number;
  warning_rows: number;
  by_section: Record<string, number>;
  issues: ImportIssue[];
  duplicates: Array<{ row: number; kind: 'in_file' | 'bank'; of_row: number | null; question_id: string | null; similarity: number | null; method: string | null }>;
  created_questions: Array<{ row: number; question_id: string; question_version_id: string; duplicate_flagged: boolean }>;
}

/** Ngoặc kép/dấu phân tách trong danh sách chọn Excel không được chứa dấu phẩy */
const LISTS: Record<string, string[]> = {
  program: [...PROGRAM_CODES],
  question_type: ['mcq_single'],
  difficulty: [...DRAFT_DIFFICULTY_LEVELS],
  correct: ['A', 'B', 'C', 'D'],
};

/**
 * B2 – nhập câu hỏi từ Excel: tải tệp mẫu (Arial, header #0B3BA7 chữ trắng, 2 dòng ví dụ, chú thích từng cột ở sheet "Huong_dan" và
 * khi chọn ô), tải tệp lên → job `content.import`: dry-run kiểm tra từng dòng (lỗi theo dòng/cột, trùng trong tệp, nghi trùng ngân hàng
 * qua embedding/pg_trgm) → người dùng xác nhận (gửi lại tệp + fingerprint sha256 của dry-run) → ghi mọi dòng hợp lệ trong MỘT transaction
 * (passage + passage_parts + câu draft) → kiểm trùng ghi cờ vào hàng chờ duyệt → audit `content.imported`.
 * Tệp đọc ngay trong request (nhanh); kiểm tra/ghi chạy như job (CLAUDE.md §5.5) – client polling GET /admin/content/imports/{jobId}.
 */
@Injectable()
export class ContentImportService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'catalog.import' });

  constructor(
    private readonly dbs: DbService,
    private readonly jobs: JobsService,
    private readonly workflow: ContentWorkflowService,
    private readonly passages: ContentPassageService,
    private readonly dedup: ContentDedupService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('content', JOB_NAMES.CONTENT_IMPORT, async (payload, ctx) => this.run(payload as unknown as ImportPayload, ctx));
  }

  private requireStaff(actor: Actor) {
    const role = contentRoleOf(actor.roles);
    if (!role) throw new Forbidden('Content role required', { required: [...CONTENT_ROLES] });
    return role;
  }

  // ------------------------------------------------------------------ tệp mẫu
  template(): Buffer {
    const cols = IMPORT_COLUMNS;
    const main: SheetSpec = {
      name: SHEET_NAME,
      tabColor: 'FF0B3BA7',
      freezeRows: 1,
      columns: cols.map((c) => ({ width: c.width })),
      rows: [
        { cells: cols.map((c) => (c.required ? `${c.key} *` : c.key)), style: 'header', height: 30 },
        { cells: cols.map((c) => c.example[0]), style: 'example', height: 42 },
        { cells: cols.map((c) => c.example[1]), style: 'example', height: 54 },
      ],
      validations: cols.map((c, i) => ({ col: i, lastRow: TEMPLATE_ROWS + 1, promptTitle: c.key, prompt: c.note.vi, ...(LISTS[c.key] ? { list: LISTS[c.key] } : {}) })),
    };
    const guide: SheetSpec = {
      name: 'Huong_dan',
      columns: [{ width: 18 }, { width: 10 }, { width: 70 }, { width: 60 }, { width: 34 }],
      rows: [
        { cells: ['Allingo – mẫu nhập câu hỏi (Excel)'], style: 'title', height: 24 },
        { cells: ['Sheet "Cau_hoi": mỗi dòng một câu. Cột có dấu * là bắt buộc. Hai dòng ví dụ (import_key bắt đầu "VD-") luôn bị bỏ qua – có thể xoá hoặc giữ. Tối đa 1.000 dòng, tệp ≤ 1 MB. Tải lên → "Kiểm tra" (không ghi) → xem lỗi theo dòng/cột → "Xác nhận nhập". Câu nhập vào ở trạng thái Nháp trong hàng chờ duyệt; câu nghi trùng được gắn cờ. Nội dung phải tự biên soạn – không sao chép đề thi thật.'], style: 'note', height: 60 },
        { cells: ['Cột', 'Bắt buộc', 'Mô tả (vi)', 'Description (en)', 'Ví dụ'], style: 'header', height: 24 },
        ...cols.map((c) => ({ cells: [c.key, c.required ? 'Có' : '', c.note.vi, c.note.en, c.example.filter(Boolean).join(' / ')], style: 'body' as const })),
      ],
    };
    return writeXlsx([main, guide], { title: 'Allingo – mẫu nhập câu hỏi', creator: 'Allingo' });
  }

  // ------------------------------------------------------------------ bắt đầu
  async start(actor: Actor, input: ContentImportInput): Promise<{ job_id: string; status: string; mode: string; poll_url: string; fingerprint: string; rows: number }> {
    this.requireStaff(actor);
    const buf = Buffer.from(input.file_base64, 'base64');
    if (buf.length > IMPORT_MAX_BYTES) throw new ValidationFailed({ issues: [{ path: 'file_base64', message: `File too large (${buf.length} > ${IMPORT_MAX_BYTES} bytes)`, code: 'too_large' }] });
    const fingerprint = createHash('sha256').update(buf).digest('hex');
    if (!input.dry_run) {
      if (!input.confirm_fingerprint) throw new ValidationFailed({ issues: [{ path: 'confirm_fingerprint', message: 'confirm_fingerprint required when dry_run = false (run a dry-run first)' }] });
      if (input.confirm_fingerprint !== fingerprint) throw new AppError('conflict', 'File differs from the dry-run (fingerprint mismatch)', 409, { reason: 'fingerprint_mismatch', fingerprint });
    }
    let sheet: ReturnType<typeof readXlsx>;
    try {
      sheet = readXlsx(buf, { sheetName: SHEET_NAME });
    } catch (err) {
      const reason = err instanceof XlsxError ? err.reason : 'corrupt';
      throw new ValidationFailed({ issues: [{ path: 'file_base64', message: `Cannot read .xlsx (${reason})`, code: reason }] }, 'Invalid xlsx file');
    }
    const headerRow = sheet.rows.find((r) => r.cells.some((c) => c.trim()));
    const fileIssues: ImportIssue[] = [];
    const rows: ImportPayload['rows'] = [];
    let examples = 0;
    if (!headerRow) {
      fileIssues.push({ row: 1, column: null, code: 'missing_column', level: 'error', params: { columns: IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key).join(', ') } });
    } else {
      // Tiêu đề mẫu có hậu tố " *" (bắt buộc) – bỏ khi ánh xạ
      const header = headerRow.cells.map((h) => h.replace(/\*/g, '').trim().toLowerCase());
      const missing = missingImportColumns(header);
      if (missing.length) fileIssues.push({ row: headerRow.rowNumber, column: null, code: 'missing_column', level: 'error', params: { columns: missing.join(', ') } });
      for (const r of sheet.rows) {
        if (r.rowNumber <= headerRow.rowNumber || !r.cells.some((c) => c.trim())) continue;
        const values: Record<string, string> = {};
        header.forEach((h, i) => {
          if (h) values[h] = r.cells[i] ?? '';
        });
        if (isExampleRow(values)) {
          examples++;
          continue;
        }
        rows.push({ row: r.rowNumber, values });
      }
    }
    if (rows.length > IMPORT_MAX_ROWS) throw new ValidationFailed({ issues: [{ path: 'file_base64', message: `Too many rows (${rows.length} > ${IMPORT_MAX_ROWS})`, code: 'too_many_rows' }] });
    const jobId = randomUUID();
    const payload: ImportPayload = { actor, file_name: input.file_name, fingerprint, dry_run: input.dry_run, skip_bank_duplicates: input.skip_bank_duplicates, rows, file_issues: fileIssues, examples_skipped: examples };
    await this.jobs.patchStatus(JOB_NAMES.CONTENT_IMPORT, jobId, { status: 'queued', meta: { requested_by: actor.id, file_name: input.file_name, fingerprint, dry_run: input.dry_run, rows: rows.length } });
    const d = await this.jobs.dispatch('content', JOB_NAMES.CONTENT_IMPORT, jobId, payload as unknown as Record<string, unknown>);
    return { job_id: jobId, status: 'queued', mode: d.mode, poll_url: `/v1/admin/content/imports/${jobId}`, fingerprint, rows: rows.length };
  }

  async status(actor: Actor, jobId: string) {
    this.requireStaff(actor);
    const s = await this.jobs.getStatus(JOB_NAMES.CONTENT_IMPORT, jobId);
    if (!s) throw new NotFound('import_job', jobId);
    const meta = s.meta ?? {};
    return { job_id: jobId, status: s.status, dry_run: meta.dry_run === true, file_name: (meta.file_name as string | undefined) ?? null, fingerprint: (meta.fingerprint as string | undefined) ?? null, progress: s.progress ?? null, report: (s.result as ImportReport | null) ?? null, error: s.error ?? null, created_at: s.created_at, updated_at: s.updated_at };
  }

  // ------------------------------------------------------------------ job
  async run(p: ImportPayload, ctx?: JobContext): Promise<ImportReport> {
    const issues: ImportIssue[] = [...p.file_issues];
    const parsed: ImportRowParsed[] = [];
    if (!p.file_issues.some((i) => i.code === 'missing_column')) {
      for (const r of p.rows) {
        const res = parseImportRow(r.row, r.values);
        issues.push(...res.issues);
        if (res.value) parsed.push(res.value);
      }
    }
    await ctx?.status({ progress: { phase: 'validate', done: parsed.length, total: p.rows.length } });

    // Section/chủ đề theo catalog
    const programs = [...new Set(parsed.map((r) => r.program))];
    const sections = programs.length ? await this.dbs.db.select({ id: catalogSections.id, program: catalogSections.programCode, code: catalogSections.code }).from(catalogSections).where(inArray(catalogSections.programCode, programs)) : [];
    const sectionId = new Map(sections.map((s) => [`${s.program}|${s.code}`, s.id]));
    const topics = new Set((await this.dbs.db.select({ code: catalogTopics.code }).from(catalogTopics)).map((t) => t.code));
    const bad = new Set<number>();
    for (const r of parsed) {
      if (!sectionId.has(`${r.program}|${r.section_code}`)) {
        issues.push({ row: r.row, column: 'section_code', code: 'unknown_section', level: 'error', params: { value: r.section_code } });
        bad.add(r.row);
      }
      if (r.topic_code && !topics.has(r.topic_code)) issues.push({ row: r.row, column: 'topic_code', code: 'invalid_value', level: 'warning', params: { value: r.topic_code } });
    }

    // Passage dùng chung theo passage_key: nội dung lấy ở dòng đầu có passage_body; khác nội dung → cảnh báo
    const passageOf = new Map<string, { title: string | null; body: string; firstRow: number }>();
    for (const r of parsed) {
      if (!r.passage?.body) continue;
      const k = `${r.program}|${r.passage.key}`;
      const cur = passageOf.get(k);
      if (!cur) passageOf.set(k, { title: r.passage.title, body: r.passage.body, firstRow: r.row });
      else if (cur.body !== r.passage.body) issues.push({ row: r.row, column: 'passage_body', code: 'passage_conflict', level: 'warning', params: { first_row: cur.firstRow } });
    }
    for (const r of parsed) {
      if (r.passage && !passageOf.has(`${r.program}|${r.passage.key}`)) {
        issues.push({ row: r.row, column: 'passage_body', code: 'required', level: 'error' });
        bad.add(r.row);
      }
    }

    // Khoá nhập đã có (idempotent): external_ref import:<key> hoặc xlsx:<fingerprint>:<row>
    const refOf = (r: ImportRowParsed) => (r.import_key ? `import:${r.import_key}` : `xlsx:${p.fingerprint.slice(0, 16)}:${r.row}`);
    const refs = parsed.map(refOf);
    const existingRefs = new Set<string>();
    for (let i = 0; i < refs.length; i += 500) {
      const chunk = refs.slice(i, i + 500);
      const rows = chunk.length ? await this.dbs.db.select({ ref: sql<string>`${catalogQuestionVersions.metadata} ->> 'external_ref'` }).from(catalogQuestionVersions).where(inArray(sql`${catalogQuestionVersions.metadata} ->> 'external_ref'`, chunk)) : [];
      for (const r of rows) existingRefs.add(r.ref);
    }
    const skippedRows = new Set<number>();
    for (const r of parsed) {
      if (existingRefs.has(refOf(r))) {
        issues.push({ row: r.row, column: 'import_key', code: 'import_key_exists', level: 'warning', params: { value: r.import_key ?? refOf(r) } });
        skippedRows.add(r.row);
      }
    }

    // Trùng trong tệp: câu đơn theo đề bài (pg_trgm như CMS), nhóm passage theo nội dung passage. Xét cả dòng đã nhập trước đó
    // (import_key đã có) để nhập lại cùng tệp cho cùng kết quả – dòng trùng dòng đã nhập vẫn là lỗi, không được tạo ở lần sau.
    const duplicates: ImportReport['duplicates'] = [];
    const candidates = parsed.filter((r) => !bad.has(r.row));
    const singles = candidates.filter((r) => !r.passage);
    for (const d of findBatchDuplicates(singles.map((r) => r.content.stem))) {
      const r = singles[d.index]!;
      const of = singles[d.duplicate_of]!;
      duplicates.push({ row: r.row, kind: 'in_file', of_row: of.row, question_id: null, similarity: d.similarity, method: 'trigram' });
      issues.push({ row: r.row, column: 'stem', code: 'duplicate_in_file', level: 'error', params: { of_row: of.row, similarity: d.similarity } });
      bad.add(r.row);
    }
    const groupKeys = [...passageOf.entries()];
    for (const d of findBatchDuplicates(groupKeys.map(([, g]) => g.body))) {
      const [dupKey] = groupKeys[d.index]!;
      const [, ofG] = groupKeys[d.duplicate_of]!;
      for (const r of candidates.filter((x) => x.passage && `${x.program}|${x.passage.key}` === dupKey)) {
        duplicates.push({ row: r.row, kind: 'in_file', of_row: ofG.firstRow, question_id: null, similarity: d.similarity, method: 'trigram' });
        issues.push({ row: r.row, column: 'passage_body', code: 'duplicate_in_file', level: 'error', params: { of_row: ofG.firstRow, similarity: d.similarity } });
        bad.add(r.row);
      }
    }
    const ready = candidates.filter((r) => !bad.has(r.row) && !skippedRows.has(r.row));

    // Nghi trùng ngân hàng (embedding → pg_trgm): cảnh báo; tuỳ chọn bỏ qua dòng
    await ctx?.status({ progress: { phase: 'dedup', done: 0, total: ready.length } });
    const bankDup = new Map<number, { question_id: string | null; similarity: number | null; method: string | null }>();
    const bySection = new Map<string, ImportRowParsed[]>();
    for (const r of ready) bySection.set(`${r.program}|${r.section_code}`, [...(bySection.get(`${r.program}|${r.section_code}`) ?? []), r]);
    for (const [k, list] of bySection) {
      const [program] = k.split('|');
      const flags = await this.dedup.score(program!, sectionId.get(k)!, list.map((r) => ({ text: dedupKeyText(r.content, r.passage ? (passageOf.get(`${r.program}|${r.passage.key}`)?.body ?? null) : null) })));
      flags.forEach((f, i) => {
        if (!f.flagged) return;
        const r = list[i]!;
        bankDup.set(r.row, { question_id: f.of_question_id, similarity: f.similarity, method: f.method });
        duplicates.push({ row: r.row, kind: 'bank', of_row: null, question_id: f.of_question_id, similarity: f.similarity, method: f.method });
        issues.push({ row: r.row, column: 'stem', code: 'duplicate_in_bank', level: 'warning', params: { question_id: f.of_question_id ?? '', similarity: f.similarity ?? 0 } });
      });
    }
    const toCreate = ready.filter((r) => !(p.skip_bank_duplicates && bankDup.has(r.row)));
    const created: ImportReport['created_questions'] = [];

    if (!p.dry_run && toCreate.length && !issues.some((i) => i.code === 'missing_column')) {
      await ctx?.status({ progress: { phase: 'write', done: 0, total: toCreate.length } });
      const topicIds = new Map((await this.dbs.db.select({ id: catalogTopics.id, code: catalogTopics.code }).from(catalogTopics)).map((t) => [t.code, t.id]));
      await this.dbs.db.transaction(async (tx) => {
        const passageIds = new Map<string, string>();
        for (const r of toCreate) {
          let passageId: string | undefined;
          if (r.passage) {
            const k = `${r.program}|${r.passage.key}`;
            passageId = passageIds.get(k);
            if (!passageId) {
              const g = passageOf.get(k)!;
              const parts = splitMergedPassage(g.body);
              passageId = await this.passages.create(tx, { program: r.program, kind: 'reading_passage', title: g.title, body: g.body, parts, source: 'human', difficulty: r.difficulty, topicId: r.topic_code ? (topicIds.get(r.topic_code) ?? null) : null, createdBy: p.actor.id });
              passageIds.set(k, passageId);
            }
          }
          const dto = await this.workflow.create(
            p.actor,
            {
              program: r.program as ProgramCode,
              section_code: r.section_code,
              question_type: r.question_type,
              passage_id: passageId,
              topic_code: r.topic_code && topicIds.has(r.topic_code) ? r.topic_code : undefined,
              subskill_codes: r.subskill_codes,
              difficulty_target: r.difficulty ?? undefined,
              source: 'human',
              content: r.content,
              metadata: { external_ref: refOf(r), import: { file_name: p.file_name, fingerprint: p.fingerprint, row: r.row } },
            },
            { tx, dedup: false },
          );
          created.push({ row: r.row, question_id: dto.id, question_version_id: dto.head_version.id, duplicate_flagged: false });
        }
        await this.audit.log({ action: 'content.imported', actorUserId: p.actor.id, actorRole: contentRoleOf(p.actor.roles), entityType: 'question_import', after: { file_name: p.file_name, fingerprint: p.fingerprint, created: created.length, rows: p.rows.length } }, tx);
      });
      // Cờ nghi trùng vào metadata (hàng chờ duyệt) – các câu cùng lô không coi là trùng nhau (đã kiểm trong tệp)
      const flags = await this.dedup.checkVersions(created.map((c) => c.question_version_id), { extraExclude: created.map((c) => c.question_id) });
      for (const c of created) c.duplicate_flagged = flags.get(c.question_version_id)?.flagged === true;
    }

    const rowsWith = (level: 'error' | 'warning') => new Set(issues.filter((i) => i.level === level && i.row > 0).map((i) => i.row)).size;
    const bySec: Record<string, number> = {};
    for (const r of toCreate) bySec[r.section_code] = (bySec[r.section_code] ?? 0) + 1;
    const report: ImportReport = {
      file_name: p.file_name,
      fingerprint: p.fingerprint,
      dry_run: p.dry_run,
      total_rows: p.rows.length,
      examples_skipped: p.examples_skipped,
      valid: toCreate.length,
      created: created.length,
      skipped: skippedRows.size + (p.skip_bank_duplicates ? ready.length - toCreate.length : 0),
      error_rows: rowsWith('error'),
      warning_rows: rowsWith('warning'),
      by_section: bySec,
      issues: issues.sort((a, b) => a.row - b.row || (a.column ?? '').localeCompare(b.column ?? '')),
      duplicates: duplicates.sort((a, b) => a.row - b.row),
      created_questions: created,
    };
    await ctx?.status({ progress: { phase: 'done', done: p.rows.length, total: p.rows.length } });
    this.logger.info({ dry_run: p.dry_run, rows: p.rows.length, valid: report.valid, created: report.created, errors: report.error_rows }, 'content.import finished');
    return report;
  }
}
