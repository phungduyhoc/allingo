/**
 * pnpm report:beta – báo cáo beta tuần (S12): KPI từ DB replica (DATABASE_URL_REPLICA, không có → DATABASE_URL, giao dịch
 * READ ONLY) + PostHog API (POSTHOG_PROJECT_ID + POSTHOG_PERSONAL_API_KEY; thiếu → "chưa có") → Markdown.
 *
 *   pnpm report:beta                         # tuần ISO trước (giờ VN) → docs/gates/beta-weekly-<YYYY-Www>.md
 *   pnpm report:beta -- --week=2026-W45      # tuần chỉ định (đang diễn ra → số tới thời điểm chạy)
 *   pnpm report:beta -- --stdout             # in ra stdout, không ghi tệp
 *   pnpm report:beta -- --email              # gửi email ban điều hành (BETA_REPORT_EMAILS, trống → OPS_ALERT_EMAIL)
 *
 * Định nghĩa KPI: docs/analytics/events.md; SQL tham chiếu: docs/analytics/kpi.sql. Không ghi PII (chỉ đếm/tỉ lệ).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { createDb } from '@allingo/db';
import { loadEnv } from '../src/config/env.js';
import { resolveEmailProvider } from '../src/shared/notify/mailer.service.js';
import { computeBetaKpis, fetchPostHogSummary, isoWeekRange, renderBetaReport } from '../src/modules/analytics/beta-report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const env = loadEnv();
const now = new Date();
const range = isoWeekRange(arg('week'), now);
const asOf = range.end < now ? range.end : now;
const url = env.DATABASE_URL_REPLICA || env.DATABASE_URL;
const { db, sql: conn } = createDb({ url, max: 1, applicationName: 'allingo-report-beta' });

try {
  const kpis = await db.transaction(async (tx) => {
    await tx.execute(sql`set transaction read only`);
    return computeBetaKpis(tx, range, { asOf });
  });
  const posthog = await fetchPostHogSummary({ host: env.POSTHOG_API_HOST, projectId: env.POSTHOG_PROJECT_ID, apiKey: env.POSTHOG_PERSONAL_API_KEY }, range);
  const md = renderBetaReport(kpis, posthog, now);
  if (args.includes('--stdout')) process.stdout.write(md);
  else {
    const dir = path.resolve(here, '../../../docs/gates');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `beta-weekly-${range.week}.md`);
    fs.writeFileSync(file, md);
    process.stdout.write(`✔ ${path.relative(path.resolve(here, '../../..'), file)} (${kpis.cohort.testers} tester${kpis.simulated ? ', DỮ LIỆU GIẢ LẬP' : ''}, PostHog: ${posthog ? 'có' : 'chưa có'})\n`);
  }
  if (args.includes('--email')) {
    const to = (env.BETA_REPORT_EMAILS || env.OPS_ALERT_EMAIL || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (!to.length) process.stderr.write('⚠ --email: chưa cấu hình BETA_REPORT_EMAILS/OPS_ALERT_EMAIL – bỏ qua gửi\n');
    const provider = resolveEmailProvider(env, []);
    for (const addr of to) {
      await provider.send({ to: addr, subject: `[Allingo] Báo cáo beta tuần ${range.week}${kpis.simulated ? ' (dữ liệu giả lập)' : ''}`, text: md, tags: { kind: 'beta_weekly' } }, env.SMTP_FROM, env.EMAIL_REPLY_TO);
      process.stdout.write(`✔ đã gửi email báo cáo (${provider.kind})\n`);
    }
  }
} finally {
  await conn.end();
}
