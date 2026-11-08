import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { FunnelEvent, FunnelEventInput } from '@allingo/schemas';
import { ENV, type Env } from '../../../config/env.js';
import { RedisService } from '../../../shared/cache/redis.module.js';
import { CLOCK, type Clock } from '../../../shared/clock/clock.module.js';
import { getLogger } from '../../../shared/telemetry/logger.js';
import { UsersService } from '../../iam/index.js';
import { AttemptsService } from '../../test-engine/index.js';
import { ANALYTICS_SINK, analyticsSalt, hashUserId, type AnalyticsSink } from './analytics-sink.js';

type Props = Record<string, string | number | boolean | null>;
const DEDUPE_TTL_SECONDS = 30 * 86_400;
const CLIENT_RATE_PER_MINUTE = 60;
const PII_VALUE = /[^\s@]+@[^\s@]+\.[^\s@]+|\+?\d[\d\s.-]{8,}\d/;

/**
 * Phễu server-side (Sprint 10): outbox `user.registered` → signup_done, `attempt.graded` → diagnostic_done (mode diagnostic) +
 * first_attempt (bài chấm đầu tiên của chương trình), `order.paid` → order_paid. Chỉ nghe outbox (relay ở worker – một lần/sự
 * kiện), chống trùng bằng Redis NX + uuid xác định. Tài khoản khách bỏ qua. POST /analytics/events nhận landing_view /
 * signup_start / checkout_start khi người dùng ĐÃ đồng ý cookie.
 */
@Injectable()
export class FunnelService {
  private readonly logger = getLogger({ component: 'analytics.funnel' });
  private readonly salt: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(ANALYTICS_SINK) private readonly sink: AnalyticsSink,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly attempts: AttemptsService,
  ) {
    this.salt = analyticsSalt(env);
  }

  distinctId(userId: string): string {
    return hashUserId(userId, this.salt);
  }

  /** Gửi một sự kiện server (idempotent theo dedupeKey) */
  async emit(event: FunnelEvent, userId: string, dedupeKey: string, properties: Props, at: Date = new Date(this.clock.now())): Promise<boolean> {
    if (!this.sink.enabled) return false;
    const user = await this.users.findById(userId);
    if (!user || user.isGuest) return false;
    const first = await this.redis.safe((r) => r.set(`funnel:sent:${dedupeKey}`, '1', 'EX', DEDUPE_TTL_SECONDS, 'NX'));
    if (first === null && this.redis.isHealthy) return false;
    const ok = await this.sink.capture({ event, distinct_id: this.distinctId(userId), dedupe_key: dedupeKey, properties: { ...properties, source: 'server' }, timestamp: at.toISOString() });
    if (!ok) await this.redis.safe((r) => r.del(`funnel:sent:${dedupeKey}`));
    return ok;
  }

  @OnEvent('outbox.user.registered')
  async onRegistered(ev: { payload: { user_id: string; provider?: string; merged_guest?: boolean; referral_code?: string | null; attribution?: { channel?: string; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null } }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    const a = p.attribution ?? {};
    await this.emit('signup_done', p.user_id, `signup_done:${p.user_id}`, { provider: p.provider ?? null, merged_guest: !!p.merged_guest, referred: !!p.referral_code, channel: a.channel ?? 'direct', utm_source: a.utm_source ?? null, utm_medium: a.utm_medium ?? null, utm_campaign: a.utm_campaign ?? null }, ev.created_at).catch((err: Error) => this.warn(err, 'signup_done'));
  }

  @OnEvent('outbox.attempt.graded')
  async onGraded(ev: { payload: { attempt_id: string; user_id: string; program?: string; mode?: string; scaled_score?: number | null; total?: number }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.attempt_id || !p.user_id) return;
    const program = p.program ?? 'toeic';
    try {
      if (p.mode === 'diagnostic') await this.emit('diagnostic_done', p.user_id, `diagnostic_done:${p.attempt_id}`, { program, scaled_score: p.scaled_score ?? null, questions: p.total ?? null }, ev.created_at);
      const pos = await this.attempts.gradedPosition(p.user_id, program, p.attempt_id);
      if (pos === 1) await this.emit('first_attempt', p.user_id, `first_attempt:${p.user_id}:${program}`, { program, mode: p.mode ?? null }, ev.created_at);
    } catch (err) {
      this.warn(err as Error, 'attempt funnel');
    }
  }

  @OnEvent('outbox.order.paid')
  async onPaid(ev: { payload: { order_id: string; user_id: string; plan_code?: string; plan_kind?: string; total?: number; currency?: string; provider?: string; promotion_code?: string | null }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.order_id || !p.user_id) return;
    await this.emit('order_paid', p.user_id, `order_paid:${p.order_id}`, { plan_code: p.plan_code ?? null, plan_kind: p.plan_kind ?? null, revenue: p.total ?? null, currency: p.currency ?? 'VND', provider: p.provider ?? null, promotion: !!p.promotion_code }, ev.created_at).catch((err: Error) => this.warn(err, 'order_paid'));
  }

  /** POST /analytics/events (client, đã đồng ý cookie) */
  async clientEvent(input: FunnelEventInput, userId: string | null, ip: string | null): Promise<{ accepted: boolean; reason: 'ok' | 'no_consent' | 'disabled' | 'rate_limited' }> {
    if (!input.consent) return { accepted: false, reason: 'no_consent' };
    if (!this.sink.enabled) return { accepted: false, reason: 'disabled' };
    const minute = Math.floor(this.clock.now() / 60_000);
    const n = await this.redis.safe(async (r) => {
      const k = `funnel:rl:${ip ?? 'unknown'}:${minute}`;
      const v = await r.incr(k);
      if (v === 1) await r.expire(k, 120);
      return v;
    });
    if (n !== null && n > CLIENT_RATE_PER_MINUTE) return { accepted: false, reason: 'rate_limited' };
    const props: Props = {};
    for (const [k, v] of Object.entries(input.properties ?? {}).slice(0, 20)) {
      if (typeof v === 'string' && PII_VALUE.test(v)) continue;
      props[k] = v;
    }
    if (input.path) props.path = input.path.split(/[?#]/)[0]!.slice(0, 256);
    const distinct = userId ? this.distinctId(userId) : input.anonymous_id;
    const at = new Date(this.clock.now());
    const ok = await this.sink.capture({ event: input.event, distinct_id: distinct, dedupe_key: `${input.event}:${distinct}:${at.getTime()}`, properties: { ...props, source: 'client_relay', $anon_distinct_id: userId ? input.anonymous_id : null }, timestamp: at.toISOString() });
    return { accepted: ok, reason: ok ? 'ok' : 'disabled' };
  }

  // ------------------------------------------------------------------ S12: sự kiện beta (outbox → PostHog, không PII)
  @OnEvent('outbox.beta.redeemed')
  async onBetaRedeemed(ev: { id?: string; payload: { invite_id: string; user_id: string; program?: string; trial?: boolean }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    await this.emit('beta_redeemed', p.user_id, `beta_redeemed:${p.user_id}`, { program: p.program ?? null, trial: p.trial ?? null }, ev.created_at).catch((err: Error) => this.warn(err, 'beta_redeemed'));
  }

  @OnEvent('outbox.survey.submitted')
  async onSurvey(ev: { payload: { user_id: string; kind: string; score?: number; goal?: string }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    await this.emit('survey_submitted', p.user_id, `survey:${p.user_id}:${p.kind}`, { kind: p.kind, score: typeof p.score === 'number' ? p.score : null, goal: p.goal ?? null }, ev.created_at).catch((err: Error) => this.warn(err, 'survey_submitted'));
  }

  @OnEvent('outbox.feedback.submitted')
  async onFeedback(ev: { payload: { feedback_id: string; user_id: string; category: string; has_screenshot?: boolean }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    await this.emit('feedback_submitted', p.user_id, `feedback:${p.feedback_id}`, { category: p.category, has_screenshot: !!p.has_screenshot }, ev.created_at).catch((err: Error) => this.warn(err, 'feedback_submitted'));
  }

  @OnEvent('outbox.content_report.created')
  async onContentReport(ev: { payload: { report_id: string; user_id: string; reason: string }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    await this.emit('content_reported', p.user_id, `content_report:${p.report_id}`, { reason: p.reason }, ev.created_at).catch((err: Error) => this.warn(err, 'content_reported'));
  }

  @OnEvent('outbox.support_ticket.created')
  async onTicket(ev: { payload: { ticket_id: string; user_id: string; category: string }; created_at?: Date }): Promise<void> {
    const p = ev?.payload;
    if (!p?.user_id) return;
    await this.emit('support_ticket_created', p.user_id, `support_ticket:${p.ticket_id}`, { category: p.category }, ev.created_at).catch((err: Error) => this.warn(err, 'support_ticket_created'));
  }

  private warn(err: Error, what: string): void {
    this.logger.warn({ err: err.message.slice(0, 160) }, `funnel ${what} failed`);
  }
}
