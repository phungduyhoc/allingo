import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@allingo/db';
import { DbService } from '../../../shared/db/db.module.js';
import { Forbidden, NotFound } from '../../../shared/http/errors.js';
import { AiGatewayService } from '../core/ai-gateway.service.js';
import { ExplanationCacheService } from '../core/explanation-cache.service.js';

const { aiFeedback } = schema;

export interface FeedbackInput {
  ai_task_id: string;
  rating: 'helpful' | 'not_helpful' | 'wrong';
  comment?: string;
}

/**
 * POST /ai/feedback (S5): 👍 helpful / 👎 not_helpful / wrong + lý do (comment).
 * Chỉ chủ tác vụ (ai_tasks.user_id) được đánh giá; mỗi người một phản hồi/tác vụ – gửi lại thì cập nhật.
 * Giải thích (explain_mcq): cập nhật `ai.explanation_cache.quality_score` (EMA) cho đúng khoá cache.
 */
@Injectable()
export class FeedbackService {
  constructor(
    private readonly dbs: DbService,
    private readonly gateway: AiGatewayService,
    private readonly cache: ExplanationCacheService,
  ) {}

  async submit(userId: string, input: FeedbackInput): Promise<{ id: string; ai_task_id: string; rating: string; updated: boolean }> {
    const owner = await this.gateway.taskOwner(input.ai_task_id);
    if (!owner) throw new NotFound('ai_task', input.ai_task_id);
    if (owner.userId !== userId) throw new Forbidden('Only the owner of the AI task can rate it', { ai_task_id: input.ai_task_id });
    const comment = input.comment?.trim() ? input.comment.trim().slice(0, 1000) : null;
    const [existing] = await this.dbs.db
      .select({ id: aiFeedback.id })
      .from(aiFeedback)
      .where(and(eq(aiFeedback.userId, userId), eq(aiFeedback.aiTaskId, input.ai_task_id)))
      .orderBy(desc(aiFeedback.createdAt))
      .limit(1);
    let id: string;
    if (existing) {
      await this.dbs.db.update(aiFeedback).set({ rating: input.rating, comment }).where(eq(aiFeedback.id, existing.id));
      id = existing.id;
    } else {
      const [row] = await this.dbs.db.insert(aiFeedback).values({ userId, aiTaskId: input.ai_task_id, rating: input.rating, comment }).returning({ id: aiFeedback.id });
      id = row!.id;
    }
    if (owner.taskCode === 'explain_mcq' && owner.inputRef && typeof owner.inputRef.question_version_id === 'string') {
      const ref = owner.inputRef as { question_version_id: string; chosen_option?: string | null; locale?: string };
      if (ref.locale) await this.cache.recordFeedback(ref.question_version_id, ref.chosen_option ?? null, ref.locale, input.rating === 'helpful').catch(() => undefined);
    }
    return { id, ai_task_id: input.ai_task_id, rating: input.rating, updated: !!existing };
  }
}
