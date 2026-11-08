import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import type { OutboxEvent } from '../../shared/events/outbox.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationService } from './notify/notification.service.js';

interface ResolvedPayload {
  report_id: string;
  user_id: string;
  status: string;
  dedupe_key?: string;
}

/** S12: báo lỗi câu đã xử lý → in-app cảm ơn người báo (local + outbox, chống trùng theo dedupe_key) */
@Injectable()
export class S12NotificationsListener {
  private readonly logger = getLogger({ component: 'growth.s12' });

  constructor(private readonly notify: NotificationService) {}

  async reportResolved(p: ResolvedPayload): Promise<void> {
    if (!p?.user_id || !p.report_id) return;
    await this.notify.send(p.user_id, 'content.report_resolved', { report_id: p.report_id, fixed: p.status === 'fixed' }, { dedupeKey: `content_report:${p.report_id}` });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.CONTENT_REPORT_RESOLVED}`)
  async onLocal(p: ResolvedPayload): Promise<void> {
    await this.reportResolved(p).catch((err: Error) => this.logger.warn({ err: err.message.slice(0, 200) }, 'report resolved notification failed'));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.CONTENT_REPORT_RESOLVED}`)
  async onOutbox(ev: OutboxEvent<ResolvedPayload>): Promise<void> {
    await this.onLocal(ev.payload);
  }
}
