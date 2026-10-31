 
// pnpm db:seed --set core,demo   (demo bị chặn khi APP_ENV=production)
import { createDb } from '../src/client.js';
import { ensureMonthPartitions } from '../src/partitions.js';
import { seedCatalog } from '../seed/core/catalog.js';
import { seedBilling } from '../seed/core/billing.js';
import { seedPrompts } from '../seed/core/prompts.js';
import { seedDemo } from '../seed/demo/index.js';

const args = process.argv.slice(2);
const setArg = args.find((a) => a.startsWith('--set'));
const sets = (setArg?.includes('=') ? setArg.split('=')[1] : (args[args.indexOf('--set') + 1] ?? 'core'))!
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const url =
  process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL ?? 'postgres://allingo:allingo@localhost:5432/allingo';
const appEnv = process.env.APP_ENV ?? 'development';

if (sets.includes('demo') && appEnv === 'production') {
  console.error('✘ Không chạy seed demo trên production (APP_ENV=production).');
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
  if (sets.includes('demo')) {
    await seedDemo(db);
  }
  console.log(`✔ seed ${sets.join(',')} xong trong ${Date.now() - t0} ms`);
} catch (err) {
  console.error('✘ seed lỗi:', err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
