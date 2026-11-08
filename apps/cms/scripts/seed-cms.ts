/**
 * Seed CMS (idempotent): 3 tài khoản demo, 16 câu TOEIC demo (published, chưa có publishedRef vì API nội bộ
 * có thể chưa chạy – phát hành lại từ admin khi API sẵn sàng), 2 bộ đề mini tương ứng.
 *
 * Chạy:  cd apps/cms && pnpm exec tsx scripts/seed-cms.ts   (cần DATABASE_URL, PAYLOAD_SECRET, CMS_DATABASE_SCHEMA)
 * Không chạy trên production (guard APP_ENV/NODE_ENV).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPayload, type Payload } from 'payload';
import config from '../src/payload.config';
import { parseImportJson } from '../src/lib/import-questions';

const dirname = path.dirname(fileURLToPath(import.meta.url));
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_password – mật khẩu tài khoản demo cục bộ (công khai trong README), script chặn chạy ở production
const DEMO_PASSWORD = 'Allingo@2026';

const USERS = [
  { email: 'admin@allingo.dev', name: 'Admin Allingo', role: 'admin' as const, apiUserEmail: 'admin@allingo.dev' },
  { email: 'teacher@allingo.dev', name: 'Giáo viên demo', role: 'teacher' as const, apiUserEmail: 'teacher@allingo.dev' },
  { email: 'editor@allingo.dev', name: 'Biên tập viên demo', role: 'editor' as const, apiUserEmail: 'editor@allingo.dev' },
];

async function seedUsers(payload: Payload) {
  for (const u of USERS) {
    const found = await payload.find({ collection: 'users', where: { email: { equals: u.email } }, limit: 1, depth: 0 });
    const existing = found.docs[0];
    if (existing) {
      await payload.update({ collection: 'users', id: existing.id, data: { name: u.name, role: u.role, apiUserEmail: u.apiUserEmail }, depth: 0 });
      console.log(`[seed] user giữ nguyên: ${u.email} (${u.role})`);
    } else {
      await payload.create({ collection: 'users', data: { ...u, password: DEMO_PASSWORD }, depth: 0 });
      console.log(`[seed] user tạo mới: ${u.email} (${u.role})`);
    }
  }
}

async function seedQuestions(payload: Payload): Promise<Map<string, string>> {
  const text = readFileSync(path.resolve(dirname, '../samples/questions.sample.json'), 'utf8');
  const parsed = parseImportJson(text);
  if (parsed.errors.length) throw new Error(`questions.sample.json lỗi: ${JSON.stringify(parsed.errors)}`);
  const idByKey = new Map<string, string>();
  let created = 0;
  for (const r of parsed.rows) {
    const key = r.importKey ?? `demo:${r.program}:${r.row}`;
    const found = await payload.find({ collection: 'questions', where: { importKey: { equals: key } }, limit: 1, depth: 0 });
    const existing = found.docs[0];
    if (existing) {
      idByKey.set(key, String(existing.id));
      continue;
    }
    const doc = await payload.create({
      collection: 'questions',
      data: {
        program: r.program,
        sectionCode: r.sectionCode,
        questionType: r.questionType,
        difficulty: r.difficulty ?? null,
        topicCode: r.topicCode ?? null,
        subskillCodes: r.subskillCodes.map((code) => ({ code })),
        source: r.source,
        content: r.content,
        // Đã duyệt nội bộ (demo); publishedRef trống vì chưa gọi API nội bộ
        status: 'published',
        reviews: [{ stage: 'review2', decision: 'approve', reviewer: 'seed-cms', note: 'Seed demo Sprint 0', at: new Date().toISOString() }],
        importKey: key,
      },
      depth: 0,
      context: { skipWorkflow: true },
    });
    idByKey.set(key, String(doc.id));
    created += 1;
  }
  console.log(`[seed] questions: ${created} tạo mới, ${parsed.rows.length - created} đã có`);
  return idByKey;
}

async function seedTestSets(payload: Payload, idByKey: Map<string, string>) {
  const sets = [
    {
      code: 'toeic-mini-part5-demo',
      kind: 'mini' as const,
      title: { vi: 'TOEIC mini – Part 5 (10 câu)', en: 'TOEIC mini – Part 5 (10 questions)' },
      durationSec: 600,
      sectionCode: 'part5',
      keys: Array.from({ length: 10 }, (_, i) => `demo:toeic:p5-${String(i + 1).padStart(2, '0')}`),
    },
    {
      code: 'toeic-mini-part2-demo',
      kind: 'mini' as const,
      title: { vi: 'TOEIC mini – Part 2 (6 câu nghe)', en: 'TOEIC mini – Part 2 (6 listening questions)' },
      durationSec: 300,
      sectionCode: 'part2',
      keys: Array.from({ length: 6 }, (_, i) => `demo:toeic:p2-${String(i + 1).padStart(2, '0')}`),
    },
  ];
  for (const s of sets) {
    const items = s.keys.map((k, i) => {
      const id = idByKey.get(k);
      if (!id) throw new Error(`Thiếu câu ${k} để tạo bộ đề ${s.code}`);
      return { question: id, sectionCode: s.sectionCode, sortOrder: i + 1, points: 1 };
    });
    const data = {
      program: 'toeic' as const,
      code: s.code,
      kind: s.kind,
      title: s.title,
      isFree: true,
      durationSec: s.durationSec,
      sections: [{ sectionCode: s.sectionCode, durationSec: s.durationSec }],
      items,
      status: 'published' as const,
    };
    const found = await payload.find({ collection: 'test_sets', where: { code: { equals: s.code } }, limit: 1, depth: 0 });
    const existing = found.docs[0];
    if (existing) {
      await payload.update({ collection: 'test_sets', id: existing.id, data, depth: 0, context: { skipWorkflow: true } });
      console.log(`[seed] test_set cập nhật: ${s.code}`);
    } else {
      await payload.create({ collection: 'test_sets', data, depth: 0, context: { skipWorkflow: true } });
      console.log(`[seed] test_set tạo mới: ${s.code}`);
    }
  }
}

async function main() {
  if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
    throw new Error('seed-cms không chạy trên production.');
  }
  const payload = await getPayload({ config });
  try {
    await seedUsers(payload);
    const idByKey = await seedQuestions(payload);
    await seedTestSets(payload, idByKey);
    console.log(`[seed] xong. Đăng nhập ${process.env.CMS_PUBLIC_URL ?? 'http://localhost:3001'}/admin với admin@allingo.dev / ${DEMO_PASSWORD}`);
  } finally {
    await payload.db.destroy?.();
  }
}

main()
  .then(() => {
    // Payload giữ handle (pool/timer) sau destroy → thoát tường minh để script không treo
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('[seed] lỗi:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
