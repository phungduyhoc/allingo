 
// pnpm db:seed --set core,demo   (demo bị chặn khi APP_ENV=production)
// pnpm db:seed --set beta-demo [--reset]   (S12 – dữ liệu beta GIẢ LẬP cho pnpm report:beta; không chạy trên production)
// pnpm db:seed --set dictionary   (chỉ nhập từ điển mở vào catalog.vocab_items + bộ TOEIC 600 – core cũng chạy bước này)
import { createDb } from '../src/client.js';
import { ensureMonthPartitions } from '../src/partitions.js';
import { seedCatalog } from '../seed/core/catalog.js';
import { seedBilling } from '../seed/core/billing.js';
import { seedPrompts } from '../seed/core/prompts.js';
import { seedDemo } from '../seed/demo/index.js';
import { seedDictionary } from '../seed/dictionary.js';
import { seedToeic600 } from '../seed/core/vocab-toeic600.js';
import { seedBetaDemo } from '../seed/demo/beta-demo.js';

const args = process.argv.slice(2);
const setArg = args.find((a) => a.startsWith('--set'));
const sets = (setArg?.includes('=') ? setArg.split('=')[1] : (args[args.indexOf('--set') + 1] ?? 'core'))!
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const url =
  process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
const appEnv = process.env.APP_ENV ?? 'development';

if ((sets.includes('demo') || sets.includes('beta-demo')) && appEnv === 'production') {
  console.error('✘ Không chạy seed demo/beta-demo trên production (APP_ENV=production).');
  process.exit(2);
}

const { db, sql } = createDb({ url, max: 2, applicationName: 'allingo-seed' });
const t0 = Date.now();
try {
  await ensureMonthPartitions(db, 2);
  if (sets.includes('core')) {
    await seedCatalog(db);
    await seedBilling(db);
    const r = await seedPrompts(db, { activate: process.env.ALLOW_UNEVALUATED_ACTIVATION !== 'false' });
    console.log(`[seed:core] catalog + billing + prompts(${r.templates} templates, ${r.routes} routes)`);
  }
  if (sets.includes('core') || sets.includes('dictionary')) {
    const d = await seedDictionary(db);
    if (d) console.log(`[seed:dictionary] ${d.total} mục: +${d.inserted} mới, ${d.updated} cập nhật, ${d.unchanged} giữ nguyên, ${d.skipped} bỏ qua`);
    else console.warn('[seed:dictionary] chưa có db/seed/dictionary/toeic-core-en-vi.ts – bỏ qua');
    // S10: bộ từ "TOEIC 600 theo chủ đề" dựng từ từ điển (idempotent)
    const v = await seedToeic600(db);
    if (v) console.log(`[seed:vocab] TOEIC 600: ${v.lists} bộ, ${v.words} từ (+${v.inserted} mục mới, −${v.removed} mục bỏ)`);
    else console.warn('[seed:vocab] từ điển chưa đủ dữ liệu – bỏ qua TOEIC 600');
  }
  if (sets.includes('demo')) {
    await seedDemo(db);
  }
  // S12: dữ liệu beta GIẢ LẬP (không chạy mặc định) – `pnpm db:seed --set beta-demo [--reset]`
  if (sets.includes('beta-demo')) {
    const r = await seedBetaDemo(db, { reset: args.includes('--reset') });
    if (r.skipped) console.log('[seed:beta-demo] đã có tester01@beta-demo.allingo.test – bỏ qua (thêm --reset để tạo lại)');
    else console.log(`[seed:beta-demo] DỮ LIỆU GIẢ LẬP: ${r.testers} tester, ${r.waitlist} chờ, ${r.invites} lời mời, ${r.attempts} bài, ${r.answers} câu, ${r.explains} giải thích, ${r.surveys} khảo sát`);
  }
  console.log(`✔ seed ${sets.join(',')} xong trong ${Date.now() - t0} ms`);
} catch (err) {
  console.error('✘ seed lỗi:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
