import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, inArray, like, or, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../src/shared/db/db.module.js';
import { UsersService } from '../../src/modules/iam/index.js';
import { AiGatewayService } from '../../src/modules/ai-gateway/core/ai-gateway.service.js';
import { MockEmbeddingProvider, type EmbeddingProvider } from '../../src/modules/ai-gateway/providers/embedding.provider.js';
import { readXlsx, writeXlsx } from '../../src/modules/catalog/import/xlsx.js';
import { IMPORT_COLUMNS } from '@allingo/schemas';
import { bootTestApp, client } from './setup.js';

const PASSWORD = 'Allingo@2026';
const INTERNAL = { 'x-internal-token': process.env.INTERNAL_API_TOKEN ?? 'dev-internal-token' };
const uniq = () => Math.random().toString(36).slice(2, 8);
const TAG = `b2${uniq()}`;

/** Tệp Excel theo mẫu: dòng tiêu đề (cột mẫu) + các dòng dữ liệu theo tên cột */
/** JOBS_INLINE chạy job nền trong process (không chờ) → poll trạng thái tới completed/failed */
async function pollJob(c: ReturnType<typeof client>, url: string) {
  let r = await c.call('GET', url);
  for (let i = 0; i < 240 && r.body.status !== 'completed' && r.body.status !== 'failed'; i++) {
    await new Promise((res) => setTimeout(res, 250));
    r = await c.call('GET', url);
  }
  return r;
}

function sheet(rows: Array<Record<string, string>>): string {
  const header = IMPORT_COLUMNS.map((c) => c.key);
  return writeXlsx([{ name: 'Cau_hoi', columns: header.map(() => ({ width: 10 })), rows: [{ cells: header.map((h) => (IMPORT_COLUMNS.find((c) => c.key === h)!.required ? `${h} *` : h)) }, { cells: header.map((h) => (h === 'import_key' ? 'VD-001' : h === 'program' ? 'toeic' : '')) }, ...rows.map((r) => ({ cells: header.map((h) => r[h] ?? '') }))] }]).toString('base64');
}

/**
 * B5 + B2 (integration, Postgres/Redis thật, AI/embedding mock): passage_parts trong payload attempt/review + tương thích ngược,
 * đồng bộ passage từ CMS, metadata đề sinh tự động (S30), lọc trùng embedding + fallback pg_trgm, nhập Excel (dry-run → xác nhận,
 * fingerprint, idempotent), hàng chờ duyệt (lọc, hàng loạt, 4 mắt, phân công, quyền), AI soạn nháp cả đề + phát hành đề nháp.
 */
describe('B5/B2 – Part 7 đa đoạn & công cụ sản xuất nội dung (integration)', () => {
  let app: NestFastifyApplication;
  let dbs: DbService;
  let admin: ReturnType<typeof client>;
  let teacher: ReturnType<typeof client>;
  let editor: ReturnType<typeof client>;
  let learner: ReturnType<typeof client>;
  const createdTestSets: string[] = [];
  const createdPassages: string[] = [];

  beforeAll(async () => {
    process.env.JOBS_INLINE = 'true';
    process.env.CATALOG_CACHE_TTL_SECONDS = '0';
    app = await bootTestApp();
    dbs = app.get(DbService);
    admin = client(app);
    expect((await admin.call('POST', '/auth/login', { email: 'admin@allingo.dev', password: PASSWORD })).status).toBe(200);
    teacher = client(app);
    expect((await teacher.call('POST', '/auth/login', { email: 'teacher@allingo.dev', password: PASSWORD })).status).toBe(200);
    // Biên tập viên: tài khoản mới + vai trò editor (đăng nhập lại để JWT mang vai trò)
    editor = client(app);
    const email = `b2-editor-${uniq()}@example.com`;
    const reg = await editor.call('POST', '/auth/register', { email, password: 'Bien-tap#B2-xK9q', display_name: 'Editor B2', accept_terms: true });
    expect(reg.status).toBe(201);
    await dbs.db.transaction((tx) => app.get(UsersService).grantRole(tx, { userId: reg.body.user.id, roleCode: 'editor' }));
    editor.reset();
    expect((await editor.call('POST', '/auth/login', { email, password: 'Bien-tap#B2-xK9q' })).status).toBe(200);
    learner = client(app);
    expect((await learner.call('POST', '/auth/login', { email: 'learner_pro@allingo.dev', password: PASSWORD })).status).toBe(200);
  });

  afterAll(async () => {
    if (dbs) {
      const qs = await dbs.db
        .select({ qid: schema.catalogQuestionVersions.questionId, vid: schema.catalogQuestionVersions.id })
        .from(schema.catalogQuestionVersions)
        .where(or(like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, 'ai-draft:%'), like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, 'import:b2%'), like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, 'xlsx:%'), sql`${schema.catalogQuestionVersions.content} ->> 'stem' like ${`%${TAG}%`}`));
      const qids = [...new Set(qs.map((q) => q.qid))];
      if (qids.length) {
        await dbs.db.delete(schema.aiEmbeddings).where(inArray(schema.aiEmbeddings.entityId, qs.map((q) => q.vid)));
        await dbs.db.delete(schema.catalogContentReviews).where(inArray(schema.catalogContentReviews.entityId, qids));
        await dbs.db.delete(schema.catalogTestSetItems).where(inArray(schema.catalogTestSetItems.questionId, qids));
        const passages = (await dbs.db.select({ p: schema.catalogQuestions.passageId }).from(schema.catalogQuestions).where(inArray(schema.catalogQuestions.id, qids))).map((r) => r.p).filter((x): x is string => !!x);
        createdPassages.push(...passages);
        await dbs.db.delete(schema.catalogQuestions).where(inArray(schema.catalogQuestions.id, qids));
      }
      if (createdTestSets.length) await dbs.db.delete(schema.catalogTestSets).where(inArray(schema.catalogTestSets.id, createdTestSets));
      if (createdPassages.length) await dbs.db.delete(schema.catalogPassages).where(inArray(schema.catalogPassages.id, [...new Set(createdPassages)]));
    }
    delete process.env.JOBS_INLINE;
    delete process.env.CATALOG_CACHE_TTL_SECONDS;
    await app?.close();
  });

  // ------------------------------------------------------------------ B5 / S24
  it('S24: attempt + review trả passage.parts cho bộ đôi/bộ ba Part 7 (đúng thứ tự); passage một văn bản không có parts', async () => {
    const [ts] = await dbs.db.select({ id: schema.catalogTestSets.id }).from(schema.catalogTestSets).where(eq(schema.catalogTestSets.code, 'toeic-reading-01-drill-part7'));
    const a = await learner.call('POST', '/attempts', { program: 'toeic', mode: 'practice', test_set_id: ts!.id }, { 'idempotency-key': randomUUID() });
    expect(a.status).toBe(201);
    const multi = (a.body.questions as Array<{ passage: { parts?: Array<{ sort_order: number; title: string; body: string }>; body: string } | null }>).filter((q) => q.passage?.parts?.length);
    expect(multi.length).toBeGreaterThanOrEqual(5);
    const parts = multi[0]!.passage!.parts!;
    expect(parts.map((p) => p.sort_order)).toEqual(parts.map((_, i) => i + 1));
    for (const p of parts) expect(multi[0]!.passage!.body).toContain(`[${p.title}]\n${p.body}`);
    const single = (a.body.questions as Array<{ passage: Record<string, unknown> | null }>).find((q) => q.passage && !('parts' in q.passage));
    expect(single).toBeTruthy();
    const answers = (a.body.questions as Array<{ question_id: string }>).map((q) => ({ question_id: q.question_id, answer: { type: 'mcq_single', selected: 'A' }, time_spent_ms: 4000 }));
    expect((await learner.call('PUT', `/attempts/${a.body.id}/answers`, { answers })).status).toBe(204);
    expect((await learner.call('POST', `/attempts/${a.body.id}/submit`)).status).toBe(200);
    const r = await learner.call('GET', `/attempts/${a.body.id}/review`);
    expect(r.status).toBe(200);
    const items = (r.body.items ?? r.body.data) as Array<{ question: { passage: { parts?: unknown[] } | null } }>;
    expect(items.filter((i) => i.question.passage?.parts?.length).length).toBe(multi.length);
  });

  it('S24: CMS đồng bộ passage + văn bản từng phần (idempotent theo id, thay part) → câu sync gắn passage_id', async () => {
    const passageId = randomUUID();
    createdPassages.push(passageId);
    const sync = (parts: Array<{ title: string; body: string }>) => admin.call('POST', '/internal/content/passages/sync', { passage_id: passageId, program: 'toeic', kind: 'reading_passage', title: `P7 ${TAG}`, status: 'ready', parts }, INTERNAL);
    const s1 = await sync([{ title: 'E-mail', body: 'Hello team.' }, { title: 'Invoice', body: 'Total 300' }, { title: 'Note', body: 'Paid.' }]);
    expect(s1.status).toBe(200);
    expect(s1.body).toMatchObject({ passage_id: passageId, parts: 3, status: 'published' });
    const s2 = await sync([{ title: 'E-mail', body: 'Hello team (v2).' }, { title: 'Invoice', body: 'Total 300' }]);
    expect(s2.body.parts).toBe(2);
    const parts = await dbs.db.select().from(schema.catalogPassageParts).where(eq(schema.catalogPassageParts.passageId, passageId)).orderBy(schema.catalogPassageParts.sortOrder);
    expect(parts.map((p) => [p.sortOrder, p.title, p.body])).toEqual([
      [1, 'E-mail', 'Hello team (v2).'],
      [2, 'Invoice', 'Total 300'],
    ]);
    const [p] = await dbs.db.select().from(schema.catalogPassages).where(eq(schema.catalogPassages.id, passageId));
    expect(p!.body).toBe('[E-mail]\nHello team (v2).\n\n[Invoice]\nTotal 300');
    const q = await admin.call(
      'POST',
      '/internal/content/questions/sync',
      { external_ref: `cms-${TAG}`, program: 'toeic', section_code: 'part7', question_type: 'mcq_single', status: 'draft', passage_id: passageId, content: { type: 'mcq_single', stem: `What is attached? ${TAG}`, options: [{ key: 'A', text: 'An invoice' }, { key: 'B', text: 'A map' }], answer_key: { correct: 'A' } } },
      INTERNAL,
    );
    expect(q.status).toBe(200);
    const [row] = await dbs.db.select({ passageId: schema.catalogQuestions.passageId }).from(schema.catalogQuestions).where(eq(schema.catalogQuestions.id, q.body.question_id));
    expect(row!.passageId).toBe(passageId);
    // Passage chưa đồng bộ → 400
    const bad = await admin.call('POST', '/internal/content/questions/sync', { external_ref: `cms-bad-${TAG}`, program: 'toeic', section_code: 'part7', question_type: 'mcq_single', status: 'draft', passage_id: randomUUID(), content: { type: 'mcq_single', stem: 'x', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer_key: { correct: 'A' } } }, INTERNAL);
    expect(bad.status).toBe(400);
  });

  it('S30: đề mini sinh tự động lưu seed/blueprint/bank_fingerprint vào test_sets.metadata', async () => {
    const r = await admin.call('POST', '/admin/test-sets/generate', { program: 'toeic', seed: 4242, publish: false, code: `toeic-mini-s30-${uniq()}` });
    expect(r.status).toBe(201);
    createdTestSets.push(r.body.test_set_id);
    const [ts] = await dbs.db.select({ metadata: schema.catalogTestSets.metadata }).from(schema.catalogTestSets).where(eq(schema.catalogTestSets.id, r.body.test_set_id));
    expect(ts!.metadata).toMatchObject({ source: 'mini_generator', seed: 4242, bank_fingerprint: r.body.bank_fingerprint, blueprint: { code: 'toeic_lr_mini_60_v1' } });
  });

  // ------------------------------------------------------------------ B2: lọc trùng
  it('lọc trùng khi tạo câu: embedding (cosine) gắn cờ + câu tương tự; embedding lỗi → fallback pg_trgm', async () => {
    // Đề bài của một câu Part 5 đã phát hành (seed demo)
    const [pub] = await dbs.db.execute<{ stem: string; id: string }>(sql`select v.content ->> 'stem' as stem, q.id from catalog.questions q join catalog.question_versions v on v.id = q.current_version_id join catalog.sections s on s.id = q.section_id where q.status = 'published' and s.code = 'part5' and q.program_code = 'toeic' and length(v.content ->> 'stem') > 40 order by q.id limit 1`);
    const make = (stem: string) => admin.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', content: { type: 'mcq_single', stem, options: [{ key: 'A', text: 'one' }, { key: 'B', text: 'two' }, { key: 'C', text: 'three' }, { key: 'D', text: 'four' }], answer_key: { correct: 'A' } } });
    const c1 = await make(`${pub!.stem} `);
    expect(c1.status).toBe(201);
    // dedup chạy như job (inline) sau khi trả 201 → chờ cờ xuất hiện
    const flagOf = async (vid: string) => {
      for (let i = 0; i < 40; i++) {
        const [v] = await dbs.db.select({ m: schema.catalogQuestionVersions.metadata }).from(schema.catalogQuestionVersions).where(eq(schema.catalogQuestionVersions.id, vid));
        const d = (v!.m as { duplicate?: Record<string, unknown> }).duplicate;
        if (d) return d;
        await new Promise((r) => setTimeout(r, 100));
      }
      return null;
    };
    const d1 = await flagOf(c1.body.head_version.id);
    expect(d1).toMatchObject({ flagged: true, method: 'embedding' });
    expect(Number(d1!.similarity)).toBeGreaterThanOrEqual(0.99);
    const sameStem = (await dbs.db.execute<{ id: string }>(sql`select q.id from catalog.questions q join catalog.question_versions v on v.id = q.current_version_id where trim(v.content ->> 'stem') = ${pub!.stem.trim()}`)).map((r) => r.id);
    expect(sameStem).toContain(d1!.of_question_id);
    // Embedding lỗi → pg_trgm
    const gw = app.get(AiGatewayService);
    const failing: EmbeddingProvider = { model: 'mock:hash-trigram-1536', provider: 'mock', embed: async () => Promise.reject(new Error('embedding down')) };
    gw.embeddings.setProvider(failing);
    try {
      const c2 = await make(`${pub!.stem} (${TAG})`);
      const d2 = await flagOf(c2.body.head_version.id);
      expect(d2).toMatchObject({ flagged: true, method: 'trigram', embedding_error: true });
      expect([...sameStem, c1.body.id]).toContain(d2!.of_question_id);
    } finally {
      gw.embeddings.setProvider(new MockEmbeddingProvider());
    }
    // Câu khác hẳn → không cờ
    const c3 = await make(`Completely unrelated sentence about ${TAG} penguins ______ in Antarctica.`);
    expect(await flagOf(c3.body.head_version.id)).toMatchObject({ flagged: false });
    const re = await admin.call('POST', `/admin/content/questions/${c1.body.id}/duplicate-check`);
    expect(re.status).toBe(200);
    expect(re.body.duplicate).toMatchObject({ flagged: true });
    expect(re.body.duplicate.similar[0].stem.trim()).toBe(pub!.stem.trim().slice(0, 240));
  });

  // ------------------------------------------------------------------ B2: nhập Excel
  it('nhập Excel: mẫu tải được; dry-run lỗi theo dòng/cột + trùng; xác nhận cần fingerprint; ghi một transaction; idempotent', async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const cookies = admin.cookies();
    const t = await fastify.inject({ method: 'GET', url: '/v1/admin/content/imports/template', cookies });
    expect(t.statusCode).toBe(200);
    expect(String(t.headers['content-type'])).toContain('spreadsheetml');
    const parsed = readXlsx(t.rawPayload, { sheetName: 'Cau_hoi' });
    expect(parsed.rows[0]!.cells[0]).toBe('import_key');
    expect(parsed.rows[1]!.cells[0]).toBe('VD-001');
    expect(readXlsx(t.rawPayload, { sheetName: 'Huong_dan' }).rows.length).toBeGreaterThan(IMPORT_COLUMNS.length);
    // learner không có quyền
    expect((await learner.call('GET', '/admin/content/imports/template')).status).toBe(403);

    const [pub] = await dbs.db.execute<{ stem: string }>(sql`select v.content ->> 'stem' as stem from catalog.questions q join catalog.question_versions v on v.id = q.current_version_id join catalog.sections s on s.id = q.section_id where q.status = 'published' and s.code = 'part5' and length(v.content ->> 'stem') > 40 order by q.id desc limit 1`);
    const ok = (k: string, stem: string, extra: Record<string, string> = {}) => ({ import_key: `b2${TAG}-${k}`, program: 'toeic', section_code: 'part5', question_type: 'mcq_single', difficulty: 'B1', stem, option_a: 'alpha', option_b: 'beta', option_c: 'gamma', option_d: 'delta', correct: 'B', ...extra });
    const rows = [
      ok('1', `The courier from Kestrel Depot ______ every Tuesday ${TAG}.`), // dòng 3
      ok('2', '', { correct: 'E' }), // dòng 4: thiếu đề + đáp án lạ
      ok('3', `The courier from Kestrel Depot ______ every Tuesday ${TAG}.`), // dòng 5: trùng dòng 3
      ok('4', pub!.stem), // dòng 6: nghi trùng ngân hàng (cảnh báo)
      ok('5', `What is the e-mail mainly about? ${TAG}`, { section_code: 'part7', passage_key: `PK-${TAG}`, passage_title: 'E-mail + Notice', passage_body: `[E-mail]\nCould we move the delivery ${TAG}?\n\n[Notice]\nDeliveries only on Thursdays.` }),
      ok('6', `What does the notice say? ${TAG}`, { section_code: 'part7', passage_key: `PK-${TAG}` }),
    ];
    const file = sheet(rows);
    const dry = await admin.call('POST', '/admin/content/imports', { file_name: 'cau-hoi.xlsx', file_base64: file });
    expect(dry.status).toBe(202);
    expect(dry.body.rows).toBe(6);
    const st = await pollJob(admin, `/admin/content/imports/${dry.body.job_id}`);
    expect(st.body.status).toBe('completed');
    const rep = st.body.report;
    expect(rep).toMatchObject({ dry_run: true, total_rows: 6, examples_skipped: 1, valid: 4, created: 0, error_rows: 2 });
    const issue = (row: number, column: string) => rep.issues.find((i: { row: number; column: string }) => i.row === row && i.column === column);
    expect(issue(4, 'stem')).toMatchObject({ code: 'required', level: 'error' });
    expect(issue(4, 'correct')).toMatchObject({ code: 'invalid_value', params: { value: 'E' } });
    expect(issue(5, 'stem')).toMatchObject({ code: 'duplicate_in_file', params: { of_row: 3 } });
    expect(issue(6, 'stem')).toMatchObject({ code: 'duplicate_in_bank', level: 'warning' });
    // Không ghi gì khi dry-run
    expect(await dbs.db.select().from(schema.catalogQuestionVersions).where(like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, `import:b2${TAG}%`))).toHaveLength(0);
    // Xác nhận thiếu/sai fingerprint
    expect((await admin.call('POST', '/admin/content/imports', { file_name: 'cau-hoi.xlsx', file_base64: file, dry_run: false })).status).toBe(400);
    const wrong = await admin.call('POST', '/admin/content/imports', { file_name: 'cau-hoi.xlsx', file_base64: file, dry_run: false, confirm_fingerprint: '0'.repeat(64) });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.details.reason).toBe('fingerprint_mismatch');
    // Xác nhận đúng
    const commit = await admin.call('POST', '/admin/content/imports', { file_name: 'cau-hoi.xlsx', file_base64: file, dry_run: false, confirm_fingerprint: dry.body.fingerprint });
    expect(commit.status).toBe(202);
    const done = (await pollJob(admin, `/admin/content/imports/${commit.body.job_id}`)).body.report;
    expect(done).toMatchObject({ dry_run: false, created: 4 });
    const dupRow = done.created_questions.find((c: { row: number }) => c.row === 6);
    expect(dupRow.duplicate_flagged).toBe(true);
    // Passage dùng chung + tách văn bản từng phần
    const p7 = done.created_questions.filter((c: { row: number }) => c.row >= 7);
    const pq = await dbs.db.select({ passageId: schema.catalogQuestions.passageId, status: schema.catalogQuestions.status, source: schema.catalogQuestions.source }).from(schema.catalogQuestions).where(inArray(schema.catalogQuestions.id, p7.map((c: { question_id: string }) => c.question_id)));
    expect(new Set(pq.map((r) => r.passageId)).size).toBe(1);
    expect(pq.every((r) => r.status === 'draft' && r.source === 'human')).toBe(true);
    const pp = await dbs.db.select({ title: schema.catalogPassageParts.title }).from(schema.catalogPassageParts).where(eq(schema.catalogPassageParts.passageId, pq[0]!.passageId!)).orderBy(schema.catalogPassageParts.sortOrder);
    expect(pp.map((x) => x.title)).toEqual(['E-mail', 'Notice']);
    // Audit
    const [audit] = await dbs.db.select().from(schema.opsAuditLogs).where(and(eq(schema.opsAuditLogs.action, 'content.imported'), sql`${schema.opsAuditLogs.after} ->> 'fingerprint' = ${dry.body.fingerprint}`));
    expect(audit).toBeTruthy();
    // Nhập lại cùng tệp → bỏ qua (import_key đã có)
    const again = await admin.call('POST', '/admin/content/imports', { file_name: 'cau-hoi.xlsx', file_base64: file, dry_run: false, confirm_fingerprint: dry.body.fingerprint });
    const rep2 = (await pollJob(admin, `/admin/content/imports/${again.body.job_id}`)).body.report;
    expect(rep2).toMatchObject({ created: 0, skipped: 4 });
    // Tệp hỏng → 400 rõ ràng
    expect((await admin.call('POST', '/admin/content/imports', { file_name: 'x.xlsx', file_base64: Buffer.from('not an xlsx file at all').toString('base64') })).status).toBe(400);
  });

  // ------------------------------------------------------------------ B2: hàng chờ duyệt
  it('hàng chờ duyệt: lọc + kiểm tra tự động; hàng loạt theo máy trạng thái (lý do, 4 mắt); phân công (quyền) + lọc reviewer; audit', async () => {
    const make = async (who: ReturnType<typeof client>, stem: string) => (await who.call('POST', '/admin/questions', { program: 'toeic', section_code: 'part5', question_type: 'mcq_single', source: 'human', content: { type: 'mcq_single', stem, options: [{ key: 'A', text: 'x1' }, { key: 'B', text: 'x2' }, { key: 'C', text: 'x3' }], answer_key: { correct: 'A' } } })).body.id as string;
    const ids = [await make(editor, `Queue item one ${TAG} ______ alpha.`), await make(editor, `Queue item two ${TAG} ______ beta.`), await make(editor, `Queue item three ${TAG} ______ gamma.`)];
    const list = await editor.call('GET', `/admin/content/review-queue?q=${TAG}%20______&created_by=me&section=part5&sort=created_at&order=asc`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((x: { id: string }) => x.id)).toEqual(ids);
    const first = list.body.data[0];
    expect(first).toMatchObject({ workflow_status: 'draft', source: 'human', created_by: { display_name: 'Editor B2' } });
    expect(first.created_by.email).toMatch(/\*\*\*/);
    expect(first.auto_checks.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['option_count', 'explanation_missing']));
    expect(list.body.counts.draft).toBeGreaterThanOrEqual(3);
    // learner bị chặn
    expect((await learner.call('GET', '/admin/content/review-queue')).status).toBe(403);

    // editor gửi duyệt hàng loạt → review1
    const sub = await editor.call('POST', '/admin/content/review-queue/bulk', { question_ids: ids, action: 'submit' });
    expect(sub.status).toBe(200);
    expect(sub.body).toMatchObject({ requested: 3, ok: 3, failed: 0 });
    // editor không duyệt được vòng 1
    const ed = await editor.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[0]], action: 'approve' });
    expect(ed.body.results[0]).toMatchObject({ ok: false, error: { code: 'forbidden', reason: 'role_not_allowed' } });
    // từ chối thiếu lý do → 400
    expect((await teacher.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[2]], action: 'reject' })).status).toBe(400);
    // teacher duyệt vòng 1 (2 câu) + trả lại câu 3 kèm lý do
    const ap = await teacher.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[0], ids[1]], action: 'approve' });
    expect(ap.body.results.map((r: { status: string }) => r.status)).toEqual(['review2', 'review2']);
    const nc = await teacher.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[2]], action: 'needs_change', notes: 'Thiếu phương án D' });
    expect(nc.body.results[0]).toMatchObject({ ok: true, status: 'draft' });
    // vòng 2: teacher không có quyền, admin duyệt được; câu ở draft → invalid_transition
    const t2 = await teacher.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[0]], action: 'approve' });
    expect(t2.body.results[0].ok).toBe(false);
    const a2 = await admin.call('POST', '/admin/content/review-queue/bulk', { question_ids: [ids[0], ids[2]], action: 'approve' });
    expect(a2.body.results[0]).toMatchObject({ ok: true, status: 'published' });
    expect(a2.body.results[1]).toMatchObject({ ok: false, error: { reason: 'invalid_transition' } });
    const reviews = await dbs.db.select().from(schema.catalogContentReviews).where(eq(schema.catalogContentReviews.entityId, ids[2]!));
    expect(reviews.some((r) => r.decision === 'needs_change' && r.notes === 'Thiếu phương án D')).toBe(true);

    // phân công: editor 403; teacher giao cho admin; người được giao phải có vai trò duyệt
    expect((await editor.call('POST', '/admin/content/review-queue/assign', { question_ids: [ids[1]], assignee_id: null })).status).toBe(403);
    const adminId = (await admin.call('GET', '/me')).body.id;
    const as = await teacher.call('POST', '/admin/content/review-queue/assign', { question_ids: [ids[1]], assignee_id: adminId });
    expect(as.body).toMatchObject({ updated: 1, assignee_id: adminId });
    const editorId = (await editor.call('GET', '/me')).body.id;
    expect((await teacher.call('POST', '/admin/content/review-queue/assign', { question_ids: [ids[1]], assignee_id: editorId })).status).toBe(400);
    const mine = await admin.call('GET', `/admin/content/review-queue?assignee=me&q=${TAG}`);
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(ids[1]);
    expect(mine.body.data.find((x: { id: string }) => x.id === ids[1]).assignee.id).toBe(adminId);
    const unassigned = await admin.call('GET', `/admin/content/review-queue?assignee=none&q=${TAG}`);
    expect(unassigned.body.data.map((x: { id: string }) => x.id)).not.toContain(ids[1]);
    const reviewers = await editor.call('GET', '/admin/content/reviewers');
    expect(reviewers.body.data.find((r: { id: string }) => r.id === adminId)).toMatchObject({ role: 'admin', can_review: true });
    const logs = await dbs.db.select({ action: schema.opsAuditLogs.action }).from(schema.opsAuditLogs).where(inArray(schema.opsAuditLogs.action, ['content.bulk_review', 'content.review_assigned']));
    expect(new Set(logs.map((l) => l.action))).toEqual(new Set(['content.bulk_review', 'content.review_assigned']));
    // lọc nguồn + cờ trùng + phân trang cursor
    const dupOnly = await admin.call('GET', '/admin/content/review-queue?duplicate=true&limit=2');
    for (const x of dupOnly.body.data) expect(x.duplicate.flagged).toBe(true);
    const p1 = await admin.call('GET', '/admin/content/review-queue?limit=1&sort=updated_at');
    if (p1.body.next_cursor) {
      const p2 = await admin.call('GET', `/admin/content/review-queue?limit=1&sort=updated_at&cursor=${encodeURIComponent(p1.body.next_cursor)}`);
      expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
    }
  });

  // ------------------------------------------------------------------ B2: AI soạn nháp cả đề
  it('AI soạn đề theo blueprint → đề nháp + câu draft source=ai (AI check, cờ trùng), Part 7 bộ đôi có parts; phát hành chặn khi chưa duyệt', async () => {
    const bad = await editor.call('POST', '/admin/generate/test-sets', { blueprint: { sections: [{ section_code: 'part3', count: 4 }] } });
    expect(bad.status).toBe(400);
    const r = await editor.call('POST', '/admin/generate/test-sets', { program: 'toeic', kind: 'mini', title: { vi: `Đề nháp ${TAG}` }, blueprint: { sections: [{ section_code: 'part5', count: 3 }, { section_code: 'part6', count: 4 }, { section_code: 'part7', count: 5, multi_passage_texts: 2 }, { section_code: 'part3', count: 3 }], difficulty_mix: { A2: 1, B1: 2 }, topics: ['logistics', 'office'] } });
    expect(r.status).toBe(202);
    createdTestSets.push(r.body.test_set_id);
    expect(r.body.plan.map((p: { section_code: string }) => p.section_code)).toEqual(['part3', 'part5', 'part6', 'part7']);
    const job = await pollJob(editor, `/admin/generate/test-sets/${r.body.job_id}`);
    expect(job.body.status).toBe('completed');
    const res = job.body.result;
    expect(res.summary).toMatchObject({ requested: 15, created: 15, invalid: 0, by_section: { part3: 3, part5: 3, part6: 4, part7: 5 } });
    expect(res.summary.verdicts.pass).toBe(15);
    // Đề nháp trong catalog: status draft, metadata ai_draft, 15 item theo thứ tự, nhóm liền nhau
    const [ts] = await dbs.db.select().from(schema.catalogTestSets).where(eq(schema.catalogTestSets.id, r.body.test_set_id));
    expect(ts).toMatchObject({ status: 'draft', kind: 'mini' });
    expect(ts!.metadata).toMatchObject({ source: 'ai_draft', job_id: r.body.job_id, summary: { created: 15 } });
    const items = await dbs.db.select().from(schema.catalogTestSetItems).where(eq(schema.catalogTestSetItems.testSetId, ts!.id)).orderBy(schema.catalogTestSetItems.sortOrder);
    expect(items).toHaveLength(15);
    const qs = await dbs.db.select().from(schema.catalogQuestions).where(inArray(schema.catalogQuestions.id, items.map((i) => i.questionId)));
    expect(qs.every((q) => q.source === 'ai' && q.status === 'ai_checked')).toBe(true);
    const p7 = res.items.filter((i: { section_code: string }) => i.section_code === 'part7');
    const parts = await dbs.db.select().from(schema.catalogPassageParts).where(eq(schema.catalogPassageParts.passageId, p7[0].passage_id));
    expect(parts).toHaveLength(2);
    // Hàng chờ lọc theo đề nháp
    const q = await editor.call('GET', `/admin/content/review-queue?test_set_id=${ts!.id}&limit=50`);
    expect(q.body.data).toHaveLength(15);
    expect(q.body.data.find((x: { section_code: string }) => x.section_code === 'part7').passage.parts).toHaveLength(2);
    expect(q.body.data.every((x: { ai_check: { verdict: string } }) => x.ai_check.verdict === 'pass')).toBe(true);
    // Chạy lại job (cùng id) không tạo trùng câu
    const again = await app.get((await import('../../src/modules/catalog/content-draft-test.service.js')).ContentDraftTestService).run(r.body.job_id, job.body.input, { id: (await editor.call('GET', '/me')).body.id, roles: ['editor'] }, ts!.id);
    expect(again.items).toHaveLength(15);
    expect((await dbs.db.select().from(schema.catalogQuestionVersions).where(like(sql`${schema.catalogQuestionVersions.metadata} ->> 'external_ref'`, `ai-draft:${r.body.job_id}:%`))).length).toBe(15);
    // Phát hành: editor 403; teacher 409 vì câu chưa duyệt
    expect((await editor.call('POST', `/admin/test-sets/${ts!.id}/publish`)).status).toBe(403);
    const pub = await teacher.call('POST', `/admin/test-sets/${ts!.id}/publish`);
    expect(pub.status).toBe(409);
    expect(pub.body.error.details).toMatchObject({ reason: 'unpublished_items', count: 15 });
  });
});
