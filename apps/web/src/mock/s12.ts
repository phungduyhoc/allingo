import { type User } from '@allingo/schemas/api/core';
import { BETA_DEFAULTS, CONTENT_REPORT_SLA_HOURS, adminBetaInviteSendInputSchema, SUPPORT_FIRST_RESPONSE_SLA_HOURS, betaSurveyInputSchema, contentReportInputSchema, feedbackInputSchema, isStaffRoles, npsInputSchema, supportTicketInputSchema } from '@allingo/schemas/api/s12';
import { env } from '@/env';
import { addLedger, notify } from './billing-core';
import type { MockState, MockUserRecord } from './state';
import { randomBase32, verifyTotp } from './totp';

/**
 * "Máy chủ" giả lập Sprint 12 (dev:mock / E2E mock) bám OpenAPI v1.1 nhóm S12: beta gate (403 `beta_required`), đổi mã mời
 * `ALG-XXXX-XXXX`, khảo sát onboarding + NPS, góp ý + ảnh (presign/PUT giả), báo lỗi câu, ticket hỗ trợ 2 chiều, văn bản pháp lý,
 * MFA TOTP (RFC 6238 qua Web Crypto) + step-up (403 `mfa_required` khi bật `requireAdminMfa`), admin beta/feedback/nội dung/hỗ trợ/
 * người dùng (khoá → phiên bị thu hồi, impersonate chỉ đọc)/AI/hệ thống/DLQ/audit/báo cáo beta. Mã mời chỉ nằm trong "hộp thư giả"
 * (`__ALLINGO_MOCK__.lastInviteCode(email)`) như email thật. Không chứa logic nghiệp vụ thật.
 */

export interface MockS12State {
  waitlist: Array<{ id: string; email: string; program: string; locale: string; consent_marketing: boolean; source: string | null; status: 'waiting' | 'invited' | 'joined' | 'removed'; created_at: string }>;
  invites: Record<string, { id: string; code: string; email: string; program: string; locale: string; status: 'queued' | 'sent' | 'redeemed' | 'revoked' | 'expired' | 'failed'; batch: string | null; waitlist_entry_id: string | null; sent_at: string | null; expires_at: string | null; redeemed_at: string | null; redeemed_by: string | null; send_attempts: number; grant: { trial_ends_at: string | null; trial_skipped: 'already_pro' | null; credits: number } | null; created_at: string }>;
  /** "Hộp thư" email mời đã gửi (E2E đọc mã như đọc email) */
  outbox: Array<{ to: string; code: string; at: string }>;
  surveys: Record<string, Partial<Record<'beta_onboarding' | 'nps_d7' | 'nps_d14', { submitted_at: string; score: number | null; answers: unknown }>>>;
  /** E2E: ép NPS đến hạn cho người dùng (thay vì chờ 7 ngày) */
  npsDue: Record<string, 'nps_d7' | 'nps_d14'>;
  uploads: Record<string, { user_id: string; mime: string; size: number; uploaded: boolean }>;
  feedback: Record<string, { id: string; user_id: string; category: string; message: string; page_url: string | null; trace_id: string; screenshot_id: string | null; app_version: string | null; status: string; created_at: string }>;
  reports: Record<string, { id: string; user_id: string; question_version_id: string; reason: string; message: string | null; status: 'open' | 'confirmed' | 'rejected' | 'fixed'; resolution_note: string | null; sla_due_at: string; created_at: string; updated_at: string; resolved_at: string | null }>;
  tickets: Record<string, { id: string; user_id: string; subject: string; category: string; status: 'open' | 'waiting_user' | 'resolved' | 'closed'; priority: 'low' | 'normal' | 'high' | 'urgent'; context: Record<string, unknown>; assigned_to: string | null; first_response_due_at: string; first_responded_at: string | null; created_at: string; updated_at: string; closed_at: string | null; messages: Array<{ id: string; author: 'user' | 'agent' | 'system'; body: string; created_at: string }> }>;
  mfa: Record<string, { secret: string; confirmed: boolean; recovery: string[]; last_step: number | null }>;
  /** Phiên hiện tại đã step-up (mock một phiên/tab) */
  sessionMfa: Record<string, boolean>;
  requireAdminMfa: boolean;
  locked: Record<string, { reason: string; at: string }>;
  deletions: Record<string, { request_id: string; due_at: string; reason: string }>;
  impersonations: Record<string, { user_id: string; admin_id: string; expires: number }>;
  deadLetters: Record<string, { id: string; queue: string; job: string | null; job_id: string; error: string | null; attempts: number | null; failed_at: string; replayed_at: string | null; replay_count: number }>;
  audit: Array<{ id: number; actor_user_id: string | null; actor_role: string | null; action: string; entity_type: string | null; entity_id: string | null; before: unknown; after: unknown; created_at: string }>;
  statsComputedAt: string | null;
}

export function emptyS12(): MockS12State {
  return { waitlist: [], invites: {}, outbox: [], surveys: {}, npsDue: {}, uploads: {}, feedback: {}, reports: {}, tickets: {}, mfa: {}, sessionMfa: {}, requireAdminMfa: false, locked: {}, deletions: {}, impersonations: {}, deadLetters: {}, audit: [], statsComputedAt: null };
}

type Ctx = { url: URL; params: Record<string, string>; body: unknown; method: string; locale: string; headers: Headers };
type Handler = (ctx: Ctx) => Promise<Response> | Response;

export interface S12Deps<R> {
  state: MockState;
  persist: () => void;
  route: (method: string, path: string, handler: Handler) => R;
  json: (status: number, body: unknown, headers?: Record<string, string>) => Response;
  error: (status: number, code: string, message: string, details?: Record<string, unknown>) => Response;
  uuid: () => string;
  nowIso: () => string;
  requireUser: () => MockUserRecord | Response;
  currentUser: () => MockUserRecord | null;
  publicUser: (u: MockUserRecord) => User;
  flagOn: (key: string) => boolean;
  questionByVersion: (qv: string) => { question_id: string; section_code: string; stem: string | null; external_ref?: string | null } | undefined;
  isPro: (u: MockUserRecord) => boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const INTERNAL_ROLES = ['admin', 'superadmin', 'teacher', 'editor', 'service', 'beta_tester'];
const MFA_ROLES = ['admin', 'superadmin'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const isAdminUser = (u: MockUserRecord | null) => !!u?.roles.some((r) => MFA_ROLES.includes(r));
const maskEmail = (e: string | null | undefined) => (e ? e.replace(/^(.{0,2})[^@]*(@.*)$/, '$1***$2') : null);
const normalizeCode = (c: string) => {
  const s = c.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.startsWith('ALG') ? s : `ALG${s}`;
};
const pick = () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
const genCode = () => `ALG-${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
const vnDayStart = (t: number) => {
  const v = new Date(t + 7 * HOUR);
  return Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()) - 7 * HOUR;
};
const enc = (n: number) => btoa(String(n));
const dec = (c: string | null) => {
  const n = c ? Number(atob(c)) : 0;
  return Number.isFinite(n) ? n : 0;
};
function page<T>(rows: T[], url: URL, def = 30): { data: T[]; next_cursor: string | null } {
  const limit = Math.min(200, Number(url.searchParams.get('limit') ?? def) || def);
  const off = dec(url.searchParams.get('cursor'));
  return { data: rows.slice(off, off + limit), next_cursor: off + limit < rows.length ? enc(off + limit) : null };
}
const countBy = <T>(rows: T[], key: (r: T) => string) => rows.reduce<Record<string, number>>((m, r) => ((m[key(r)] = (m[key(r)] ?? 0) + 1), m), {});

/** Đường dẫn không bị beta gate chặn (như @Public / @BetaExempt của API – A194) */
export function betaExempt(method: string, path: string): boolean {
  if (path === '/me') return method === 'GET' || method === 'PATCH' || method === 'DELETE';
  // B6/S150: góp ý miễn gate (gửi được từ trang /beta); /uploads/presign (ảnh) vẫn theo gate
  if (path === '/feedback') return method === 'POST';
  const prefixes = ['/auth/', '/flags', '/legal/', '/beta/', '/waitlist', '/support/tickets', '/me/support/', '/me/mfa', '/me/sessions', '/me/consents', '/programs', '/plans', '/payments/providers', '/payments/mock', '/referrals/', '/r/', '/lessons', '/analytics/events', '/promotions/validate', '/notifications/manage', '/notifications/unsubscribe', '/push/vapid-public-key', '/mock-upload/'];
  return prefixes.some((p) => path === p.replace(/\/$/, '') || path.startsWith(p));
}

export function s12Mock<R>(d: S12Deps<R>) {
  const { state, persist, route, json, error, uuid, nowIso, requireUser, currentUser } = d;
  const s = (): MockS12State => {
    const st = state as MockState & { s12?: MockS12State };
    st.s12 = { ...emptyS12(), ...(st.s12 ?? {}) };
    return st.s12;
  };
  const audit = (action: string, actor: MockUserRecord | null, entity_type: string | null, entity_id: string | null, after: unknown = null, before: unknown = null) => {
    const list = s().audit;
    list.unshift({ id: (list[0]?.id ?? 1000) + 1, actor_user_id: actor?.id ?? null, actor_role: actor?.roles.join(',') ?? 'service', action, entity_type, entity_id, before, after, created_at: nowIso() });
  };
  const requireAdmin = (): MockUserRecord | Response => {
    const u = currentUser();
    if (!u) return error(401, 'unauthorized', 'Session expired');
    if (!isAdminUser(u)) return error(403, 'forbidden', 'Insufficient role', { required: ['admin'] });
    return u;
  };
  const redeemedInvite = (userId: string) => Object.values(s().invites).find((i) => i.redeemed_by === userId) ?? null;
  const betaAccess = (u: MockUserRecord): { allowed: boolean; reason: 'gate_off' | 'role' | 'invite' | 'allowlist' | 'none' } => {
    if (!d.flagOn('ff.growth.beta_gate')) return { allowed: true, reason: 'gate_off' };
    if (u.roles.some((r) => INTERNAL_ROLES.includes(r))) return { allowed: true, reason: u.roles.includes('beta_tester') && redeemedInvite(u.id) ? 'invite' : 'role' };
    return { allowed: false, reason: 'none' };
  };
  const ticketDto = (t: MockS12State['tickets'][string], withMessages = true) => {
    const { user_id: _u, context: _c, assigned_to: _a, closed_at: _cl, messages, ...rest } = t;
    return { ...rest, last_message_at: messages.at(-1)?.created_at ?? t.created_at, ...(withMessages ? { messages } : {}) };
  };
  const adminTicketDto = (t: MockS12State['tickets'][string], withMessages = true) => {
    const u = state.users[t.user_id];
    return { ...ticketDto(t, withMessages), user: u ? { id: u.id, display_name: u.display_name, email_masked: maskEmail(u.email), status: s().locked[u.id] ? 'suspended' : 'active' } : null, assigned_to: t.assigned_to, overdue: !t.first_responded_at && Date.parse(t.first_response_due_at) < Date.now() && (t.status === 'open' || t.status === 'waiting_user'), context: t.context, closed_at: t.closed_at };
  };
  const reportDto = (r: MockS12State['reports'][string]) => {
    const q = d.questionByVersion(r.question_version_id);
    const { user_id: _u, ...rest } = r;
    return { ...rest, question_id: q?.question_id ?? null, version_no: 1, external_ref: q?.external_ref ?? null, section_code: q?.section_code ?? null, stem_preview: q?.stem?.slice(0, 160) ?? null, overdue: r.status === 'open' && Date.parse(r.sla_due_at) < Date.now(), reports_for_question: Object.values(s().reports).filter((x) => x.question_version_id === r.question_version_id).length };
  };
  const userSummary = (u: MockUserRecord) => ({ id: u.id, display_name: u.display_name, email_masked: maskEmail(u.email), status: s().deletions[u.id] ? 'pending_deletion' : s().locked[u.id] ? 'suspended' : 'active', is_guest: u.is_guest, roles: u.roles, created_at: u.created_at });
  const npsPending = (u: MockUserRecord): Array<{ kind: 'beta_onboarding' | 'nps_d7' | 'nps_d14'; due_at: string; expires_at: string | null }> => {
    const done = s().surveys[u.id] ?? {};
    const out: Array<{ kind: 'beta_onboarding' | 'nps_d7' | 'nps_d14'; due_at: string; expires_at: string | null }> = [];
    const inv = redeemedInvite(u.id);
    // B6/S146 (như API): chỉ beta tester (đổi mã/vai trò beta_tester) nhận khảo sát; nhân sự (STAFF_ROLES) không nhận
    if (!(u.roles.includes('beta_tester') || inv) || isStaffRoles(u.roles)) return out;
    if (!done.beta_onboarding) out.push({ kind: 'beta_onboarding', due_at: inv?.redeemed_at ?? u.created_at, expires_at: null });
    const base = Date.parse(inv?.redeemed_at ?? u.created_at);
    const forced = s().npsDue[u.id];
    for (const [kind, day, until] of [
      ['nps_d7', 7, 14],
      ['nps_d14', 14, 28],
    ] as const) {
      if (done[kind]) continue;
      if (forced === kind || (Date.now() >= base + day * DAY && Date.now() < base + until * DAY)) out.push({ kind, due_at: new Date(Math.min(Date.now() - 60_000, base + day * DAY)).toISOString(), expires_at: new Date(Math.max(Date.now() + DAY, base + until * DAY)).toISOString() });
    }
    return out;
  };

  /**
   * Chạy TRƯỚC định tuyến (như AuthGuard/BetaGateGuard của API): token impersonate (chỉ đọc), tài khoản bị khoá (phiên thu hồi),
   * step-up MFA cho /admin/*, beta gate. Trả Response để dừng; `{ asUser }` để chạy handler với người dùng impersonate.
   */
  const guard = (method: string, path: string, headers: Headers, body: unknown): Response | { asUser: string } | null => {
    const auth = headers.get('authorization');
    if (auth?.startsWith('Bearer imp_')) {
      const tok = auth.slice(7);
      const imp = s().impersonations[tok];
      if (!imp || imp.expires < Date.now() || s().locked[imp.user_id]) return error(401, 'unauthorized', 'Impersonation token expired or revoked');
      audit('impersonation.request', state.users[imp.admin_id] ?? null, 'user', imp.user_id, { method, route: path });
      persist();
      if (method !== 'GET' && method !== 'HEAD') return error(403, 'forbidden', 'Impersonation token is read-only', { reason: 'impersonation_read_only' });
      if (path.startsWith('/admin')) return error(403, 'forbidden', 'Impersonation token is read-only', { reason: 'impersonation_admin_forbidden' });
      return { asUser: imp.user_id };
    }
    if (path === '/auth/login' && method === 'POST') {
      const email = (body as { email?: string } | null)?.email?.toLowerCase();
      const target = Object.values(state.users).find((u) => u.email?.toLowerCase() === email);
      if (target && s().locked[target.id]) return error(401, 'unauthorized', 'Account inactive', { reason: 'account_inactive' });
      // Phiên mới chưa step-up MFA (mock một phiên/người dùng)
      if (target) delete s().sessionMfa[target.id];
    }
    if (path === '/auth/logout' && method === 'POST') {
      const cur = currentUser();
      if (cur) delete s().sessionMfa[cur.id];
    }
    const u = currentUser();
    if (u && s().locked[u.id] && !path.startsWith('/auth/')) {
      // Phiên của tài khoản bị khoá đã bị thu hồi → như chưa đăng nhập
      state.sessionUserId = null;
      persist();
      return error(401, 'unauthorized', 'Session revoked');
    }
    if (u && path.startsWith('/admin') && s().requireAdminMfa && isAdminUser(u) && !s().sessionMfa[u.id]) {
      return error(403, 'mfa_required', 'Multi-factor authentication required for this operation', { enrolled: !!s().mfa[u.id]?.confirmed, enroll_path: '/auth/mfa/totp/enroll', verify_path: '/auth/mfa/verify', reason: 'step_up_required' });
    }
    if (u && !betaExempt(method, path) && !betaAccess(u).allowed) return error(403, 'beta_required', 'Closed beta: an invitation code is required', { message_key: 'errors.beta_required', redeem_path: '/beta/redeem' });
    return null;
  };

  const routes: R[] = [
    // ------------------------------------------------------------------ beta
    route('POST', '/waitlist', ({ body }) => {
      const b = body as { email?: string; program?: string; locale?: string; consent_marketing?: boolean; source?: string };
      if (!b?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email) || !['toeic', 'ielts', 'jlpt', 'hsk'].includes(b.program ?? '')) return error(400, 'validation_failed', 'Invalid waitlist input');
      const email = b.email.trim().toLowerCase();
      const ex = s().waitlist.find((w) => w.email === email && w.program === b.program);
      if (ex) {
        if (ex.status === 'waiting') Object.assign(ex, { locale: b.locale ?? ex.locale, consent_marketing: ex.consent_marketing || !!b.consent_marketing });
      } else s().waitlist.push({ id: uuid(), email, program: b.program!, locale: b.locale ?? 'vi', consent_marketing: !!b.consent_marketing, source: b.source ?? null, status: 'waiting', created_at: nowIso() });
      state.waitlist.push({ program: b.program!, locale: b.locale ?? 'vi', at: nowIso() });
      persist();
      return json(202, { status: 'accepted' });
    }),
    route('GET', '/beta/status', () => {
      const u = currentUser();
      const gate = d.flagOn('ff.growth.beta_gate');
      if (!u) return json(200, { gate_enabled: gate, has_access: null, reason: 'anonymous', redeemed_at: null, trial_ends_at: null, survey_completed: null });
      const a = betaAccess(u);
      const inv = redeemedInvite(u.id);
      return json(200, { gate_enabled: gate, has_access: a.allowed, reason: a.reason, redeemed_at: inv?.redeemed_at ?? null, trial_ends_at: inv?.grant?.trial_ends_at ?? null, survey_completed: !!s().surveys[u.id]?.beta_onboarding });
    }),
    route('POST', '/beta/redeem', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      if (u.is_guest) return error(403, 'forbidden', 'Sign up before redeeming an invitation', { reason: 'guest_not_allowed' });
      const code = (body as { code?: string } | null)?.code ?? '';
      if (code.length < 6 || code.length > 64) return error(400, 'validation_failed', 'Invalid input', { issues: [{ path: 'code', code: 'too_small' }] });
      const inv = Object.values(s().invites).find((i) => normalizeCode(i.code) === normalizeCode(code));
      const invalid = () => error(400, 'validation_failed', 'Invalid invitation code', { reason: 'invite_invalid', issues: [{ path: 'code', code: 'invite_invalid', message: 'invitation code is invalid or expired' }] });
      if (!inv) return invalid();
      const survey_pending = !s().surveys[u.id]?.beta_onboarding;
      if (inv.status === 'redeemed') {
        if (inv.redeemed_by !== u.id) return error(409, 'conflict', 'Invitation code already used', { reason: 'invite_used' });
        return json(200, { status: 'already_redeemed', invite_id: inv.id, program: inv.program, trial_ends_at: inv.grant?.trial_ends_at ?? null, trial_skipped: inv.grant?.trial_skipped ?? null, credits_granted: 0, balance: state.credits[u.id] ?? 0, survey_pending });
      }
      if (inv.status !== 'sent' || !inv.expires_at || Date.parse(inv.expires_at) < Date.now()) return invalid();
      if (redeemedInvite(u.id)) return error(409, 'conflict', 'You already joined the beta', { reason: 'already_beta' });
      const already = d.isPro(u);
      const trialEnds = already ? null : new Date(Date.now() + BETA_DEFAULTS.trial_days * DAY).toISOString();
      if (!already) {
        u.plan = 'monthly';
        u.plan_kind = 'monthly';
        const sid = uuid();
        state.subscriptions[sid] = { id: sid, user_id: u.id, plan_id: 'toeic_pro_monthly', program: 'toeic', status: 'trialing', current_period_start: nowIso(), current_period_end: trialEnds, cancel_at_period_end: true, source_order_id: null, created_at: nowIso() };
      }
      addLedger(state, u.id, { delta: BETA_DEFAULTS.credits, reason: 'promo', ref: { type: 'beta_invite', id: inv.id }, note: 'beta_invite', expires_at: new Date(Date.now() + BETA_DEFAULTS.credit_valid_days * DAY).toISOString() });
      if (!u.roles.includes('beta_tester')) u.roles = [...u.roles, 'beta_tester'];
      Object.assign(inv, { status: 'redeemed', redeemed_by: u.id, redeemed_at: nowIso(), grant: { trial_ends_at: trialEnds, trial_skipped: already ? 'already_pro' : null, credits: BETA_DEFAULTS.credits } });
      const w = s().waitlist.find((x) => x.id === inv.waitlist_entry_id);
      if (w) w.status = 'joined';
      audit('beta.redeemed', u, 'beta_invite', inv.id, { program: inv.program, credits: BETA_DEFAULTS.credits });
      persist();
      return json(200, { status: 'redeemed', invite_id: inv.id, program: inv.program, trial_ends_at: trialEnds, trial_skipped: already ? 'already_pro' : null, credits_granted: BETA_DEFAULTS.credits, balance: state.credits[u.id] ?? 0, survey_pending });
    }),

    // ------------------------------------------------------------------ khảo sát
    route('POST', '/me/beta-survey', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = betaSurveyInputSchema.safeParse(body);
      if (!p.success) return error(400, 'validation_failed', 'Invalid survey', { issues: p.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) });
      const at = nowIso();
      (s().surveys[u.id] ??= {}).beta_onboarding = { submitted_at: at, score: null, answers: p.data };
      persist();
      return json(200, { kind: 'beta_onboarding', submitted_at: at, score: null });
    }),
    route('GET', '/me/surveys/pending', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      return json(200, { data: npsPending(u) });
    }),
    route('POST', '/me/surveys/nps', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = npsInputSchema.safeParse(body);
      if (!p.success) return error(400, 'validation_failed', 'Invalid NPS');
      const kind = p.data.survey ?? npsPending(u).find((x) => x.kind !== 'beta_onboarding')?.kind;
      const done = s().surveys[u.id]?.[kind as 'nps_d7'];
      if (kind && done) return json(200, { kind, submitted_at: done.submitted_at, score: done.score });
      if (!kind || !npsPending(u).some((x) => x.kind === kind)) return error(409, 'conflict', 'No NPS survey due', { reason: 'not_due' });
      const at = nowIso();
      (s().surveys[u.id] ??= {})[kind as 'nps_d7'] = { submitted_at: at, score: p.data.score, answers: { comment: p.data.comment ?? null } };
      delete s().npsDue[u.id];
      persist();
      return json(200, { kind, submitted_at: at, score: p.data.score });
    }),

    // ------------------------------------------------------------------ ảnh, góp ý, báo lỗi câu
    route('POST', '/uploads/presign', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const b = body as { kind?: string; mime_type?: string; size_bytes?: number };
      if (b?.kind !== 'image' || !['image/png', 'image/jpeg', 'image/webp'].includes(b.mime_type ?? '') || !b.size_bytes || b.size_bytes > 20 * 1024 * 1024) return error(400, 'validation_failed', 'Invalid upload');
      const id = uuid();
      s().uploads[id] = { user_id: u.id, mime: b.mime_type!, size: b.size_bytes, uploaded: false };
      persist();
      return json(201, { upload_url: `${env.apiUrl}/mock-upload/${id}`, resource_id: id, expires_at: new Date(Date.now() + 600_000).toISOString() });
    }),
    route('PUT', '/mock-upload/{id}', ({ params, headers }) => {
      const up = s().uploads[params.id!];
      if (!up) return error(404, 'not_found', 'Upload not found');
      if (headers.get('content-type') !== up.mime) return error(403, 'forbidden', 'Signature mismatch (content-type)');
      up.uploaded = true;
      persist();
      return new Response(null, { status: 200 });
    }),
    route('POST', '/feedback', ({ body, headers }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = feedbackInputSchema.safeParse(body);
      if (!p.success) return error(400, 'validation_failed', 'Invalid feedback', { issues: p.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) });
      if (p.data.screenshot_upload_id) {
        const up = s().uploads[p.data.screenshot_upload_id];
        if (!up) return error(404, 'not_found', 'upload not found');
        if (up.user_id !== u.id) return error(400, 'validation_failed', 'screenshot must be an image uploaded by you', { issues: [{ path: 'screenshot_upload_id', code: 'invalid_upload' }] });
      }
      const id = uuid();
      const trace = p.data.trace_id ?? `mock${Math.random().toString(16).slice(2, 14)}`;
      s().feedback[id] = { id, user_id: u.id, category: p.data.category, message: p.data.message, page_url: p.data.page_url ?? null, trace_id: trace, screenshot_id: p.data.screenshot_upload_id ?? null, app_version: p.data.app_version ?? null, status: 'new', created_at: nowIso() };
      void headers;
      persist();
      return json(201, { id, status: 'new', trace_id: trace, created_at: s().feedback[id]!.created_at });
    }),
    route('POST', '/content-reports', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const p = contentReportInputSchema.safeParse(body);
      if (!p.success) return error(400, 'validation_failed', 'Invalid report');
      if (!d.questionByVersion(p.data.question_version_id)) return error(404, 'not_found', 'question_version not found');
      const dup = Object.values(s().reports).find((r) => r.user_id === u.id && r.question_version_id === p.data.question_version_id && r.status === 'open');
      if (dup) return json(201, { id: dup.id, status: dup.status, sla_due_at: dup.sla_due_at, duplicate: true, created_at: dup.created_at });
      const id = uuid();
      const at = nowIso();
      s().reports[id] = { id, user_id: u.id, question_version_id: p.data.question_version_id, reason: p.data.reason, message: p.data.message ?? null, status: 'open', resolution_note: null, sla_due_at: new Date(Date.now() + CONTENT_REPORT_SLA_HOURS * HOUR).toISOString(), created_at: at, updated_at: at, resolved_at: null };
      persist();
      return json(201, { id, status: 'open', sla_due_at: s().reports[id]!.sla_due_at, duplicate: false, created_at: at });
    }),

    // ------------------------------------------------------------------ hỗ trợ (người học)
    route('POST', '/support/tickets', ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      if (u.is_guest) return error(403, 'forbidden', 'Sign up to contact support');
      const p = supportTicketInputSchema.safeParse(body);
      if (!p.success) return error(400, 'validation_failed', 'Invalid ticket');
      const id = uuid();
      const at = nowIso();
      s().tickets[id] = { id, user_id: u.id, subject: p.data.subject, category: p.data.category, status: 'open', priority: 'normal', context: { trace_id: p.data.trace_id ?? null, attempt_id: p.data.attempt_id ?? null, page: p.data.page_url ?? null }, assigned_to: null, first_response_due_at: new Date(Date.now() + SUPPORT_FIRST_RESPONSE_SLA_HOURS * HOUR).toISOString(), first_responded_at: null, created_at: at, updated_at: at, closed_at: null, messages: [{ id: uuid(), author: 'user', body: p.data.message, created_at: at }] };
      persist();
      return json(201, ticketDto(s().tickets[id]!));
    }),
    route('GET', '/me/support/tickets', ({ url }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const rows = Object.values(s().tickets).filter((t) => t.user_id === u.id).sort((a, b) => b.created_at.localeCompare(a.created_at)).map((t) => ticketDto(t, false));
      return json(200, page(rows, url, 20));
    }),
    route('GET', '/me/support/tickets/{ticketId}', ({ params }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const t = s().tickets[params.ticketId!];
      if (!t || t.user_id !== u.id) return error(404, 'not_found', 'Ticket not found');
      return json(200, ticketDto(t));
    }),
    route('POST', '/support/tickets/{ticketId}/messages', ({ params, body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const t = s().tickets[params.ticketId!];
      if (!t || t.user_id !== u.id) return error(404, 'not_found', 'Ticket not found');
      if (t.status === 'closed') return error(409, 'conflict', 'Ticket closed', { reason: 'ticket_closed' });
      const msg = ((body as { message?: string } | null)?.message ?? '').trim();
      if (!msg) return error(400, 'validation_failed', 'Message required');
      t.messages.push({ id: uuid(), author: 'user', body: msg.slice(0, 8000), created_at: nowIso() });
      t.status = 'open';
      t.updated_at = nowIso();
      persist();
      return json(201, ticketDto(t));
    }),

    // ------------------------------------------------------------------ pháp lý
    route('GET', '/legal/policies', () => {
      const row = (type: string, consent: string | null, requires: boolean, vi: string, en: string, path: string) => ({ type, version: '2026-11', effective_date: '2026-11-01', consent_type: consent, requires_consent: requires, status: 'draft_pending_legal_review', title: { vi, en }, web_path: path, note: 'PLACEHOLDER (mock)' });
      return json(200, { data: [row('terms', 'terms', true, 'Điều khoản sử dụng', 'Terms of Service', '/legal/terms'), row('privacy', 'privacy', true, 'Chính sách quyền riêng tư', 'Privacy Policy', '/legal/privacy'), row('refund_policy', 'refund_policy', false, 'Chính sách hoàn tiền', 'Refund Policy', '/legal/refund'), row('voice_consent', 'voice_processing', true, 'Đồng ý xử lý dữ liệu giọng nói', 'Voice Data Processing Consent', '/legal/voice-consent')] });
    }),

    // ------------------------------------------------------------------ MFA
    route('GET', '/me/mfa', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const f = s().mfa[u.id];
      return json(200, { required: isAdminUser(u) && s().requireAdminMfa, enrolled: !!f?.confirmed, pending_enrollment: !!f && !f.confirmed, session_verified: !!s().sessionMfa[u.id], recovery_codes_remaining: f?.confirmed ? f.recovery.length : 0 });
    }),
    route('POST', '/auth/mfa/totp/enroll', () => {
      const u = requireUser();
      if (u instanceof Response) return u;
      if (!isAdminUser(u)) return error(403, 'forbidden', 'MFA is only available for admin accounts');
      if (s().mfa[u.id]?.confirmed) return error(409, 'conflict', 'MFA already enrolled', { reason: 'mfa_already_enrolled' });
      const secret = randomBase32(32);
      s().mfa[u.id] = { secret, confirmed: false, recovery: [], last_step: null };
      persist();
      return json(200, { secret, otpauth_url: `otpauth://totp/Allingo:${encodeURIComponent(u.email ?? u.id)}?secret=${secret}&issuer=Allingo&algorithm=SHA1&digits=6&period=30`, digits: 6, period: 30, algorithm: 'SHA1' });
    }),
    route('POST', '/auth/mfa/totp/confirm', async ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const f = s().mfa[u.id];
      if (!f) return error(409, 'conflict', 'No pending enrollment', { reason: 'mfa_not_enrolled' });
      if (f.confirmed) return error(409, 'conflict', 'MFA already enrolled', { reason: 'mfa_already_enrolled' });
      const step = await verifyTotp(f.secret, (body as { code?: string } | null)?.code ?? '');
      if (step === null) return error(400, 'validation_failed', 'Invalid code', { reason: 'mfa_invalid' });
      f.confirmed = true;
      f.last_step = step;
      f.recovery = Array.from({ length: 10 }, () => `${randomBase32(5)}-${randomBase32(5)}`.toLowerCase());
      s().sessionMfa[u.id] = true;
      audit('mfa.enrolled', u, 'user', u.id);
      persist();
      return json(200, { access_token: 'mock-access', expires_in: 900, mfa: true, recovery_codes: f.recovery });
    }),
    route('POST', '/auth/mfa/verify', async ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const f = s().mfa[u.id];
      if (!f?.confirmed) return error(409, 'conflict', 'MFA not enrolled', { reason: 'mfa_not_enrolled' });
      const b = (body ?? {}) as { code?: string; recovery_code?: string };
      if (b.recovery_code) {
        const idx = f.recovery.indexOf(b.recovery_code.trim().toLowerCase());
        if (idx < 0) return error(400, 'validation_failed', 'Invalid code', { reason: 'mfa_invalid' });
        f.recovery.splice(idx, 1);
      } else {
        const step = await verifyTotp(f.secret, b.code ?? '');
        if (step === null || (f.last_step !== null && step <= f.last_step)) return error(400, 'validation_failed', 'Invalid code', { reason: 'mfa_invalid' });
        f.last_step = step;
      }
      s().sessionMfa[u.id] = true;
      audit('mfa.verified', u, 'user', u.id);
      persist();
      return json(200, { access_token: 'mock-access', expires_in: 900, mfa: true });
    }),
    route('POST', '/auth/mfa/recovery-codes', async ({ body }) => {
      const u = requireUser();
      if (u instanceof Response) return u;
      const f = s().mfa[u.id];
      if (!f?.confirmed) return error(409, 'conflict', 'MFA not enrolled', { reason: 'mfa_not_enrolled' });
      const step = await verifyTotp(f.secret, (body as { code?: string } | null)?.code ?? '');
      if (step === null || (f.last_step !== null && step <= f.last_step)) return error(400, 'validation_failed', 'Invalid code', { reason: 'mfa_invalid' });
      f.last_step = step;
      f.recovery = Array.from({ length: 10 }, () => `${randomBase32(5)}-${randomBase32(5)}`.toLowerCase());
      persist();
      return json(200, { recovery_codes: f.recovery });
    }),

    // ------------------------------------------------------------------ admin: beta
    route('GET', '/admin/beta/waitlist', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const program = url.searchParams.get('program');
      const status = url.searchParams.get('status');
      const rows = s().waitlist.filter((w) => (!program || w.program === program) && (!status || w.status === status)).map(({ email, ...w }) => ({ ...w, email_masked: maskEmail(email) }));
      return json(200, { ...page(rows, url, 50), counts: countBy(s().waitlist.filter((w) => !program || w.program === program), (w) => w.status) });
    }),
    route('GET', '/admin/beta/invites', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const status = url.searchParams.get('status');
      const batch = url.searchParams.get('batch');
      const all = Object.values(s().invites).sort((x, y) => y.created_at.localeCompare(x.created_at));
      const rows = all.filter((i) => (!status || i.status === status) && (!batch || i.batch === batch)).map((i) => ({ id: i.id, email_masked: maskEmail(i.email), program: i.program, status: i.status, batch: i.batch, sent_at: i.sent_at, expires_at: i.expires_at, redeemed_at: i.redeemed_at, redeemed_by: i.redeemed_by, send_attempts: i.send_attempts, last_error: null, created_at: i.created_at }));
      const sentToday = all.filter((i) => i.sent_at && Date.parse(i.sent_at) >= vnDayStart(Date.now())).length;
      return json(200, { ...page(rows, url, 50), today: { sent: sentToday, limit: BETA_DEFAULTS.daily_invite_limit, remaining: Math.max(0, BETA_DEFAULTS.daily_invite_limit - sentToday) }, counts: countBy(all, (i) => i.status) });
    }),
    route('POST', '/admin/beta/invites', ({ body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const b = (body ?? {}) as { waitlist_entry_ids?: string[]; emails?: string[]; batch?: string; program?: string; locale?: string };
      const targets: Array<{ email: string; locale: string; waitlist_entry_id: string | null }> = [];
      for (const id of b.waitlist_entry_ids ?? []) {
        const w = s().waitlist.find((x) => x.id === id);
        if (w) targets.push({ email: w.email, locale: w.locale, waitlist_entry_id: w.id });
      }
      for (const e of b.emails ?? []) targets.push({ email: e.toLowerCase(), locale: b.locale ?? 'vi', waitlist_entry_id: null });
      if (!targets.length) return error(400, 'validation_failed', 'waitlist_entry_ids or emails required');
      let queued = 0;
      let skipped = 0;
      const batch = b.batch ?? `batch-${nowIso().slice(0, 10)}`;
      for (const t of targets) {
        if (Object.values(s().invites).some((i) => i.email === t.email && ['queued', 'sent', 'redeemed'].includes(i.status))) {
          skipped++;
          continue;
        }
        const id = uuid();
        s().invites[id] = { id, code: genCode(), email: t.email, program: b.program ?? 'toeic', locale: t.locale, status: 'queued', batch, waitlist_entry_id: t.waitlist_entry_id, sent_at: null, expires_at: null, redeemed_at: null, redeemed_by: null, send_attempts: 0, grant: null, created_at: nowIso() };
        const w = s().waitlist.find((x) => x.id === t.waitlist_entry_id);
        if (w) w.status = 'invited';
        queued++;
      }
      audit('beta.invites_created', a, 'beta_invite', null, { queued, skipped, batch });
      persist();
      return json(201, { queued, skipped, batch });
    }),
    route('POST', '/admin/beta/invites/send', ({ body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      // B6/S147 (như API): invite_ids (theo thứ tự truyền) và/hoặc batch → chỉ lô đã chọn; không truyền → mọi lời mời đang xếp hàng
      const p = adminBetaInviteSendInputSchema.safeParse(body ?? {});
      if (!p.success) return error(400, 'validation_failed', 'Invalid body', { issues: p.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const limit = Math.min(500, p.data.limit ?? BETA_DEFAULTS.daily_invite_limit);
      const all = Object.values(s().invites);
      const sentToday = all.filter((i) => i.sent_at && Date.parse(i.sent_at) >= vnDayStart(Date.now())).length;
      const room = Math.max(0, Math.min(limit, BETA_DEFAULTS.daily_invite_limit - sentToday));
      const ids = p.data.invite_ids ? [...new Set(p.data.invite_ids)] : null;
      const eligible = all.filter((i) => i.status === 'queued' && (!ids || ids.includes(i.id)) && (!p.data.batch || i.batch === p.data.batch));
      const ordered = ids ? eligible.sort((x, y) => ids.indexOf(x.id) - ids.indexOf(y.id)) : eligible.sort((x, y) => x.created_at.localeCompare(y.created_at));
      const queue = ordered.slice(0, room);
      for (const i of queue) {
        Object.assign(i, { status: 'sent', sent_at: nowIso(), expires_at: new Date(Date.now() + BETA_DEFAULTS.invite_ttl_days * DAY).toISOString(), send_attempts: i.send_attempts + 1 });
        s().outbox.push({ to: i.email, code: i.code, at: nowIso() });
      }
      persist();
      const sentNow = all.filter((i) => i.sent_at && Date.parse(i.sent_at) >= vnDayStart(Date.now())).length;
      return json(202, { job_id: `beta.invites_send__manual-${Date.now()}`, mode: 'inline', result: { sent: queue.length, failed: 0, expired: 0, remaining_today: Math.max(0, BETA_DEFAULTS.daily_invite_limit - sentNow), skipped: ids ? ids.length - eligible.length : 0 } });
    }),
    route('POST', '/admin/beta/invites/{inviteId}/revoke', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const i = s().invites[params.inviteId!];
      if (!i) return error(404, 'not_found', 'beta_invite not found');
      if (!['queued', 'sent'].includes(i.status)) return error(409, 'conflict', 'Invite cannot be revoked', { reason: 'invite_not_revocable' });
      i.status = 'revoked';
      audit('beta.invite_revoked', a, 'beta_invite', i.id);
      persist();
      return json(200, { id: i.id, email_masked: maskEmail(i.email), program: i.program, status: i.status, batch: i.batch, sent_at: i.sent_at, expires_at: i.expires_at, redeemed_at: null, redeemed_by: null, send_attempts: i.send_attempts, last_error: null, created_at: i.created_at });
    }),
    route('GET', '/admin/reports/beta', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const testers = Object.values(state.users).filter((u) => u.roles.includes('beta_tester')).length;
      const nps = Object.values(s().surveys).flatMap((x) => [x.nps_d7, x.nps_d14]).filter((x): x is NonNullable<typeof x> => !!x && x.score !== null);
      const prom = nps.filter((x) => (x.score ?? 0) >= 9).length;
      const det = nps.filter((x) => (x.score ?? 0) <= 6).length;
      const score = nps.length ? Math.round(((prom - det) / nps.length) * 100) : null;
      const week = url.searchParams.get('week') ?? '2026-W45';
      const kpis = { week, simulated: true, cohort: { testers, invites_sent: Object.values(s().invites).filter((i) => i.sent_at).length, invites_redeemed: Object.values(s().invites).filter((i) => i.status === 'redeemed').length, waitlist: s().waitlist.length }, activation: { rate: testers ? 0.62 : null }, retention: { d1: { rate: 0.45 }, d7: { rate: 0.36 }, d14: { rate: null } }, engagement: { sessions_per_active_tester: 2.4, questions_per_tester: 48, explains_per_tester: 2.1 }, ai: { thumbs_up_rate: 0.81, cost_per_tester_usd: 0.0031 }, nps: { score, responses: nps.length }, conversion: { checkout_rate: 0.03 }, support: { tickets_overdue: 0, content_reports_overdue: 0 }, crash_free: { rate: null, source: 'chưa có (mock)' } };
      return json(200, { week, kpis, posthog: null, markdown: `# Báo cáo beta kín – tuần ${week}\n\n> **DỮ LIỆU GIẢ LẬP (mock)**\n\n- Tester: **${testers}**\n- NPS: **${score ?? '—'}** (${nps.length} phản hồi)\n` });
    }),

    // ------------------------------------------------------------------ admin: góp ý, báo lỗi câu, ticket
    route('GET', '/admin/feedback', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const status = url.searchParams.get('status');
      const category = url.searchParams.get('category');
      const rows = Object.values(s().feedback)
        .filter((f) => (!status || f.status === status) && (!category || f.category === category))
        .sort((x, y) => y.created_at.localeCompare(x.created_at))
        .map((f) => ({ id: f.id, user_id: f.user_id, category: f.category, message: f.message, page_url: f.page_url, trace_id: f.trace_id, screenshot: f.screenshot_id ? { media_asset_id: f.screenshot_id, url: '/demo-images/p1-01.svg', url_expires_at: new Date(Date.now() + 600_000).toISOString() } : null, context: { request_trace_id: f.trace_id, user_agent: 'mock', app_version: f.app_version, locale: 'vi' }, status: f.status, created_at: f.created_at }));
      return json(200, page(rows, url));
    }),
    route('PATCH', '/admin/feedback/{feedbackId}', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const f = s().feedback[params.feedbackId!];
      if (!f) return error(404, 'not_found', 'feedback not found');
      const before = f.status;
      f.status = (body as { status?: string } | null)?.status ?? f.status;
      audit('feedback.update', a, 'feedback', f.id, { status: f.status }, { status: before });
      persist();
      return json(200, { ...f, screenshot: null, context: {} });
    }),
    route('GET', '/admin/content/reports', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const status = url.searchParams.get('status');
      const overdue = url.searchParams.get('overdue') === 'true';
      const rows = Object.values(s().reports)
        .map(reportDto)
        .filter((r) => (!status || r.status === status) && (!overdue || r.overdue))
        .sort((x, y) => y.created_at.localeCompare(x.created_at));
      return json(200, page(rows, url));
    }),
    route('PATCH', '/admin/content/reports/{reportId}', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const r = s().reports[params.reportId!];
      if (!r) return error(404, 'not_found', 'content_report not found');
      const b = (body ?? {}) as { status?: 'open' | 'confirmed' | 'rejected' | 'fixed'; resolution_note?: string };
      const was = r.status;
      r.status = b.status ?? r.status;
      r.resolution_note = b.resolution_note ?? r.resolution_note;
      r.updated_at = nowIso();
      r.resolved_at = r.status === 'open' ? null : nowIso();
      if (r.status !== 'open' && was === 'open') {
        // B6/S148 (như API): về trang xem lại câu đã báo trong bài đã nộp gần nhất; không có → /support
        const qid = d.questionByVersion(r.question_version_id)?.question_id;
        const att = qid
          ? Object.values(state.attempts)
              .filter((x) => x.user_id === r.user_id && (x.status === 'submitted' || x.status === 'graded') && !!x.answers[qid])
              .sort((x, y) => (y.submitted_at ?? y.started_at).localeCompare(x.submitted_at ?? x.started_at))[0]
          : undefined;
        const link = att ? `/attempts/${att.id}/review?focus=${r.question_version_id}` : '/support';
        notify(state, r.user_id, 'content.report_resolved', { report_id: r.id, fixed: r.status === 'fixed', attempt_id: att?.id ?? null, question_version_id: att ? r.question_version_id : null }, { category: 'learning', url: link });
      }
      audit('content_report.update', a, 'content_report', r.id, { status: r.status }, { status: was });
      persist();
      return json(200, reportDto(r));
    }),
    route('GET', '/admin/support/tickets', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const f = (k: string) => url.searchParams.get(k);
      const all = Object.values(s().tickets).map((t) => adminTicketDto(t, false));
      const rows = all
        .filter((t) => (!f('status') || t.status === f('status')) && (!f('priority') || t.priority === f('priority')) && (!f('category') || t.category === f('category')) && (f('overdue') !== 'true' || t.overdue) && (!f('user_id') || t.user?.id === f('user_id')) && (!f('q') || t.subject.toLowerCase().includes(f('q')!.toLowerCase())))
        .sort((x, y) => (y.last_message_at ?? '').localeCompare(x.last_message_at ?? ''));
      return json(200, { ...page(rows, url), counts: countBy(all, (t) => t.status) });
    }),
    route('GET', '/admin/support/tickets/{ticketId}', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const t = s().tickets[params.ticketId!];
      return t ? json(200, adminTicketDto(t)) : error(404, 'not_found', 'Ticket not found');
    }),
    route('PATCH', '/admin/support/tickets/{ticketId}', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const t = s().tickets[params.ticketId!];
      if (!t) return error(404, 'not_found', 'Ticket not found');
      const b = (body ?? {}) as { status?: MockS12State['tickets'][string]['status']; priority?: MockS12State['tickets'][string]['priority']; assigned_to?: string | null };
      if (b.status) t.status = b.status;
      if (b.priority) t.priority = b.priority;
      if (b.assigned_to !== undefined) t.assigned_to = b.assigned_to;
      if (t.status === 'closed') t.closed_at = nowIso();
      t.updated_at = nowIso();
      audit('support.update', a, 'support_ticket', t.id, b);
      persist();
      return json(200, adminTicketDto(t));
    }),
    route('POST', '/admin/support/tickets/{ticketId}/messages', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const t = s().tickets[params.ticketId!];
      if (!t) return error(404, 'not_found', 'Ticket not found');
      if (t.status === 'closed') return error(409, 'conflict', 'Ticket closed', { reason: 'ticket_closed' });
      const b = (body ?? {}) as { message?: string; channels?: string[]; status?: MockS12State['tickets'][string]['status']; credit?: { delta: number; note: string } };
      if (!b.message?.trim()) return error(400, 'validation_failed', 'Message required');
      if (b.credit && (!(b.credit.delta >= 1) || (b.credit.note ?? '').trim().length < 3)) return error(400, 'validation_failed', 'Invalid credit', { issues: [{ path: 'credit.note', code: 'too_small' }] });
      t.messages.push({ id: uuid(), author: 'agent', body: b.message.trim(), created_at: nowIso() });
      t.first_responded_at ??= nowIso();
      t.status = b.status ?? 'waiting_user';
      t.updated_at = nowIso();
      let credit: { delta: number; balance: number; ledger_id: number } | null = null;
      if (b.credit) {
        const rec = addLedger(state, t.user_id, { delta: b.credit.delta, reason: 'admin_adjust', note: `support:${t.id} ${b.credit.note}` });
        credit = { delta: b.credit.delta, balance: rec.balance_after, ledger_id: rec.id };
        audit('user.grant_credits', a, 'user', t.user_id, { delta: b.credit.delta, source: 'support_ticket', ticket_id: t.id });
      }
      if ((b.channels ?? ['inapp']).includes('inapp')) notify(state, t.user_id, 'support.reply', { ticket_id: t.id, subject: t.subject, message: b.message.slice(0, 2000), credits: credit?.delta ?? 0 }, { category: 'system', url: `/support/tickets/${t.id}` });
      audit('support.reply', a, 'support_ticket', t.id, { status: t.status, credit: credit?.delta ?? 0 });
      persist();
      return json(201, { ...adminTicketDto(t), delivery: (b.channels ?? ['inapp']).map((c) => ({ channel: c, status: 'sent' })), credit });
    }),

    // ------------------------------------------------------------------ admin: người dùng
    route('GET', '/admin/users', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const status = url.searchParams.get('status');
      const role = url.searchParams.get('role');
      const rows = Object.values(state.users)
        .filter((u) => !q || u.id === q || (u.email ?? '').toLowerCase().startsWith(q) || u.display_name.toLowerCase().includes(q))
        .map(userSummary)
        .filter((u) => (!status || u.status === status) && (!role || u.roles.includes(role)))
        .sort((x, y) => y.created_at.localeCompare(x.created_at));
      audit('admin.user_search', a, 'user', null, { results: rows.length });
      persist();
      return json(200, page(rows, url, 20));
    }),
    route('GET', '/admin/users/{userId}', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const u = state.users[params.userId!];
      if (!u) return error(404, 'not_found', 'user not found');
      const inv = redeemedInvite(u.id);
      const del = s().deletions[u.id];
      return json(200, {
        ...userSummary(u),
        phone_masked: u.phone ? u.phone.replace(/\d(?=\d{2})/g, '•') : null,
        ui_locale: u.ui_locale,
        timezone: u.timezone,
        providers: [],
        active_sessions: s().locked[u.id] ? 0 : state.sessionUserId === u.id ? 1 : 1,
        last_seen_at: nowIso(),
        mfa_enrolled: !!s().mfa[u.id]?.confirmed,
        beta: { tester: u.roles.includes('beta_tester'), redeemed_at: inv?.redeemed_at ?? null, invite_status: inv?.status ?? null },
        credits: { balance: state.credits[u.id] ?? 0 },
        subscriptions: Object.values(state.subscriptions).filter((x) => x.user_id === u.id).map((x) => ({ id: x.id, plan: { code: x.plan_id, name: { vi: 'TOEIC Pro', en: 'TOEIC Pro' } }, status: x.status, current_period_end: x.current_period_end })),
        attempts: Object.values(state.attempts).filter((x) => x.user_id === u.id).slice(-10).map((x) => ({ id: x.id, status: x.status, mode: x.mode, scaled_score: x.result?.scaled_score ?? null, started_at: x.started_at, submitted_at: x.submitted_at ?? null })),
        orders: Object.values(state.orders).filter((x) => x.user_id === u.id).map((x) => ({ id: x.id, status: x.status, total: x.total, created_at: x.created_at })),
        tickets: Object.values(s().tickets).filter((x) => x.user_id === u.id).map((x) => ticketDto(x, false)),
        deletion: del ? { request_id: del.request_id, due_at: del.due_at, status: 'scheduled' } : null,
      });
    }),
    route('POST', '/admin/users/{userId}/lock', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const u = state.users[params.userId!];
      if (!u) return error(404, 'not_found', 'user not found');
      if (u.id === a.id) return error(409, 'conflict', 'Cannot lock yourself', { reason: 'self' });
      if (isAdminUser(u) && !a.roles.includes('superadmin')) return error(403, 'forbidden', 'Locking an admin requires superadmin');
      const reason = ((body as { reason?: string } | null)?.reason ?? '').trim();
      if (reason.length < 3) return error(400, 'validation_failed', 'reason required');
      if (s().locked[u.id]) return error(409, 'conflict', 'Already locked', { reason: 'already_locked' });
      s().locked[u.id] = { reason, at: nowIso() };
      for (const [k, v] of Object.entries(s().impersonations)) if (v.user_id === u.id) delete s().impersonations[k];
      audit('user.locked', a, 'user', u.id, { reason });
      persist();
      return json(200, { user_id: u.id, status: 'suspended', sessions_revoked: 1 });
    }),
    route('POST', '/admin/users/{userId}/unlock', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const u = state.users[params.userId!];
      if (!u) return error(404, 'not_found', 'user not found');
      if (!s().locked[u.id]) return error(409, 'conflict', 'Not locked', { reason: 'not_locked' });
      delete s().locked[u.id];
      audit('user.unlocked', a, 'user', u.id);
      persist();
      return json(200, { user_id: u.id, status: 'active' });
    }),
    route('POST', '/admin/users/{userId}/deletion', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const u = state.users[params.userId!];
      if (!u) return error(404, 'not_found', 'user not found');
      if (s().deletions[u.id]) return error(409, 'conflict', 'Deletion already requested');
      const due = new Date(Date.now() + 72 * HOUR).toISOString();
      s().deletions[u.id] = { request_id: uuid(), due_at: due, reason: ((body as { reason?: string } | null)?.reason ?? '').trim() };
      audit('user.deletion_requested', a, 'user', u.id, { due_at: due });
      persist();
      return json(202, { status: 'scheduled', due_at: due, request_id: s().deletions[u.id]!.request_id });
    }),
    route('POST', '/admin/users/{userId}/impersonate', ({ params, body }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const u = state.users[params.userId!];
      if (!u) return error(404, 'not_found', 'user not found');
      if (u.id === a.id || isAdminUser(u)) return error(403, 'forbidden', 'Cannot impersonate this user', { reason: 'impersonation_not_allowed' });
      if (((body as { reason?: string } | null)?.reason ?? '').trim().length < 3) return error(400, 'validation_failed', 'reason required');
      const id = uuid();
      const token = `imp_${id}`;
      s().impersonations[token] = { user_id: u.id, admin_id: a.id, expires: Date.now() + 600_000 };
      audit('user.impersonation_started', a, 'user', u.id, { impersonation_id: id });
      persist();
      return json(201, { access_token: token, token_type: 'Bearer', expires_in: 600, scope: 'read_only', impersonation_id: id, user_id: u.id });
    }),

    // ------------------------------------------------------------------ admin: nội dung, AI, hệ thống, audit
    route('GET', '/admin/content/questions/stats', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const rec = url.searchParams.get('recommendation');
      const reports = Object.values(s().reports);
      const rows = [
        { question_id: '00000000-0000-4000-8000-0000000051a1', external_ref: 'mock-p5-q01', section_code: 'part5', n: 64, p_value: 0.91, discrimination: 0.41, avg_time_ms: 21000 },
        { question_id: '00000000-0000-4000-8000-0000000051a2', external_ref: 'mock-p5-q02', section_code: 'part5', n: 58, p_value: 0.12, discrimination: -0.18, avg_time_ms: 39000 },
        { question_id: '00000000-0000-4000-8000-0000000051a3', external_ref: 'mock-p2-q03', section_code: 'part2', n: 8, p_value: 0.5, discrimination: null, avg_time_ms: 14000 },
      ].map((q, i) => {
        const open = reports.filter((r) => r.status === 'open').length && i === 1 ? reports.filter((r) => r.status === 'open').length : 0;
        const recommendation = q.n < 20 ? 'insufficient_data' : q.discrimination !== null && q.discrimination < 0 ? 'retire' : q.p_value > 0.95 || q.p_value < 0.2 ? 'review' : 'ok';
        const reasons = recommendation === 'retire' ? ['negative_discrimination', 'too_hard'] : recommendation === 'review' ? ['too_hard'] : [];
        return { ...q, program: 'toeic', status: 'published', reports_open: open, reports_total: open, recommendation, reasons, computed_at: s().statsComputedAt ?? nowIso() };
      });
      return json(200, { ...page(rows.filter((r) => !rec || r.recommendation === rec), url), computed_at: s().statsComputedAt ?? nowIso() });
    }),
    route('POST', '/admin/content/questions/stats/recompute', () => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      s().statsComputedAt = nowIso();
      persist();
      return json(202, { job_id: `content.stats_nightly__manual-${Date.now()}`, mode: 'inline', result: { questions: 3, updated: 3 } });
    }),
    route('GET', '/admin/ai/quality', () => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const fb = Object.values(state.feedback);
      const up = fb.filter((f) => f.rating === 'helpful').length;
      const down = fb.length - up;
      return json(200, { from: new Date(Date.now() - 30 * DAY).toISOString(), to: nowIso(), data: [{ task_code: 'explain_mcq', prompt_version_id: '00000000-0000-4000-8000-00000000e301', prompt_version_no: 1, prompt_status: 'active', tasks: Object.keys(state.aiTasks).length, succeeded: Object.keys(state.aiTasks).length, refused: 0, failed: 0, thumbs_up: up, thumbs_down: down, thumbs_up_ratio: fb.length ? up / fb.length : null, cost_usd: 0.0123 }] });
    }),
    route('GET', '/admin/ai/refusals', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const rows = [{ id: '00000000-0000-4000-8000-0000000aaa01', task_code: 'tutor_chat', reason: 'injection (mock)', error_code: 'refused', input_ref: { thread_id: 'mock' }, created_at: nowIso() }];
      return json(200, { ...page(rows, url), by_reason: { 'injection (mock)': 1 } });
    }),
    route('GET', '/admin/system/status', () => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const dl = Object.values(s().deadLetters);
      const overdueTickets = Object.values(s().tickets).filter((t) => !t.first_responded_at && Date.parse(t.first_response_due_at) < Date.now()).length;
      const overdueReports = Object.values(s().reports).filter((r) => r.status === 'open' && Date.parse(r.sla_due_at) < Date.now()).length;
      return json(200, {
        redis_healthy: true,
        queues: ['grading', 'content', 'media', 'notify', 'analytics', 'maintenance'].map((q) => ({ queue: q, waiting: 0, active: 0, delayed: 0, failed: dl.filter((x) => x.queue === q && !x.replayed_at).length, prioritized: 0, oldest_waiting_sec: 0 })),
        dead_letters: { total: dl.length, last_24h: dl.filter((x) => Date.now() - Date.parse(x.failed_at) < DAY).length, unreplayed: dl.filter((x) => !x.replayed_at).length, by_queue: countBy(dl, (x) => x.queue) },
        partitions: [
          { table: 'learn.attempt_answers', months_ahead: 2, missing: [] },
          { table: 'ops.audit_logs', months_ahead: 2, missing: [] },
        ],
        flags: [],
        sla: { content_reports_overdue: overdueReports, support_tickets_overdue: overdueTickets },
        outbox: { unpublished: 0, oldest_unpublished_sec: null },
      });
    }),
    route('GET', '/admin/jobs/dead-letters', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const queue = url.searchParams.get('queue');
      const job = url.searchParams.get('job');
      const replayed = url.searchParams.get('replayed');
      const rows = Object.values(s().deadLetters)
        .filter((x) => (!queue || x.queue === queue) && (!job || x.job === job) && (replayed === null || (replayed === 'true') === !!x.replayed_at))
        .sort((x, y) => y.failed_at.localeCompare(x.failed_at));
      return json(200, page(rows, url));
    }),
    route('POST', '/admin/jobs/dead-letters/{deadLetterId}/replay', ({ params }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const x = s().deadLetters[params.deadLetterId!];
      if (!x) return error(404, 'not_found', 'dead_letter not found');
      if (!x.job) return error(409, 'conflict', 'No handler', { reason: 'no_handler' });
      x.replayed_at = nowIso();
      x.replay_count += 1;
      audit('job.dead_letter_replayed', a, 'dead_letter', x.id, { job: x.job });
      persist();
      return json(200, { ...x, mode: 'inline', result: { ok: true }, error: null });
    }),
    route('GET', '/admin/audit-logs', ({ url }) => {
      const a = requireAdmin();
      if (a instanceof Response) return a;
      const action = url.searchParams.get('action');
      const entity = url.searchParams.get('entity_id');
      const actor = url.searchParams.get('actor');
      const prefix = action && /[.*]$/.test(action) ? action.replace(/\*$/, '') : null;
      const rows = s().audit.filter((x) => (!action || (prefix ? x.action.startsWith(prefix) : x.action === action)) && (!entity || x.entity_id === entity) && (!actor || x.actor_user_id === actor));
      return json(200, page(rows, url, 50));
    }),
  ];

  /** Hook E2E (`__ALLINGO_MOCK__`) */
  const hooks = {
    lastInviteCode: (email?: string) => [...s().outbox].reverse().find((m) => !email || m.to === email.toLowerCase())?.code ?? null,
    setAdminMfaRequired: (on: boolean) => {
      // Bật yêu cầu → mọi phiên phải step-up lại (như phiên mới khi ADMIN_MFA_REQUIRED bật ở staging)
      const st = s();
      st.requireAdminMfa = on;
      st.sessionMfa = {};
      persist();
    },
    setNpsDue: (email: string, kind: 'nps_d7' | 'nps_d14' = 'nps_d7') => {
      const u = Object.values(state.users).find((x) => x.email?.toLowerCase() === email.toLowerCase());
      if (u) {
        s().npsDue[u.id] = kind;
        // NPS chỉ dành cho beta tester (S146) → ép đến hạn = tester đã làm khảo sát onboarding
        if (!u.roles.includes('beta_tester')) u.roles = [...u.roles, 'beta_tester'];
        (s().surveys[u.id] ??= {}).beta_onboarding ??= { submitted_at: new Date().toISOString(), score: null, answers: {} };
      }
      persist();
    },
    addDeadLetter: (job = 'beta.invites_send', queue = 'notify') => {
      const id = uuid();
      s().deadLetters[id] = { id, queue, job, job_id: `${job}__mock-${id.slice(0, 6)}`, error: 'SMTP connection refused (mock)', attempts: 3, failed_at: nowIso(), replayed_at: null, replay_count: 0 };
      persist();
      return id;
    },
  };

  return { routes, guard, hooks };
}
