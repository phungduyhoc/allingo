import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { schema } from '@allingo/db';
import type { ReconciliationMismatch, ReconciliationRun, ReconciliationRunInput } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { DbService } from '../../shared/db/db.module.js';
import { AuditService } from '../../shared/events/audit.service.js';
import { NotFound, ValidationFailed } from '../../shared/http/errors.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { vnDate, vnDayRange } from './payments/crypto.js';
import { PaymentProviderRegistry } from './payments/provider-registry.js';
import { toVnd } from './pricing.js';
import { CsvFormatError, diffReconciliation, mismatchesToCsv, parseStatementCsv, type ReconRow } from './reconciliation.js';

const { billingPayments, billingReconciliationRuns, opsAuditLogs } = schema;
type RunRow = typeof billingReconciliationRuns.$inferSelect;
type DbProvider = (typeof billingPayments.$inferSelect)['provider'];

/**
 * Đối soát hằng ngày (Sprint 7): `billing.reconciliation_runs` (UNIQUE provider × ngày – chạy lại ghi đè) so `billing.payments`
 * success/refunded có `confirmed_at` trong ngày VN với sao kê CSV (POST /admin/billing/reconciliations) hoặc queryStatus
 * (job billing.reconcile 01:30 giờ VN cho ngày hôm trước). Siêu dữ liệu lần chạy (nguồn, số dòng) ghi audit
 * `billing.reconciliation_run` (DDL không có cột – không thêm migration).
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = getLogger({ component: 'billing.reconcile' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly dbs: DbService,
    private readonly providers: PaymentProviderRegistry,
    private readonly audit: AuditService,
  ) {}

  private dbProvider(code: string): DbProvider {
    return (code === 'mock' ? 'manual' : code) as DbProvider;
  }

  async systemRows(provider: string, forDate: string): Promise<ReconRow[]> {
    const { start, end } = vnDayRange(forDate);
    const rows = await this.dbs.db
      .select({ txn: billingPayments.providerTxnId, raw: billingPayments.rawCallback, orderId: billingPayments.orderId, amount: billingPayments.amount, status: billingPayments.status })
      .from(billingPayments)
      .where(and(eq(billingPayments.provider, this.dbProvider(provider)), inArray(billingPayments.status, ['success', 'refunded']), gte(billingPayments.confirmedAt, start), lt(billingPayments.confirmedAt, end)));
    return rows.map((r) => ({ provider_txn_id: r.txn, merchant_ref: ((r.raw as Record<string, unknown> | null)?.merchant_ref as string | undefined) ?? null, order_id: r.orderId, amount: toVnd(r.amount), status: r.status === 'refunded' ? 'refunded' : 'success' }));
  }

  /** Sao kê từ queryStatus: mỗi giao dịch hệ thống hỏi lại cổng (phát hiện "hệ thống paid nhưng cổng không") */
  private async queryStatement(provider: string, system: ReconRow[], forDate: string): Promise<ReconRow[]> {
    const p = this.providers.byDbProvider(this.dbProvider(provider));
    if (!p) throw new ValidationFailed({ issues: [{ path: 'provider', message: 'provider unavailable for query reconciliation', code: 'provider_unavailable' }] });
    const out: ReconRow[] = [];
    for (const s of system) {
      if (!s.merchant_ref) continue;
      const r = await p.queryStatus({ merchantRef: s.merchant_ref, createdAt: vnDayRange(forDate).start, amount: s.amount, providerTxnId: s.provider_txn_id });
      if (!r) continue;
      out.push({ provider_txn_id: r.providerTxnId ?? s.provider_txn_id, merchant_ref: s.merchant_ref, amount: Number.isFinite(r.amount) ? r.amount : -1, status: r.status === 'paid' ? s.status : 'failed' });
    }
    return out;
  }

  async run(input: ReconciliationRunInput, actor: { id: string; roles: string[] } | null): Promise<ReconciliationRun> {
    const forDate = input.for_date ?? vnDate(new Date(this.clock.now() - 86_400_000));
    const system = await this.systemRows(input.provider, forDate);
    let statement: ReconRow[];
    if (input.source === 'csv') {
      if (!input.csv) throw new ValidationFailed({ issues: [{ path: 'csv', message: 'csv is required when source = csv', code: 'csv_required' }] });
      try {
        statement = parseStatementCsv(input.csv, { stripAppTransPrefix: input.provider === 'zalopay' });
      } catch (err) {
        if (err instanceof CsvFormatError) throw new ValidationFailed({ issues: [{ path: 'csv', message: err.message, code: 'csv_invalid' }] });
        throw err;
      }
    } else statement = await this.queryStatement(input.provider, system, forDate);
    const diff = diffReconciliation(system, statement);
    const status = diff.mismatches.length ? 'mismatched' : 'matched';
    const values = { provider: this.dbProvider(input.provider), forDate, expectedTotal: String(diff.expectedTotal), actualTotal: String(diff.actualTotal), mismatches: diff.mismatches, status, runAt: new Date(this.clock.now()) };
    const [row] = await this.dbs.db
      .insert(billingReconciliationRuns)
      .values(values)
      .onConflictDoUpdate({ target: [billingReconciliationRuns.provider, billingReconciliationRuns.forDate], set: { expectedTotal: values.expectedTotal, actualTotal: values.actualTotal, mismatches: values.mismatches, status, runAt: values.runAt } })
      .returning();
    const meta = { source: input.source, system_count: system.length, statement_count: statement.length, matched_count: diff.matched, mismatch_count: diff.mismatches.length };
    await this.audit.log({ action: 'billing.reconciliation_run', actorUserId: actor?.id ?? null, actorRole: actor?.roles.join(',') ?? 'system', entityType: 'reconciliation_run', entityId: row!.id, after: { provider: input.provider, for_date: forDate, status, ...meta } });
    this.logger.info({ provider: input.provider, for_date: forDate, status, ...meta }, 'reconciliation run');
    return this.toDto(row!, meta);
  }

  private toDto(r: RunRow, meta: { source?: string; system_count?: number; statement_count?: number; matched_count?: number } | null): ReconciliationRun {
    const mismatches = (r.mismatches ?? []) as ReconciliationMismatch[];
    return {
      id: r.id,
      provider: r.provider === 'manual' ? 'mock' : r.provider,
      for_date: String(r.forDate),
      status: r.status as ReconciliationRun['status'],
      expected_total: r.expectedTotal === null ? null : Number(r.expectedTotal),
      actual_total: r.actualTotal === null ? null : Number(r.actualTotal),
      mismatches,
      mismatch_count: mismatches.length,
      run_at: r.runAt.toISOString(),
      source: meta?.source ?? null,
      system_count: meta?.system_count ?? null,
      statement_count: meta?.statement_count ?? null,
      matched_count: meta?.matched_count ?? null,
    };
  }

  private async metaOf(runId: string) {
    const [a] = await this.dbs.db
      .select({ after: opsAuditLogs.after })
      .from(opsAuditLogs)
      .where(and(eq(opsAuditLogs.entityType, 'reconciliation_run'), eq(opsAuditLogs.entityId, runId)))
      .orderBy(desc(opsAuditLogs.createdAt))
      .limit(1);
    return (a?.after as { source?: string; system_count?: number; statement_count?: number; matched_count?: number } | null) ?? null;
  }

  async list(q: { provider?: string; limit: number }): Promise<ReconciliationRun[]> {
    const rows = await this.dbs.db
      .select()
      .from(billingReconciliationRuns)
      .where(q.provider ? eq(billingReconciliationRuns.provider, this.dbProvider(q.provider)) : undefined)
      .orderBy(desc(billingReconciliationRuns.forDate), desc(billingReconciliationRuns.runAt))
      .limit(q.limit);
    return rows.map((r) => this.toDto(r, null));
  }

  async get(runId: string): Promise<ReconciliationRun> {
    const [r] = await this.dbs.db.select().from(billingReconciliationRuns).where(eq(billingReconciliationRuns.id, runId)).limit(1);
    if (!r) throw new NotFound('reconciliation_run', runId);
    return this.toDto(r, await this.metaOf(runId));
  }

  async csv(runId: string): Promise<string> {
    return mismatchesToCsv((await this.get(runId)).mismatches);
  }

  /** Job billing.reconcile: hôm qua (giờ VN), mọi cổng khả dụng; không ghi đè lần chạy đã có (vd CSV tải tay) */
  async daily(now: Date = new Date(this.clock.now())): Promise<{ runs: number; mismatched: number; skipped: number; for_date: string; details: DailyReconDetail[] }> {
    const forDate = vnDate(new Date(now.getTime() - 86_400_000));
    let runs = 0;
    let mismatched = 0;
    let skipped = 0;
    const details: DailyReconDetail[] = [];
    for (const p of this.providers.listAvailable()) {
      const [exists] = await this.dbs.db.select({ id: billingReconciliationRuns.id }).from(billingReconciliationRuns).where(and(eq(billingReconciliationRuns.provider, p.dbProvider), sql`${billingReconciliationRuns.forDate} = ${forDate}::date`)).limit(1);
      if (exists) {
        skipped++;
        details.push({ provider: p.code, status: 'skipped', mismatches: 0, run_id: exists.id, error: null });
        continue;
      }
      try {
        const r = await this.run({ provider: p.code, for_date: forDate, source: 'query' }, null);
        runs++;
        if (r.status === 'mismatched') mismatched++;
        details.push({ provider: p.code, status: r.status, mismatches: r.mismatches.length, run_id: r.id, error: null });
      } catch (err) {
        this.logger.warn({ provider: p.code, err: (err as Error).message.slice(0, 200) }, 'daily reconciliation failed');
        details.push({ provider: p.code, status: 'error', mismatches: 0, run_id: null, error: (err as Error).message.slice(0, 200) });
      }
    }
    return { runs, mismatched, skipped, for_date: forDate, details };
  }
}

export interface DailyReconDetail {
  provider: string;
  status: string;
  mismatches: number;
  run_id: string | null;
  error: string | null;
}

/** S12: nội dung email báo cáo đối soát hằng ngày (không PII – chỉ cổng, trạng thái, số lệch, id lần chạy) */
export function reconciliationEmail(r: { for_date: string; runs: number; mismatched: number; skipped: number; details: DailyReconDetail[] }, adminUrl: string): { subject: string; text: string; html: string } {
  const ok = r.mismatched === 0 && !r.details.some((d) => d.status === 'error');
  const subject = `[Allingo billing] Đối soát ${r.for_date}: ${ok ? 'khớp' : `${r.mismatched} cổng lệch${r.details.some((d) => d.status === 'error') ? ', có lỗi' : ''}`}`;
  const rows = r.details.map((d) => `${d.provider.padEnd(8)} ${d.status.padEnd(10)} lệch=${d.mismatches}${d.run_id ? ` run=${d.run_id}` : ''}${d.error ? ` lỗi=${d.error}` : ''}`);
  const text = [`Đối soát thanh toán ngày ${r.for_date} (giờ VN)`, `Lần chạy: ${r.runs}, lệch: ${r.mismatched}, bỏ qua (đã có): ${r.skipped}`, '', ...rows, '', `Chi tiết + CSV: ${adminUrl}/admin/billing/reconciliations`, 'Runbook: docs/runbooks/payments.md'].join('\n');
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<h1>Đối soát ${esc(r.for_date)}</h1><p>Lần chạy: <strong>${r.runs}</strong> · lệch: <strong>${r.mismatched}</strong> · bỏ qua: ${r.skipped}</p><table border="1" cellpadding="4"><tr><th>Cổng</th><th>Trạng thái</th><th>Số lệch</th><th>Run</th></tr>${r.details.map((d) => `<tr><td>${esc(d.provider)}</td><td>${esc(d.status)}${d.error ? ` – ${esc(d.error)}` : ''}</td><td>${d.mismatches}</td><td>${esc(d.run_id ?? '')}</td></tr>`).join('')}</table><p><a href="${esc(adminUrl)}/admin/billing/reconciliations">Mở trang đối soát</a></p>`;
  return { subject, text, html };
}
