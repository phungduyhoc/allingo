import type { MockState, MockUserRecord } from './state';

/**
 * "Máy chủ" giả lập B2 (dev:mock / E2E mock) bám OpenAPI v1.1 nhóm công cụ sản xuất nội dung: hàng chờ duyệt (lọc/sắp xếp, duyệt/từ chối
 * hàng loạt theo máy trạng thái rút gọn, phân công reviewer, kiểm trùng lại), nhập Excel (dry-run → xác nhận với fingerprint sha256 thật
 * của tệp; báo cáo cố định theo hợp đồng – không đọc nội dung .xlsx), AI soạn nháp cả đề (job 2 bước polling), phát hành đề nháp (409 khi
 * còn câu chưa duyệt). Không chứa logic nghiệp vụ thật (lọc trùng/AI chạy ở API).
 */

type Status = 'draft' | 'ai_checked' | 'review1' | 'review2' | 'published' | 'rejected' | 'retired';
interface MockQueueItem {
  id: string;
  question_version_id: string;
  program: string;
  section_code: string;
  workflow_status: Status;
  source: 'human' | 'ai';
  difficulty: string | null;
  content: Record<string, unknown>;
  passage: { id: string; kind: string; title: string | null; body: string | null; parts: Array<{ id: string; sort_order: number; title: string | null; body: string }> } | null;
  created_by: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
  ai: 'pass' | 'needs_change' | 'fail' | null;
  checks: Array<{ code: string; level: 'error' | 'warning'; params?: Record<string, string | number> }>;
  dup: { flagged: boolean; method: 'embedding' | 'trigram' | null; similarity: number | null; of_question_id: string | null; of_stem: string | null; similar: Array<{ question_id: string; similarity: number; method: 'embedding' | 'trigram'; stem: string | null }> } | null;
  test_set_id: string | null;
}
export interface MockContentToolsState {
  items: MockQueueItem[];
  jobs: Record<string, { kind: 'import' | 'draft'; polls: number; dry_run: boolean; file_name: string; fingerprint: string; created_at: string; test_set_id?: string; code?: string; total?: number; input?: unknown; report?: unknown }>;
}

type Ctx = { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string; headers: Headers };
type Handler = (ctx: Ctx) => Promise<Response> | Response;
export interface ContentToolsDeps<R> {
  state: MockState & { contentTools?: MockContentToolsState };
  persist: () => void;
  route: (method: string, path: string, handler: Handler) => R;
  json: (status: number, body: unknown, headers?: Record<string, string>) => Response;
  error: (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
  uuid: () => string;
  nowIso: () => string;
  currentUser: () => MockUserRecord | null;
}

const STAFF = ['editor', 'teacher', 'admin', 'superadmin'];
const TEACHER = { id: '00000000-0000-4000-8000-0000000000a1', display_name: 'Giáo viên demo', email: 'te***@allingo.dev', role: 'teacher' as const, can_review: true };
const mcq = (stem: string, options: string[], correct: string, explanation?: string) => ({ type: 'mcq_single', stem, options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })), answer_key: { correct }, ...(explanation ? { explanation: { vi: explanation } } : {}), tags: [] });

function seedItems(now: string, adminId: string | null): MockQueueItem[] {
  const id = (n: number) => `c0ffee00-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = { program: 'toeic', difficulty: 'B1', created_by: adminId, assignee: null, created_at: now, updated_at: now, test_set_id: null, passage: null, dup: null };
  return [
    { ...base, id: id(1), question_version_id: id(101), section_code: 'part5', workflow_status: 'review1', source: 'human', ai: 'pass', checks: [], content: mcq('The Harlow office will ______ its new hours on Monday.', ['announce', 'announcing', 'announced', 'announcement'], 'A', 'will + V nguyên mẫu.') },
    {
      ...base,
      id: id(2),
      question_version_id: id(102),
      section_code: 'part5',
      workflow_status: 'ai_checked',
      source: 'ai',
      ai: 'pass',
      checks: [{ code: 'explanation_missing', level: 'warning' }],
      content: mcq('All invoices from Brightline Logistics must be submitted ______ Friday.', ['by', 'until', 'since', 'during'], 'A'),
      dup: { flagged: true, method: 'embedding', similarity: 0.96, of_question_id: id(901), of_stem: 'All invoices must be submitted ______ Friday, 3 March.', similar: [{ question_id: id(901), similarity: 0.96, method: 'embedding', stem: 'All invoices must be submitted ______ Friday, 3 March.' }] },
    },
    {
      ...base,
      id: id(3),
      question_version_id: id(103),
      section_code: 'part7',
      workflow_status: 'review1',
      source: 'human',
      ai: 'pass',
      checks: [],
      content: mcq('Why will Ms. Tran most likely need to change her booking?', ['The library closes early on Saturdays.', 'Rooms hold four people.', 'The library is closed in July.', 'She asked for a Sunday.'], 'A', 'Kết hợp hai văn bản.'),
      passage: {
        id: id(301),
        kind: 'reading_passage',
        title: 'Notice + E-mail',
        body: '[Notice]\nSummer hours: weekdays 9:00–18:00, Saturdays until 13:00.\n\n[E-mail]\nI would like to book a study room on Saturday from 11:00 to 15:00.',
        parts: [
          { id: id(311), sort_order: 1, title: 'Notice', body: 'Summer hours: weekdays 9:00–18:00, Saturdays until 13:00.' },
          { id: id(312), sort_order: 2, title: 'E-mail', body: 'I would like to book a study room on Saturday from 11:00 to 15:00.' },
        ],
      },
    },
    { ...base, id: id(4), question_version_id: id(104), section_code: 'part6', workflow_status: 'review2', source: 'human', ai: 'pass', checks: [], content: mcq('Question 1: Choose the word that best completes blank [1].', ['join', 'have joined', 'joining', 'to join'], 'B'), passage: { id: id(401), kind: 'reading_passage', title: 'E-mail: Orientation', body: 'We are delighted that you [1] our team.', parts: [] } },
    { ...base, id: id(5), question_version_id: id(105), section_code: 'part5', workflow_status: 'draft', source: 'human', ai: null, checks: [{ code: 'answer_key_not_in_options', level: 'error', params: { key: 'E' } }], content: mcq('Mr. Okafor asked the team to ______ the report.', ['review', 'reviews', 'reviewing', 'reviewed'], 'E') },
    { ...base, id: id(6), question_version_id: id(106), section_code: 'part2', workflow_status: 'ai_checked', source: 'ai', ai: 'needs_change', checks: [{ code: 'option_count', level: 'warning', params: { expected: 3, actual: 4 } }, { code: 'audio_missing', level: 'warning' }], content: mcq('', ['Yes, at noon.', 'In Room 4.', 'Mr. Vo did.', 'Twice a week.'], 'A') },
  ] as MockQueueItem[];
}

const DRAFT_SECTIONS: Record<string, string[]> = { part5: ['The Silverleaf team ______ the delivery schedule before Friday.'], part6: ['Question 1: Choose the word or phrase that best completes blank [1].'], part7: ['What is the main purpose of the e-mail?'] };

async function sha256Hex(base64: string): Promise<string> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function contentToolsMock<R>(d: ContentToolsDeps<R>) {
  const { route, json, error } = d;
  const s = (): MockContentToolsState => {
    const st = d.state;
    if (!st.contentTools) {
      const admin = Object.values(st.users).find((u) => u.roles.includes('admin'));
      st.contentTools = { items: seedItems(d.nowIso(), admin?.id ?? null), jobs: {} };
    }
    return st.contentTools;
  };
  const requireStaff = (): MockUserRecord | Response => {
    const u = d.currentUser();
    if (!u) return error(401, 'unauthorized', 'Session expired');
    if (!u.roles.some((r) => STAFF.includes(r))) return error(403, 'forbidden', 'Content role required', { required: ['editor', 'teacher', 'admin'] });
    return u;
  };
  const person = (id: string | null) => {
    if (!id) return null;
    if (id === TEACHER.id) return { id, display_name: TEACHER.display_name, email: TEACHER.email };
    const u = d.state.users[id];
    return u ? { id, display_name: u.display_name, email: u.email ? `${u.email.slice(0, 2)}***@${u.email.split('@')[1] ?? ''}` : null } : null;
  };
  const dto = (i: MockQueueItem) => ({
    id: i.id,
    question_version_id: i.question_version_id,
    version_no: 1,
    program: i.program,
    section_code: i.section_code,
    question_type: 'mcq_single',
    status: i.workflow_status,
    workflow_status: i.workflow_status,
    has_pending_version: false,
    source: i.source,
    difficulty: i.difficulty,
    external_ref: null,
    content: i.content,
    passage: i.passage,
    created_by: person(i.created_by),
    assignee: person(i.assignee),
    assigned_at: i.assignee ? i.updated_at : null,
    created_at: i.created_at,
    updated_at: i.updated_at,
    ai_check: i.ai ? { verdict: i.ai, issues: i.ai === 'needs_change' ? [{ message: 'Phương án C gần đúng – cần sửa (mock)' }] : [], checked_at: i.updated_at } : null,
    auto_checks: i.checks,
    duplicate: i.dup ? { ...i.dup, checked_at: i.updated_at } : null,
  });
  const QUEUE: Status[] = ['draft', 'ai_checked', 'review1', 'review2'];

  const routes: R[] = [
    route('GET', '/admin/content/review-queue', ({ url }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const p = url.searchParams;
      let list = s().items.filter((i) => (p.get('status') ? i.workflow_status === p.get('status') : QUEUE.includes(i.workflow_status)));
      if (p.get('program')) list = list.filter((i) => i.program === p.get('program'));
      if (p.get('section')) list = list.filter((i) => i.section_code === p.get('section'));
      if (p.get('source')) list = list.filter((i) => i.source === p.get('source'));
      if (p.get('duplicate') === 'true') list = list.filter((i) => i.dup?.flagged);
      if (p.get('duplicate') === 'false') list = list.filter((i) => !i.dup?.flagged);
      if (p.get('test_set_id')) list = list.filter((i) => i.test_set_id === p.get('test_set_id'));
      const who = (v: string | null) => (v === 'me' ? u.id : v);
      if (p.get('created_by')) list = list.filter((i) => i.created_by === who(p.get('created_by')));
      if (p.get('assignee') === 'none') list = list.filter((i) => !i.assignee);
      else if (p.get('assignee')) list = list.filter((i) => i.assignee === who(p.get('assignee')));
      if (p.get('q')) list = list.filter((i) => (typeof i.content.stem === 'string' ? i.content.stem : '').toLowerCase().includes(p.get('q')!.toLowerCase()));
      const sort = p.get('sort') ?? 'created_at';
      const dir = p.get('order') === 'asc' ? 1 : -1;
      list = [...list].sort((a, b) => (sort === 'similarity' ? ((a.dup?.similarity ?? -1) - (b.dup?.similarity ?? -1)) * dir : (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1) * dir));
      const counts: Record<string, number> = {};
      for (const i of s().items) if (QUEUE.includes(i.workflow_status)) counts[i.workflow_status] = (counts[i.workflow_status] ?? 0) + 1;
      return json(200, { data: list.map(dto), next_cursor: null, counts });
    }),
    route('POST', '/admin/content/review-queue/bulk', ({ body }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const b = body as { question_ids?: string[]; action?: string; notes?: string };
      if (!Array.isArray(b.question_ids) || !b.question_ids.length || !['approve', 'reject', 'needs_change', 'submit'].includes(b.action ?? '')) return error(400, 'validation_failed', 'Invalid body');
      if ((b.action === 'reject' || b.action === 'needs_change') && (b.notes ?? '').trim().length < 3) return error(400, 'validation_failed', 'notes required', { issues: [{ path: 'notes' }] });
      const reviewer = u.roles.some((r) => ['teacher', 'admin', 'superadmin'].includes(r));
      const results = b.question_ids.map((qid) => {
        const it = s().items.find((x) => x.id === qid);
        const fail = (code: string, reason: string, message: string) => ({ question_id: qid, ok: false, status: null, error: { code, message, reason } });
        if (!it) return fail('not_found', 'not_found', 'question not found');
        const st = it.workflow_status;
        let to: Status | null = null;
        if (b.action === 'submit') {
          if (st !== 'draft' && st !== 'ai_checked') return fail('conflict', 'invalid_transition', `submit is not valid from ${st}`);
          if (it.ai === 'fail') return fail('conflict', 'ai_check_failed', 'AI check failed');
          to = 'review1';
        } else {
          if (st !== 'review1' && st !== 'review2') return fail('conflict', 'invalid_transition', `${b.action} is not valid from ${st}`);
          if (!reviewer) return fail('forbidden', 'role_not_allowed', 'reviewer role required');
          to = b.action === 'approve' ? (st === 'review1' ? 'review2' : 'published') : b.action === 'reject' ? 'rejected' : 'draft';
        }
        it.workflow_status = to;
        it.updated_at = d.nowIso();
        return { question_id: qid, ok: true, status: to, error: null };
      });
      d.persist();
      const ok = results.filter((r) => r.ok).length;
      return json(200, { action: b.action, requested: results.length, ok, failed: results.length - ok, results });
    }),
    route('POST', '/admin/content/review-queue/assign', ({ body }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      if (!u.roles.some((r) => ['teacher', 'admin', 'superadmin'].includes(r))) return error(403, 'forbidden', 'Only teacher/admin can assign reviewers');
      const b = body as { question_ids?: string[]; assignee_id?: string | null };
      let updated = 0;
      for (const it of s().items) {
        if (!b.question_ids?.includes(it.id)) continue;
        it.assignee = b.assignee_id ?? null;
        it.updated_at = d.nowIso();
        updated++;
      }
      d.persist();
      return json(200, { updated, assignee_id: b.assignee_id ?? null, missing: (b.question_ids?.length ?? 0) - updated });
    }),
    route('GET', '/admin/content/reviewers', () => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const staff = Object.values(d.state.users).filter((x) => x.roles.some((r) => STAFF.includes(r)));
      return json(200, { data: [...staff.map((x) => ({ ...person(x.id)!, role: x.roles.includes('admin') ? 'admin' : x.roles.includes('teacher') ? 'teacher' : 'editor', can_review: x.roles.some((r) => ['teacher', 'admin'].includes(r)) })), TEACHER] });
    }),
    route('POST', '/admin/content/questions/{questionId}/duplicate-check', ({ params }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const it = s().items.find((x) => x.id === params.questionId);
      if (!it) return error(404, 'not_found', 'question not found');
      it.dup = it.dup ?? { flagged: false, method: null, similarity: null, of_question_id: null, of_stem: null, similar: [] };
      d.persist();
      return json(200, { question_id: it.id, question_version_id: it.question_version_id, duplicate: { ...it.dup, checked_at: d.nowIso() } });
    }),
    route('GET', '/admin/content/imports/template', () => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      // Tệp mẫu giả (byte ZIP rỗng) – bản thật do API sinh
      return new Response(new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array<number>(18).fill(0)]), { status: 200, headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
    }),
    route('POST', '/admin/content/imports', async ({ body }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const b = body as { file_name?: string; file_base64?: string; dry_run?: boolean; confirm_fingerprint?: string };
      if (!b.file_name?.toLowerCase().endsWith('.xlsx') || !b.file_base64) return error(400, 'validation_failed', 'file must be .xlsx');
      const fingerprint = await sha256Hex(b.file_base64);
      const dry = b.dry_run !== false;
      if (!dry && b.confirm_fingerprint !== fingerprint) return error(409, 'conflict', 'File differs from the dry-run (fingerprint mismatch)', { reason: 'fingerprint_mismatch', fingerprint });
      const id = d.uuid();
      s().jobs[id] = { kind: 'import', polls: 0, dry_run: dry, file_name: b.file_name, fingerprint, created_at: d.nowIso() };
      d.persist();
      return json(202, { job_id: id, status: 'queued', mode: 'inline', poll_url: `/v1/admin/content/imports/${id}`, fingerprint, rows: 5 });
    }),
    route('GET', '/admin/content/imports/{jobId}', ({ params }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const j = s().jobs[params.jobId!];
      if (!j || j.kind !== 'import') return error(404, 'not_found', 'import job not found');
      j.polls++;
      if (!j.report) {
        const created: Array<{ row: number; question_id: string; question_version_id: string; duplicate_flagged: boolean }> = [];
        if (!j.dry_run) {
          for (const row of [4, 7, 8]) {
            const qid = d.uuid();
            created.push({ row, question_id: qid, question_version_id: d.uuid(), duplicate_flagged: row === 8 });
            s().items.unshift({
              id: qid,
              question_version_id: d.uuid(),
              program: 'toeic',
              section_code: row === 4 ? 'part5' : 'part7',
              workflow_status: 'draft',
              source: 'human',
              difficulty: 'B1',
              content: mcq(row === 4 ? 'The forklift driver ______ the pallets before noon at Kestrel Depot.' : 'What is the purpose of the notice? (Excel)', ['unloads', 'unloading', 'unload', 'to unload'], 'A'),
              passage: null,
              created_by: u.id,
              assignee: null,
              created_at: d.nowIso(),
              updated_at: d.nowIso(),
              ai: null,
              checks: [{ code: 'explanation_missing', level: 'warning' }],
              dup: row === 8 ? { flagged: true, method: 'trigram', similarity: 0.88, of_question_id: 'c0ffee00-0000-4000-8000-000000000001', of_stem: 'The Harlow office will ______ its new hours on Monday.', similar: [] } : null,
              test_set_id: null,
            });
          }
        }
        j.report = {
          file_name: j.file_name,
          fingerprint: j.fingerprint,
          dry_run: j.dry_run,
          total_rows: 5,
          examples_skipped: 2,
          valid: 3,
          created: created.length,
          skipped: 0,
          error_rows: 2,
          warning_rows: 1,
          by_section: { part5: 1, part7: 2 },
          issues: [
            { row: 5, column: 'correct', code: 'invalid_value', level: 'error', params: { value: 'E' } },
            { row: 5, column: 'stem', code: 'required', level: 'error' },
            { row: 6, column: 'stem', code: 'duplicate_in_file', level: 'error', params: { of_row: 4, similarity: 1 } },
            { row: 8, column: 'stem', code: 'duplicate_in_bank', level: 'warning', params: { question_id: 'c0ffee00-0000-4000-8000-000000000001', similarity: 0.88 } },
          ],
          duplicates: [{ row: 6, kind: 'in_file', of_row: 4, question_id: null, similarity: 1, method: 'trigram' }],
          created_questions: created,
        };
        d.persist();
      }
      return json(200, { job_id: params.jobId, status: 'completed', dry_run: j.dry_run, file_name: j.file_name, fingerprint: j.fingerprint, progress: { phase: 'done', done: 5, total: 5 }, report: j.report, error: null, created_at: j.created_at, updated_at: d.nowIso() });
    }),
    route('POST', '/admin/generate/test-sets', ({ body }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const b = body as { blueprint?: { sections?: Array<{ section_code: string; count: number; multi_passage_texts?: number }> }; kind?: string };
      const sections = b.blueprint?.sections ?? [];
      if (!sections.length) return error(400, 'validation_failed', 'blueprint.sections required');
      const bad = sections.find((x) => ['part3', 'part4'].includes(x.section_code) && x.count % 3 !== 0);
      if (bad) return error(400, 'validation_failed', 'Validation failed', { issues: [{ path: 'blueprint.sections.0.count', message: `${bad.count} questions cannot be split into groups of 3` }] });
      const id = d.uuid();
      const total = sections.reduce((n, x) => n + x.count, 0);
      const testSetId = d.uuid();
      const code = `toeic-ai-draft-${id.slice(0, 8)}`;
      s().jobs[id] = { kind: 'draft', polls: 0, dry_run: false, file_name: '', fingerprint: '', created_at: d.nowIso(), test_set_id: testSetId, code, total, input: b };
      d.persist();
      return json(202, { job_id: id, status: 'queued', mode: 'inline', poll_url: `/v1/admin/generate/test-sets/${id}`, test_set_id: testSetId, code, total, plan: sections.map((x) => ({ section_code: x.section_code, count: x.count, mode: ['part3', 'part4', 'part6', 'part7'].includes(x.section_code) ? 'group' : 'single', groups: [], text_counts: [] })) });
    }),
    route('GET', '/admin/generate/test-sets/{jobId}', ({ params }) => {
      const u = requireStaff();
      if (u instanceof Response) return u;
      const j = s().jobs[params.jobId!];
      if (!j || j.kind !== 'draft') return error(404, 'not_found', 'draft job not found');
      j.polls++;
      const base = { job_id: params.jobId, test_set_id: j.test_set_id, code: j.code, total: j.total, input: j.input, error: null, created_at: j.created_at, updated_at: d.nowIso() };
      if (j.polls < 2) {
        d.persist();
        return json(200, { ...base, status: 'running', progress: { phase: 'generate', section: 'part5', done: Math.min(3, j.total ?? 0), total: j.total }, result: null });
      }
      if (!j.report) {
        const sections = ((j.input as { blueprint?: { sections?: Array<{ section_code: string; count: number }> } }).blueprint?.sections ?? []) as Array<{ section_code: string; count: number }>;
        const items: Array<Record<string, unknown>> = [];
        let sort = 0;
        const bySection: Record<string, number> = {};
        for (const sec of sections) {
          for (let k = 0; k < sec.count; k++) {
            sort++;
            const qid = d.uuid();
            const stem = (DRAFT_SECTIONS[sec.section_code]?.[0] ?? `AI draft question (${sec.section_code})`).replace('______', k % 2 ? '______' : '______');
            s().items.unshift({ id: qid, question_version_id: d.uuid(), program: 'toeic', section_code: sec.section_code, workflow_status: 'ai_checked', source: 'ai', difficulty: 'B1', content: mcq(`${stem} #${k + 1}`, ['will review', 'reviewing', 'reviewed', 'to review'], 'A', 'will + V (mock)'), passage: null, created_by: u.id, assignee: null, created_at: d.nowIso(), updated_at: d.nowIso(), ai: 'pass', checks: [], dup: null, test_set_id: j.test_set_id ?? null });
            items.push({ question_id: qid, question_version_id: d.uuid(), section_code: sec.section_code, sort_order: sort, group_key: null, passage_id: null, difficulty: 'B1', verdict: 'pass', duplicate_flagged: false });
            bySection[sec.section_code] = (bySection[sec.section_code] ?? 0) + 1;
          }
        }
        j.report = { test_set_id: j.test_set_id, summary: { requested: j.total, created: items.length, invalid: 0, flagged_duplicates: 0, verdicts: { pass: items.length, needs_change: 0, fail: 0 }, by_section: bySection, shortfall: [] }, items, invalid: [] };
      }
      d.persist();
      return json(200, { ...base, status: 'completed', progress: { phase: 'done', done: j.total, total: j.total }, result: j.report });
    }),
    route('POST', '/admin/test-sets/{testSetId}/publish', ({ params }) => {
      const u = d.currentUser();
      if (!u) return error(401, 'unauthorized', 'Session expired');
      if (!u.roles.some((r) => ['teacher', 'admin', 'superadmin'].includes(r))) return error(403, 'forbidden', 'Only teacher/admin can publish test sets');
      const items = s().items.filter((i) => i.test_set_id === params.testSetId);
      const unpublished = items.filter((i) => i.workflow_status !== 'published');
      if (unpublished.length) return error(409, 'conflict', `${unpublished.length} question(s) are not published yet`, { reason: 'unpublished_items', count: unpublished.length });
      const job = Object.values(s().jobs).find((j) => j.test_set_id === params.testSetId);
      return json(200, { test_set_id: params.testSetId, code: job?.code ?? 'toeic-ai-draft', status: 'published', structure: { ok: true } });
    }),
  ];
  return { routes };
}
