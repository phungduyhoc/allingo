import type { S12NotificationTemplateCode } from '@allingo/schemas';
import type { TemplateDef } from './templates.js';

/**
 * Mẫu S12 (beta kín & hỗ trợ). `beta.invite` gửi cho người trong danh sách chờ (chưa có tài khoản) – render bằng cùng renderer,
 * gửi thẳng qua MailerService (không ghi ops.notifications vì chưa có user_id). Mã mời chỉ có trong email, không lưu.
 */
export const S12_TEMPLATES: Record<S12NotificationTemplateCode, TemplateDef> = {
  'beta.invite': {
    code: 'beta.invite',
    category: 'system',
    channels: ['email'],
    transactional: true,
    quietHours: 'ignore',
    url: '/beta?code={{code}}',
    locales: {
      vi: {
        subject: 'Mời bạn tham gia beta kín Allingo {{program_name}}',
        html: '<h1>Bạn được mời dùng thử Allingo!</h1><p>Cảm ơn bạn đã đăng ký danh sách chờ. Bạn là một trong những người đầu tiên trải nghiệm luyện thi {{program_name}} với AI.</p><p>Mã mời của bạn (dùng một lần, hạn tới {{date expires_at}}):</p><p style="font-size:22px;font-weight:bold;letter-spacing:2px">{{code}}</p><p>Quyền lợi: <strong>Pro dùng thử {{trial_days}} ngày</strong> + <strong>{{credits}} credit AI</strong>.</p><p><a class="btn" href="{{link}}">Kích hoạt ngay</a></p><p>Bạn nhận email này vì đã đăng ký danh sách chờ trên allingo.vn. Không muốn tham gia? Bỏ qua email – mã sẽ tự hết hạn.</p>',
        text: 'Bạn được mời dùng thử Allingo {{program_name}}!\nMã mời (dùng một lần, hạn tới {{date expires_at}}): {{code}}\nQuyền lợi: Pro dùng thử {{trial_days}} ngày + {{credits}} credit AI.\nKích hoạt: {{link}}\nBạn nhận email này vì đã đăng ký danh sách chờ trên allingo.vn.',
        push: { title: 'Mời tham gia beta', body: 'Mã mời Allingo của bạn đã sẵn sàng.' },
        inapp: { title: 'Mời tham gia beta', body: 'Mã mời Allingo của bạn đã sẵn sàng.' },
      },
      en: {
        subject: "You're invited to the Allingo {{program_name}} closed beta",
        html: "<h1>You're invited to try Allingo!</h1><p>Thanks for joining the waitlist. You're among the first to practise {{program_name}} with AI.</p><p>Your invitation code (single use, valid until {{date expires_at}}):</p><p style=\"font-size:22px;font-weight:bold;letter-spacing:2px\">{{code}}</p><p>Perks: <strong>{{trial_days}}-day Pro trial</strong> + <strong>{{credits}} AI credits</strong>.</p><p><a class=\"btn\" href=\"{{link}}\">Activate now</a></p><p>You received this email because you joined the waitlist on allingo.vn. Not interested? Just ignore it – the code expires automatically.</p>",
        text: "You're invited to try Allingo {{program_name}}!\nInvitation code (single use, valid until {{date expires_at}}): {{code}}\nPerks: {{trial_days}}-day Pro trial + {{credits}} AI credits.\nActivate: {{link}}\nYou received this email because you joined the waitlist on allingo.vn.",
        push: { title: 'Beta invitation', body: 'Your Allingo invitation code is ready.' },
        inapp: { title: 'Beta invitation', body: 'Your Allingo invitation code is ready.' },
      },
    },
  },
  'support.reply': {
    code: 'support.reply',
    category: 'system',
    channels: ['inapp', 'email'],
    transactional: true,
    quietHours: 'ignore',
    url: '/support/tickets/{{ticket_id}}',
    locales: {
      vi: {
        subject: 'Allingo đã trả lời yêu cầu hỗ trợ: {{subject}}',
        html: '<h1>Đội hỗ trợ đã trả lời</h1><p>Yêu cầu <strong>{{subject}}</strong>:</p><blockquote style="border-left:3px solid #c9a227;margin:0;padding:8px 12px;white-space:pre-wrap">{{message}}</blockquote>{{#if credits}}<p>Chúng tôi đã cộng <strong>{{credits}}</strong> credit vào tài khoản của bạn.</p>{{/if}}<p><a class="btn" href="{{link}}">Xem và trả lời</a></p>',
        text: 'Đội hỗ trợ đã trả lời yêu cầu "{{subject}}":\n\n{{message}}\n{{#if credits}}\nĐã cộng {{credits}} credit vào tài khoản.\n{{/if}}\nXem và trả lời: {{link}}',
        push: { title: 'Hỗ trợ đã trả lời', body: '{{subject}}' },
        inapp: { title: 'Hỗ trợ đã trả lời', body: '{{subject}}{{#if credits}} · +{{credits}} credit{{/if}}' },
      },
      en: {
        subject: 'Allingo replied to your support request: {{subject}}',
        html: '<h1>Our support team replied</h1><p>Request <strong>{{subject}}</strong>:</p><blockquote style="border-left:3px solid #c9a227;margin:0;padding:8px 12px;white-space:pre-wrap">{{message}}</blockquote>{{#if credits}}<p>We added <strong>{{credits}}</strong> credits to your account.</p>{{/if}}<p><a class="btn" href="{{link}}">View and reply</a></p>',
        text: 'Our support team replied to "{{subject}}":\n\n{{message}}\n{{#if credits}}\nWe added {{credits}} credits to your account.\n{{/if}}\nView and reply: {{link}}',
        push: { title: 'Support replied', body: '{{subject}}' },
        inapp: { title: 'Support replied', body: '{{subject}}{{#if credits}} · +{{credits}} credits{{/if}}' },
      },
    },
  },
  'content.report_resolved': {
    code: 'content.report_resolved',
    category: 'learning',
    channels: ['inapp'],
    transactional: false,
    quietHours: 'skip',
    url: '/notifications',
    locales: {
      vi: {
        subject: 'Cảm ơn bạn đã báo lỗi câu hỏi',
        html: '<p>Cảm ơn bạn đã báo lỗi câu hỏi.</p>',
        text: 'Cảm ơn bạn đã báo lỗi câu hỏi.',
        push: { title: 'Cảm ơn bạn', body: 'Báo lỗi câu hỏi đã được xử lý.' },
        inapp: { title: 'Báo lỗi đã được xử lý', body: '{{#if fixed}}Câu hỏi bạn báo đã được sửa. Cảm ơn bạn!{{else}}Biên tập viên đã xem báo cáo của bạn. Cảm ơn bạn!{{/if}}' },
      },
      en: {
        subject: 'Thanks for reporting a question',
        html: '<p>Thanks for reporting a question.</p>',
        text: 'Thanks for reporting a question.',
        push: { title: 'Thank you', body: 'Your question report was handled.' },
        inapp: { title: 'Report handled', body: '{{#if fixed}}The question you reported has been fixed. Thank you!{{else}}An editor reviewed your report. Thank you!{{/if}}' },
      },
    },
  },
};
