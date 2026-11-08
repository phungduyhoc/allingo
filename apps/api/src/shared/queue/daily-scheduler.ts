import type { Env } from '../../config/env.js';
import type { RedisService } from '../cache/redis.module.js';
import { getLogger } from '../telemetry/logger.js';

const TICK_MS = 5 * 60_000;

/**
 * Lịch chạy hằng ngày theo giờ VN (S12 – content.stats_nightly, ops.retention_cleanup): kiểm 5 phút/lần, chạy lần đầu tiên sau
 * `hourVn` mỗi ngày; khoá Redis theo (job, ngày) để chỉ một replica chạy. Chỉ bật ở worker (hoặc API khi JOBS_INLINE /
 * BILLING_SCHEDULER_IN_API – dev không có worker); không bao giờ ở APP_ENV=test. Trả hàm dừng.
 */
export function startDailyJob(opts: { name: string; hourVn: number; env: Env; redis: RedisService; run: (now: Date) => Promise<unknown> }): (() => void) | null {
  const { env } = opts;
  if (env.APP_ENV === 'test') return null;
  const isWorker = process.argv.some((a) => a.endsWith('worker.ts') || a.endsWith('worker.js'));
  if (!isWorker && !env.BILLING_SCHEDULER_IN_API && !env.JOBS_INLINE) return null;
  const logger = getLogger({ component: `daily.${opts.name}` });
  let running = false;
  let lastDay = '';
  const tick = async () => {
    if (running) return;
    const now = new Date();
    const vn = new Date(now.getTime() + 7 * 3_600_000);
    if (vn.getUTCHours() < opts.hourVn) return;
    const day = vn.toISOString().slice(0, 10);
    if (lastDay === day) return;
    const lock = await opts.redis.safe((r) => r.set(`daily:joblock:${opts.name}:${day}`, String(now.getTime()), 'EX', 26 * 3600, 'NX'));
    lastDay = day;
    if (lock !== null && lock !== 'OK') return;
    running = true;
    try {
      const r = await opts.run(now);
      logger.info({ job: opts.name, result: r }, 'daily job done');
    } catch (err) {
      logger.error({ job: opts.name, err: (err as Error).message.slice(0, 300) }, 'daily job failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
