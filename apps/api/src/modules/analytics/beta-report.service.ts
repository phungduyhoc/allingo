import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env.js';
import { computeBetaKpis, fetchPostHogSummary, isoWeekRange, renderBetaReport, type BetaKpis, type PostHogSummary } from './beta-report.js';
import { ReadStoreService } from './read-store.service.js';

/** GET /admin/reports/beta (S12) – cùng nguồn với `pnpm report:beta`: KPI từ replica (READ ONLY) + PostHog (khi có key) */
@Injectable()
export class BetaReportService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly read: ReadStoreService,
  ) {}

  async weekly(week?: string, now: Date = new Date()): Promise<{ week: string; kpis: BetaKpis; posthog: PostHogSummary | null; markdown: string }> {
    const range = isoWeekRange(week, now);
    const asOf = range.end < now ? range.end : now;
    const kpis = await this.read.read((tx) => computeBetaKpis(tx, range, { asOf }));
    const posthog = await fetchPostHogSummary({ host: this.env.POSTHOG_API_HOST, projectId: this.env.POSTHOG_PROJECT_ID, apiKey: this.env.POSTHOG_PERSONAL_API_KEY }, range);
    return { week: range.week, kpis, posthog, markdown: renderBetaReport(kpis, posthog, now) };
  }
}
