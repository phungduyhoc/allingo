import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DOMAIN_EVENTS } from '@allingo/schemas';
import type { OutboxEvent } from '../../shared/events/outbox.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { NotificationService } from './notify/notification.service.js';

interface BadgePayload {
  user_id: string;
  badge_code: string;
  name?: Record<string, string>;
  earned_at?: string;
}

interface ProposalPayload {
  proposal_id: string;
  user_id: string;
  status: string;
  source: string;
}

/**
 * Thông báo learning (S9) – learning (tầng 3) chỉ phát sự kiện; growth (tầng 4) gửi: huy hiệu mới → in-app
 * `learning.badge_awarded`; đề xuất điều chỉnh sau check-in sẵn sàng → in-app `learning.plan_adjust_ready`.
 * Nghe cả local (cùng process) lẫn outbox relay; chống trùng bằng dedupe_key của NotificationService.
 */
@Injectable()
export class LearningNotificationsListener {
  private readonly logger = getLogger({ component: 'growth.learning' });

  constructor(private readonly notify: NotificationService) {}

  async badgeAwarded(p: BadgePayload): Promise<void> {
    if (!p?.user_id || !p.badge_code) return;
    await this.notify.send(p.user_id, 'learning.badge_awarded', { badge_code: p.badge_code, badge_name: p.name ?? { vi: p.badge_code, en: p.badge_code } }, { dedupeKey: `badge:${p.badge_code}` });
  }

  async proposalReady(p: ProposalPayload): Promise<void> {
    if (!p?.user_id || p.status !== 'ready' || p.source !== 'checkin') return;
    await this.notify.send(p.user_id, 'learning.plan_adjust_ready', { proposal_id: p.proposal_id }, { dedupeKey: `plan_adjust:${p.proposal_id}` });
  }

  @OnEvent(`local.${DOMAIN_EVENTS.BADGE_AWARDED}`)
  async onLocalBadge(p: BadgePayload): Promise<void> {
    await this.badgeAwarded(p).catch((err: Error) => this.logger.warn({ err: err.message, badge: p?.badge_code }, 'badge notification failed'));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.BADGE_AWARDED}`)
  async onOutboxBadge(ev: OutboxEvent<BadgePayload>): Promise<void> {
    await this.onLocalBadge(ev.payload);
  }

  @OnEvent(`local.${DOMAIN_EVENTS.PLAN_ADJUST_PROPOSED}`)
  async onLocalProposal(p: ProposalPayload): Promise<void> {
    await this.proposalReady(p).catch((err: Error) => this.logger.warn({ err: err.message }, 'plan adjust notification failed'));
  }

  @OnEvent(`outbox.${DOMAIN_EVENTS.PLAN_ADJUST_PROPOSED}`)
  async onOutboxProposal(ev: OutboxEvent<ProposalPayload>): Promise<void> {
    await this.onLocalProposal(ev.payload);
  }
}
