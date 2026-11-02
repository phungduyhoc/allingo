import type { DeliveryChannel, NotificationTemplateCode } from '@allingo/schemas';

/**
 * Mẫu thông báo đa kênh (Sprint 8) – Handlebars, vi/en, lưu trong repo (TS để build/tsc không cần chép tệp .hbs).
 * Email có HTML + plain-text; push/in-app có title/body ngắn. Biến dữ liệu do nơi gọi `NotificationService.send` truyền vào;
 * helper: `{{vnd n}}` (199.000 ₫), `{{date iso}}` (ngày giờ VN), `{{t localized}}` (chọn ngôn ngữ {vi,en}).
 * Ngôn ngữ khác vi → en (fallback CLAUDE.md §5.11). Không đưa email/SĐT/MST vào template push/in-app.
 */
export type TemplateCategory = 'learning' | 'billing' | 'marketing' | 'system';
export type QuietPolicy = 'defer' | 'skip' | 'ignore';

export interface LocaleTemplate {
  subject: string;
  /** Phần thân HTML (bọc trong layout có header/footer) */
  html: string;
  text: string;
  push: { title: string; body: string };
  inapp: { title: string; body: string };
}

export interface TemplateDef {
  code: NotificationTemplateCode;
  category: TemplateCategory;
  /** Kênh mặc định khi không chỉ định */
  channels: DeliveryChannel[];
  /** Giao dịch (biên lai, hoá đơn): email + in-app luôn gửi (không theo tuỳ chọn loại), không giới hạn tần suất */
  transactional: boolean;
  /** Push trong giờ yên lặng: defer (hẹn giờ kết thúc), skip (bỏ), ignore (gửi ngay) */
  quietHours: QuietPolicy;
  /** Đường dẫn tương đối trong web (Handlebars) */
  url: string;
  locales: { vi: LocaleTemplate; en: LocaleTemplate };
}

const T: Record<NotificationTemplateCode, TemplateDef> = {
  'billing.order_paid': {
    code: 'billing.order_paid',
    category: 'billing',
    channels: ['inapp', 'email', 'push'],
    transactional: true,
    quietHours: 'ignore',
    url: '/account/orders/{{order_id}}',
    locales: {
      vi: {
        subject: 'Thanh toán thành công – {{t plan_name}}',
        html: '<h1>Cảm ơn bạn đã nâng cấp!</h1><p>Đơn hàng <strong>{{t plan_name}}</strong> đã được thanh toán <strong>{{vnd total}}</strong>.</p>{{#if credits_granted}}<p>Đã cộng <strong>{{credits_granted}}</strong> credit vào tài khoản.</p>{{/if}}{{#if bonus_credits}}<p>Quà khuyến mãi: <strong>+{{bonus_credits}}</strong> credit.</p>{{/if}}<p>Hoá đơn điện tử sẽ được gửi trong email riêng ngay khi phát hành.</p><p><a class="btn" href="{{link}}">Xem đơn hàng</a></p>',
        text: 'Cảm ơn bạn đã nâng cấp!\nĐơn hàng {{t plan_name}} đã được thanh toán {{vnd total}}.\n{{#if credits_granted}}Đã cộng {{credits_granted}} credit.\n{{/if}}{{#if bonus_credits}}Quà khuyến mãi: +{{bonus_credits}} credit.\n{{/if}}Hoá đơn điện tử sẽ được gửi trong email riêng.\nXem đơn hàng: {{link}}',
        push: { title: 'Thanh toán thành công', body: '{{t plan_name}} đã được kích hoạt.' },
        inapp: { title: 'Thanh toán thành công', body: 'Đơn {{t plan_name}} – {{vnd total}} đã được thanh toán.' },
      },
      en: {
        subject: 'Payment received – {{t plan_name}}',
        html: '<h1>Thanks for upgrading!</h1><p>Your order <strong>{{t plan_name}}</strong> was paid: <strong>{{vnd total}}</strong>.</p>{{#if credits_granted}}<p><strong>{{credits_granted}}</strong> credits were added to your account.</p>{{/if}}{{#if bonus_credits}}<p>Promotion bonus: <strong>+{{bonus_credits}}</strong> credits.</p>{{/if}}<p>Your e-invoice will be emailed separately once issued.</p><p><a class="btn" href="{{link}}">View order</a></p>',
        text: 'Thanks for upgrading!\nYour order {{t plan_name}} was paid: {{vnd total}}.\n{{#if credits_granted}}{{credits_granted}} credits were added.\n{{/if}}{{#if bonus_credits}}Promotion bonus: +{{bonus_credits}} credits.\n{{/if}}Your e-invoice will be emailed separately.\nView order: {{link}}',
        push: { title: 'Payment received', body: '{{t plan_name}} is now active.' },
        inapp: { title: 'Payment received', body: '{{t plan_name}} – {{vnd total}} was paid.' },
      },
    },
  },
  'billing.invoice_issued': {
    code: 'billing.invoice_issued',
    category: 'billing',
    channels: ['email', 'inapp'],
    transactional: true,
    quietHours: 'ignore',
    url: '/account/orders/{{order_id}}',
    locales: {
      vi: {
        subject: 'Hoá đơn điện tử {{series}}-{{invoice_no}} – Allingo',
        html: '<h1>Hoá đơn điện tử của bạn</h1><p>Hoá đơn ký hiệu <strong>{{series}}</strong> số <strong>{{invoice_no}}</strong> cho đơn {{t plan_name}} ({{vnd total}}) đã được phát hành{{#if company}} cho <strong>{{company}}</strong>{{/if}}.</p><p>Mã tra cứu: <strong>{{lookup_code}}</strong>{{#if lookup_url}} – <a href="{{lookup_url}}">tra cứu hoá đơn</a>{{/if}}.</p><p>Bản PDF đính kèm email này.</p>',
        text: 'Hoá đơn điện tử ký hiệu {{series}} số {{invoice_no}} cho đơn {{t plan_name}} ({{vnd total}}) đã được phát hành.\nMã tra cứu: {{lookup_code}}{{#if lookup_url}} – {{lookup_url}}{{/if}}\nBản PDF đính kèm email này.',
        push: { title: 'Đã có hoá đơn điện tử', body: 'Hoá đơn {{series}}-{{invoice_no}} đã phát hành.' },
        inapp: { title: 'Đã có hoá đơn điện tử', body: 'Hoá đơn {{series}}-{{invoice_no}} ({{vnd total}}) – mã tra cứu {{lookup_code}}.' },
      },
      en: {
        subject: 'E-invoice {{series}}-{{invoice_no}} – Allingo',
        html: '<h1>Your e-invoice</h1><p>Invoice series <strong>{{series}}</strong> no. <strong>{{invoice_no}}</strong> for {{t plan_name}} ({{vnd total}}) has been issued{{#if company}} to <strong>{{company}}</strong>{{/if}}.</p><p>Lookup code: <strong>{{lookup_code}}</strong>{{#if lookup_url}} – <a href="{{lookup_url}}">look up</a>{{/if}}.</p><p>The PDF is attached.</p>',
        text: 'Invoice series {{series}} no. {{invoice_no}} for {{t plan_name}} ({{vnd total}}) has been issued.\nLookup code: {{lookup_code}}{{#if lookup_url}} – {{lookup_url}}{{/if}}\nThe PDF is attached.',
        push: { title: 'Your e-invoice is ready', body: 'Invoice {{series}}-{{invoice_no}} was issued.' },
        inapp: { title: 'Your e-invoice is ready', body: 'Invoice {{series}}-{{invoice_no}} ({{vnd total}}) – lookup code {{lookup_code}}.' },
      },
    },
  },
  'billing.subscription_expiring': {
    code: 'billing.subscription_expiring',
    category: 'billing',
    channels: ['inapp', 'email', 'push'],
    transactional: false,
    quietHours: 'defer',
    url: '/pricing',
    locales: {
      vi: {
        subject: 'Gói {{t plan_name}} còn {{days_before}} ngày',
        html: '<h1>Sắp hết hạn gói Pro</h1><p>Gói <strong>{{t plan_name}}</strong> của bạn sẽ hết hạn vào <strong>{{date period_end}}</strong> (còn {{days_before}} ngày).</p><p>Gia hạn để giữ đề full không giới hạn, chấm Writing/Speaking và credit hằng tháng.</p><p><a class="btn" href="{{link}}">Gia hạn ngay</a></p>',
        text: 'Gói {{t plan_name}} sẽ hết hạn vào {{date period_end}} (còn {{days_before}} ngày).\nGia hạn: {{link}}',
        push: { title: 'Gói Pro sắp hết hạn', body: '{{t plan_name}} còn {{days_before}} ngày – gia hạn để không gián đoạn.' },
        inapp: { title: 'Gói Pro sắp hết hạn', body: '{{t plan_name}} hết hạn {{date period_end}} (còn {{days_before}} ngày).' },
      },
      en: {
        subject: '{{t plan_name}} expires in {{days_before}} days',
        html: '<h1>Your Pro plan is expiring</h1><p><strong>{{t plan_name}}</strong> expires on <strong>{{date period_end}}</strong> ({{days_before}} days left).</p><p>Renew to keep unlimited full tests, Writing/Speaking grading and monthly credits.</p><p><a class="btn" href="{{link}}">Renew now</a></p>',
        text: '{{t plan_name}} expires on {{date period_end}} ({{days_before}} days left).\nRenew: {{link}}',
        push: { title: 'Pro plan expiring', body: '{{t plan_name}}: {{days_before}} days left – renew to avoid interruption.' },
        inapp: { title: 'Pro plan expiring', body: '{{t plan_name}} expires {{date period_end}} ({{days_before}} days left).' },
      },
    },
  },
  'billing.subscription_expired': {
    code: 'billing.subscription_expired',
    category: 'billing',
    channels: ['inapp', 'email', 'push'],
    transactional: false,
    quietHours: 'defer',
    url: '/pricing',
    locales: {
      vi: {
        subject: 'Gói {{t plan_name}} đã hết hạn',
        html: '<h1>Gói Pro đã hết hạn</h1><p>Gói <strong>{{t plan_name}}</strong> đã hết hạn, tài khoản chuyển về gói Miễn phí. Tiến độ học của bạn vẫn được giữ nguyên.</p><p><a class="btn" href="{{link}}">Nâng cấp lại</a></p>',
        text: 'Gói {{t plan_name}} đã hết hạn, tài khoản chuyển về gói Miễn phí. Tiến độ học vẫn được giữ.\nNâng cấp lại: {{link}}',
        push: { title: 'Gói Pro đã hết hạn', body: 'Tài khoản đã về gói Miễn phí – nâng cấp lại bất cứ lúc nào.' },
        inapp: { title: 'Gói Pro đã hết hạn', body: '{{t plan_name}} đã hết hạn – tài khoản về gói Miễn phí.' },
      },
      en: {
        subject: '{{t plan_name}} has expired',
        html: '<h1>Your Pro plan has expired</h1><p><strong>{{t plan_name}}</strong> has expired and your account is back on Free. Your progress is kept.</p><p><a class="btn" href="{{link}}">Upgrade again</a></p>',
        text: '{{t plan_name}} has expired and your account is back on Free. Your progress is kept.\nUpgrade: {{link}}',
        push: { title: 'Pro plan expired', body: 'Your account is back on Free – upgrade anytime.' },
        inapp: { title: 'Pro plan expired', body: '{{t plan_name}} expired – your account is back on Free.' },
      },
    },
  },
  'billing.trial_started': {
    code: 'billing.trial_started',
    category: 'billing',
    channels: ['inapp', 'email'],
    transactional: false,
    quietHours: 'ignore',
    url: '/{{#if program}}{{program}}{{else}}toeic{{/if}}/practice',
    locales: {
      vi: {
        subject: 'Bắt đầu dùng thử Pro {{trial_days}} ngày',
        html: '<h1>Chào mừng bạn đến với Pro!</h1><p>Bạn đang dùng thử <strong>{{t plan_name}}</strong> trong {{trial_days}} ngày, đến <strong>{{date period_end}}</strong>.</p><p>Hãy thử đề full, chấm Writing/Speaking và chẩn đoán AI.</p><p><a class="btn" href="{{link}}">Bắt đầu học</a></p>',
        text: 'Bạn đang dùng thử {{t plan_name}} {{trial_days}} ngày, đến {{date period_end}}.\nBắt đầu học: {{link}}',
        push: { title: 'Đã kích hoạt dùng thử Pro', body: '{{trial_days}} ngày Pro – đến {{date period_end}}.' },
        inapp: { title: 'Đã kích hoạt dùng thử Pro', body: 'Dùng thử {{t plan_name}} {{trial_days}} ngày, đến {{date period_end}}.' },
      },
      en: {
        subject: 'Your {{trial_days}}-day Pro trial has started',
        html: '<h1>Welcome to Pro!</h1><p>You are trying <strong>{{t plan_name}}</strong> for {{trial_days}} days, until <strong>{{date period_end}}</strong>.</p><p>Try full tests, Writing/Speaking grading and AI diagnosis.</p><p><a class="btn" href="{{link}}">Start learning</a></p>',
        text: 'You are trying {{t plan_name}} for {{trial_days}} days, until {{date period_end}}.\nStart learning: {{link}}',
        push: { title: 'Pro trial activated', body: '{{trial_days}} days of Pro – until {{date period_end}}.' },
        inapp: { title: 'Pro trial activated', body: 'Trying {{t plan_name}} for {{trial_days}} days, until {{date period_end}}.' },
      },
    },
  },
  'billing.trial_ending': {
    code: 'billing.trial_ending',
    category: 'billing',
    channels: ['inapp', 'email', 'push'],
    transactional: false,
    quietHours: 'defer',
    url: '/pricing',
    locales: {
      vi: {
        subject: 'Dùng thử Pro kết thúc vào ngày mai',
        html: '<h1>Dùng thử sắp kết thúc</h1><p>Dùng thử <strong>{{t plan_name}}</strong> kết thúc vào <strong>{{date period_end}}</strong>. Nâng cấp để tiếp tục học không gián đoạn.</p><p><a class="btn" href="{{link}}">Xem gói Pro</a></p>',
        text: 'Dùng thử {{t plan_name}} kết thúc vào {{date period_end}}.\nXem gói Pro: {{link}}',
        push: { title: 'Dùng thử sắp kết thúc', body: 'Pro dùng thử hết hạn {{date period_end}}.' },
        inapp: { title: 'Dùng thử sắp kết thúc', body: '{{t plan_name}} dùng thử hết hạn {{date period_end}}.' },
      },
      en: {
        subject: 'Your Pro trial ends tomorrow',
        html: '<h1>Your trial is ending</h1><p>Your <strong>{{t plan_name}}</strong> trial ends on <strong>{{date period_end}}</strong>. Upgrade to keep learning without interruption.</p><p><a class="btn" href="{{link}}">See Pro plans</a></p>',
        text: 'Your {{t plan_name}} trial ends on {{date period_end}}.\nSee Pro plans: {{link}}',
        push: { title: 'Trial ending soon', body: 'Your Pro trial ends {{date period_end}}.' },
        inapp: { title: 'Trial ending soon', body: '{{t plan_name}} trial ends {{date period_end}}.' },
      },
    },
  },
  'billing.trial_ended': {
    code: 'billing.trial_ended',
    category: 'billing',
    channels: ['inapp', 'email', 'push'],
    transactional: false,
    quietHours: 'defer',
    url: '/pricing',
    locales: {
      vi: {
        subject: 'Dùng thử Pro đã kết thúc',
        html: '<h1>Dùng thử đã kết thúc</h1><p>Dùng thử <strong>{{t plan_name}}</strong> đã kết thúc, tài khoản chuyển về gói Miễn phí. Tiến độ học vẫn được giữ.</p><p><a class="btn" href="{{link}}">Nâng cấp Pro</a></p>',
        text: 'Dùng thử {{t plan_name}} đã kết thúc, tài khoản chuyển về gói Miễn phí.\nNâng cấp Pro: {{link}}',
        push: { title: 'Dùng thử đã kết thúc', body: 'Tài khoản đã về gói Miễn phí.' },
        inapp: { title: 'Dùng thử đã kết thúc', body: '{{t plan_name}} dùng thử đã kết thúc – tài khoản về gói Miễn phí.' },
      },
      en: {
        subject: 'Your Pro trial has ended',
        html: '<h1>Your trial has ended</h1><p>Your <strong>{{t plan_name}}</strong> trial has ended and your account is back on Free. Your progress is kept.</p><p><a class="btn" href="{{link}}">Upgrade to Pro</a></p>',
        text: 'Your {{t plan_name}} trial has ended and your account is back on Free.\nUpgrade to Pro: {{link}}',
        push: { title: 'Trial ended', body: 'Your account is back on Free.' },
        inapp: { title: 'Trial ended', body: '{{t plan_name}} trial ended – your account is back on Free.' },
      },
    },
  },
  'growth.referral_rewarded': {
    code: 'growth.referral_rewarded',
    category: 'billing',
    channels: ['inapp', 'push', 'email'],
    transactional: false,
    quietHours: 'defer',
    url: '/account/referral',
    locales: {
      vi: {
        subject: 'Bạn nhận được {{credits}} credit từ chương trình giới thiệu',
        html: '<h1>+{{credits}} credit</h1><p>{{#if is_referrer}}Bạn bè bạn giới thiệu {{#if (eq stage "upgraded")}}đã nâng cấp Pro{{else}}đã bắt đầu luyện thi{{/if}}{{else}}Cảm ơn bạn đã {{#if (eq stage "upgraded")}}nâng cấp Pro{{else}}bắt đầu luyện thi{{/if}} qua lời giới thiệu{{/if}} – tài khoản được cộng <strong>{{credits}}</strong> credit.</p><p><a class="btn" href="{{link}}">Mời thêm bạn bè</a></p>',
        text: '+{{credits}} credit từ chương trình giới thiệu.\nMời thêm bạn bè: {{link}}',
        push: { title: '+{{credits}} credit', body: 'Thưởng giới thiệu bạn bè đã được cộng.' },
        inapp: { title: 'Thưởng giới thiệu +{{credits}} credit', body: '{{#if is_referrer}}Bạn bè của bạn {{#if (eq stage "upgraded")}}đã nâng cấp Pro{{else}}đã bắt đầu học{{/if}}.{{else}}Quà chào mừng từ lời giới thiệu.{{/if}}' },
      },
      en: {
        subject: 'You earned {{credits}} referral credits',
        html: '<h1>+{{credits}} credits</h1><p>{{#if is_referrer}}A friend you invited {{#if (eq stage "upgraded")}}upgraded to Pro{{else}}started practising{{/if}}{{else}}Thanks for {{#if (eq stage "upgraded")}}upgrading to Pro{{else}}starting to practise{{/if}} through a referral{{/if}} – <strong>{{credits}}</strong> credits were added.</p><p><a class="btn" href="{{link}}">Invite more friends</a></p>',
        text: '+{{credits}} referral credits.\nInvite more friends: {{link}}',
        push: { title: '+{{credits}} credits', body: 'Your referral reward has been added.' },
        inapp: { title: 'Referral reward +{{credits}} credits', body: '{{#if is_referrer}}Your friend {{#if (eq stage "upgraded")}}upgraded to Pro{{else}}started learning{{/if}}.{{else}}Welcome gift from your referral.{{/if}}' },
      },
    },
  },
  'learning.study_reminder': {
    code: 'learning.study_reminder',
    category: 'learning',
    channels: ['push', 'inapp'],
    transactional: false,
    quietHours: 'skip',
    url: '/{{#if program}}{{program}}{{else}}toeic{{/if}}/today',
    locales: {
      vi: {
        subject: 'Đến giờ học rồi!',
        html: '<h1>Đến giờ học rồi!</h1><p>{{#if minutes}}Hôm nay chỉ cần {{minutes}} phút{{else}}Dành vài phút luyện tập hôm nay{{/if}}{{#if streak}} để giữ chuỗi {{streak}} ngày{{/if}}.</p><p><a class="btn" href="{{link}}">Học ngay</a></p>',
        text: 'Đến giờ học rồi! {{#if minutes}}Hôm nay chỉ cần {{minutes}} phút.{{/if}}\nHọc ngay: {{link}}',
        push: { title: 'Đến giờ học rồi!', body: '{{#if streak}}Giữ chuỗi {{streak}} ngày – {{/if}}{{#if minutes}}{{minutes}} phút hôm nay{{else}}vài phút luyện tập hôm nay{{/if}}.' },
        inapp: { title: 'Đến giờ học rồi!', body: '{{#if minutes}}{{minutes}} phút luyện tập hôm nay.{{else}}Vài phút luyện tập hôm nay.{{/if}}' },
      },
      en: {
        subject: 'Time to study!',
        html: '<h1>Time to study!</h1><p>{{#if minutes}}Just {{minutes}} minutes today{{else}}Take a few minutes to practise today{{/if}}{{#if streak}} to keep your {{streak}}-day streak{{/if}}.</p><p><a class="btn" href="{{link}}">Study now</a></p>',
        text: 'Time to study! {{#if minutes}}Just {{minutes}} minutes today.{{/if}}\nStudy now: {{link}}',
        push: { title: 'Time to study!', body: '{{#if streak}}Keep your {{streak}}-day streak – {{/if}}{{#if minutes}}{{minutes}} minutes today{{else}}a few minutes of practice today{{/if}}.' },
        inapp: { title: 'Time to study!', body: '{{#if minutes}}{{minutes}} minutes of practice today.{{else}}A few minutes of practice today.{{/if}}' },
      },
    },
  },
  'learning.weekly_summary': {
    code: 'learning.weekly_summary',
    category: 'marketing',
    channels: ['email', 'inapp'],
    transactional: false,
    quietHours: 'defer',
    url: '/{{#if program}}{{program}}{{else}}toeic{{/if}}/stats',
    locales: {
      vi: {
        subject: 'Tóm tắt tuần của bạn trên Allingo',
        html: '<h1>Tuần này bạn đã học</h1><ul><li><strong>{{minutes}}</strong> phút</li><li><strong>{{attempts}}</strong> bài luyện</li><li><strong>{{xp}}</strong> XP{{#if streak}}, chuỗi {{streak}} ngày{{/if}}</li></ul>{{#if estimate}}<p>Điểm ước tính hiện tại: <strong>{{estimate}}</strong>.</p>{{/if}}<p><a class="btn" href="{{link}}">Xem thống kê</a></p>',
        text: 'Tuần này: {{minutes}} phút, {{attempts}} bài luyện, {{xp}} XP{{#if streak}}, chuỗi {{streak}} ngày{{/if}}.\nXem thống kê: {{link}}',
        push: { title: 'Tóm tắt tuần', body: '{{minutes}} phút, {{attempts}} bài luyện tuần này.' },
        inapp: { title: 'Tóm tắt tuần', body: '{{minutes}} phút · {{attempts}} bài luyện · {{xp}} XP.' },
      },
      en: {
        subject: 'Your week on Allingo',
        html: '<h1>This week you studied</h1><ul><li><strong>{{minutes}}</strong> minutes</li><li><strong>{{attempts}}</strong> practice sets</li><li><strong>{{xp}}</strong> XP{{#if streak}}, {{streak}}-day streak{{/if}}</li></ul>{{#if estimate}}<p>Current estimated score: <strong>{{estimate}}</strong>.</p>{{/if}}<p><a class="btn" href="{{link}}">See your stats</a></p>',
        text: 'This week: {{minutes}} minutes, {{attempts}} practice sets, {{xp}} XP{{#if streak}}, {{streak}}-day streak{{/if}}.\nSee your stats: {{link}}',
        push: { title: 'Weekly summary', body: '{{minutes}} minutes, {{attempts}} practice sets this week.' },
        inapp: { title: 'Weekly summary', body: '{{minutes}} min · {{attempts}} practice sets · {{xp}} XP.' },
      },
    },
  },
  'learning.streak_at_risk': {
    code: 'learning.streak_at_risk',
    category: 'learning',
    channels: ['push', 'inapp'],
    transactional: false,
    quietHours: 'skip',
    url: '/{{#if program}}{{program}}{{else}}toeic{{/if}}/today',
    locales: {
      vi: {
        subject: 'Chuỗi {{streak}} ngày sắp mất!',
        html: '<h1>Đừng để mất chuỗi {{streak}} ngày!</h1><p>Hôm nay bạn chưa học. Chỉ cần một bài luyện ngắn trước nửa đêm để giữ chuỗi.</p><p><a class="btn" href="{{link}}">Học 5 phút</a></p>',
        text: 'Chuỗi {{streak}} ngày sắp mất – học một bài ngắn trước nửa đêm để giữ chuỗi.\n{{link}}',
        push: { title: 'Chuỗi {{streak}} ngày sắp mất!', body: 'Học một bài ngắn trước nửa đêm để giữ chuỗi nhé.' },
        inapp: { title: 'Chuỗi {{streak}} ngày sắp mất', body: 'Hôm nay bạn chưa học – một bài ngắn là đủ giữ chuỗi.' },
      },
      en: {
        subject: 'Your {{streak}}-day streak is about to end!',
        html: "<h1>Keep your {{streak}}-day streak!</h1><p>You haven't studied today. One short practice before midnight keeps your streak alive.</p><p><a class=\"btn\" href=\"{{link}}\">Study 5 minutes</a></p>",
        text: 'Your {{streak}}-day streak is about to end – one short practice before midnight keeps it.\n{{link}}',
        push: { title: 'Your {{streak}}-day streak is at risk!', body: 'One short practice before midnight keeps it alive.' },
        inapp: { title: 'Your {{streak}}-day streak is at risk', body: "You haven't studied today – one short practice is enough." },
      },
    },
  },
  'learning.badge_awarded': {
    code: 'learning.badge_awarded',
    category: 'learning',
    channels: ['inapp'],
    transactional: false,
    quietHours: 'defer',
    url: '/badges',
    locales: {
      vi: {
        subject: 'Bạn vừa nhận huy hiệu “{{t badge_name}}”',
        html: '<h1>Huy hiệu mới!</h1><p>Chúc mừng, bạn vừa nhận huy hiệu <strong>{{t badge_name}}</strong>.</p><p><a class="btn" href="{{link}}">Xem huy hiệu</a></p>',
        text: 'Chúc mừng, bạn vừa nhận huy hiệu {{t badge_name}}.\n{{link}}',
        push: { title: 'Huy hiệu mới!', body: 'Bạn vừa nhận “{{t badge_name}}”.' },
        inapp: { title: 'Huy hiệu mới: {{t badge_name}}', body: 'Chúc mừng! Tiếp tục giữ phong độ nhé.' },
      },
      en: {
        subject: 'You earned the “{{t badge_name}}” badge',
        html: '<h1>New badge!</h1><p>Congratulations, you earned the <strong>{{t badge_name}}</strong> badge.</p><p><a class="btn" href="{{link}}">See your badges</a></p>',
        text: 'Congratulations, you earned the {{t badge_name}} badge.\n{{link}}',
        push: { title: 'New badge!', body: 'You earned “{{t badge_name}}”.' },
        inapp: { title: 'New badge: {{t badge_name}}', body: 'Congratulations! Keep it up.' },
      },
    },
  },
  'learning.plan_adjust_ready': {
    code: 'learning.plan_adjust_ready',
    category: 'learning',
    channels: ['inapp'],
    transactional: false,
    quietHours: 'defer',
    url: '/{{#if program}}{{program}}{{else}}toeic{{/if}}/plan?proposal={{proposal_id}}',
    locales: {
      vi: {
        subject: 'Đề xuất điều chỉnh lộ trình tuần tới',
        html: '<h1>Lộ trình tuần tới đã có đề xuất mới</h1><p>Dựa trên check-in của bạn, Allingo đề xuất điều chỉnh tuần tới. Xem trước/sau rồi bấm Áp dụng.</p><p><a class="btn" href="{{link}}">Xem đề xuất</a></p>',
        text: 'Dựa trên check-in của bạn, Allingo đề xuất điều chỉnh tuần tới.\n{{link}}',
        push: { title: 'Đề xuất điều chỉnh lộ trình', body: 'Xem và áp dụng cho tuần tới.' },
        inapp: { title: 'Đề xuất điều chỉnh lộ trình', body: 'Xem trước/sau và áp dụng cho tuần tới.' },
      },
      en: {
        subject: 'Suggested changes for next week',
        html: '<h1>Your next week has a new suggestion</h1><p>Based on your check-in, Allingo suggests adjusting next week. Review before/after, then apply.</p><p><a class="btn" href="{{link}}">Review suggestion</a></p>',
        text: 'Based on your check-in, Allingo suggests adjusting next week.\n{{link}}',
        push: { title: 'Plan adjustment suggested', body: 'Review and apply it to next week.' },
        inapp: { title: 'Plan adjustment suggested', body: 'Review before/after and apply it to next week.' },
      },
    },
  },
  'admin.invoice_failed': {
    code: 'admin.invoice_failed',
    category: 'system',
    channels: ['inapp', 'email'],
    transactional: true,
    quietHours: 'ignore',
    url: '/admin/billing/dead-letters',
    locales: {
      vi: {
        subject: '[Allingo ops] Hoá đơn điện tử thất bại – đơn {{order_id}}',
        html: '<h1>Hoá đơn vào dead-letter</h1><p>Thao tác <strong>{{op}}</strong> cho đơn <code>{{order_id}}</code> thất bại sau {{attempts}} lần (mã lỗi <code>{{error_code}}</code>).</p><p>Xem và thử lại trong trang quản trị (runbook docs/runbooks/invoices.md).</p><p><a class="btn" href="{{link}}">Mở dead-letter</a></p>',
        text: 'Hoá đơn ({{op}}) cho đơn {{order_id}} thất bại sau {{attempts}} lần (mã lỗi {{error_code}}). Xem runbook docs/runbooks/invoices.md.\n{{link}}',
        push: { title: 'Hoá đơn thất bại', body: 'Đơn {{order_id}} – {{error_code}}' },
        inapp: { title: 'Hoá đơn điện tử thất bại', body: '{{op}} đơn {{order_id}} – {{attempts}} lần, mã {{error_code}}.' },
      },
      en: {
        subject: '[Allingo ops] E-invoice failed – order {{order_id}}',
        html: '<h1>Invoice moved to dead-letter</h1><p><strong>{{op}}</strong> for order <code>{{order_id}}</code> failed after {{attempts}} attempts (error <code>{{error_code}}</code>).</p><p>Review and retry in the admin console (runbook docs/runbooks/invoices.md).</p><p><a class="btn" href="{{link}}">Open dead-letters</a></p>',
        text: 'Invoice {{op}} for order {{order_id}} failed after {{attempts}} attempts (error {{error_code}}). See docs/runbooks/invoices.md.\n{{link}}',
        push: { title: 'Invoice failed', body: 'Order {{order_id}} – {{error_code}}' },
        inapp: { title: 'E-invoice failed', body: '{{op}} order {{order_id}} – {{attempts}} attempts, error {{error_code}}.' },
      },
    },
  },
};

export const NOTIFICATION_TEMPLATES: Readonly<Record<NotificationTemplateCode, TemplateDef>> = T;

export function templateFor(code: string): TemplateDef | null {
  return (T as Record<string, TemplateDef>)[code] ?? null;
}

/** Layout email (HTML) – CSS inline tối giản, nút, footer (quản lý thông báo + huỷ đăng ký với email không giao dịch) */
export const EMAIL_LAYOUT = {
  vi: {
    html: '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{subject}}</title><style>body{margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937}.wrap{max-width:560px;margin:0 auto;padding:24px}.card{background:#fff;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 12px;color:#0b1f4d}.btn{display:inline-block;background:#0b1f4d;color:#fff !important;padding:10px 18px;border-radius:8px;text-decoration:none}.foot{font-size:12px;color:#6b7280;margin-top:16px;line-height:1.6}.brand{font-weight:bold;color:#0b1f4d;font-size:18px;margin-bottom:12px}</style></head><body><div class="wrap"><div class="brand">Allingo</div><div class="card">{{{body}}}</div><div class="foot">Allingo – Ngoại ngữ cho tất cả.<br><a href="{{manage_url}}">Quản lý thông báo</a>{{#if unsubscribe_url}} · <a href="{{unsubscribe_url}}">Huỷ nhận email loại này</a>{{/if}}{{#if transactional}}<br>Đây là email giao dịch về tài khoản của bạn.{{/if}}</div></div></body></html>',
    text: '{{{body}}}\n\n--\nAllingo – Ngoại ngữ cho tất cả\nQuản lý thông báo: {{manage_url}}{{#if unsubscribe_url}}\nHuỷ nhận email loại này: {{unsubscribe_url}}{{/if}}',
  },
  en: {
    html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{subject}}</title><style>body{margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937}.wrap{max-width:560px;margin:0 auto;padding:24px}.card{background:#fff;border-radius:12px;padding:28px}h1{font-size:20px;margin:0 0 12px;color:#0b1f4d}.btn{display:inline-block;background:#0b1f4d;color:#fff !important;padding:10px 18px;border-radius:8px;text-decoration:none}.foot{font-size:12px;color:#6b7280;margin-top:16px;line-height:1.6}.brand{font-weight:bold;color:#0b1f4d;font-size:18px;margin-bottom:12px}</style></head><body><div class="wrap"><div class="brand">Allingo</div><div class="card">{{{body}}}</div><div class="foot">Allingo – Languages for everyone.<br><a href="{{manage_url}}">Manage notifications</a>{{#if unsubscribe_url}} · <a href="{{unsubscribe_url}}">Unsubscribe from these emails</a>{{/if}}{{#if transactional}}<br>This is a transactional email about your account.{{/if}}</div></div></body></html>',
    text: '{{{body}}}\n\n--\nAllingo – Languages for everyone\nManage notifications: {{manage_url}}{{#if unsubscribe_url}}\nUnsubscribe from these emails: {{unsubscribe_url}}{{/if}}',
  },
} as const;
