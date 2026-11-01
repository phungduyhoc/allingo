import { Injectable } from '@nestjs/common';
import type { AiCheckReport, CheckQuestionOutput, QuestionContent } from '@allingo/schemas';
import { AiGatewayService } from '../ai-gateway/core/ai-gateway.service.js';
import { ContentWorkflowService, type Actor } from './content-workflow.service.js';

export interface AiCheckResult {
  verdict: 'pass' | 'fail' | 'needs_change';
  issues: Array<{ field?: string; severity: 'error' | 'warning'; message: string }>;
  report: CheckQuestionOutput;
  ai_task_id: string | null;
}

/** AI kiểm tra câu hỏi (`check_question` qua AiGateway – CLAUDE.md §5.2); không trừ credit người dùng */
@Injectable()
export class ContentAiCheckService {
  constructor(
    private readonly gateway: AiGatewayService,
    private readonly workflow: ContentWorkflowService,
  ) {}

  async check(input: { program: string; section_code: string; content: QuestionContent; difficulty_target?: string }): Promise<AiCheckResult> {
    const r = await this.gateway.runTask<CheckQuestionOutput>({
      taskCode: 'check_question',
      userId: null,
      chargeCredits: false,
      program: input.program,
      variables: { program: input.program, section_code: input.section_code, question_type: input.content.type, difficulty_target: { level: input.difficulty_target ?? 'B1', irt_b: 0 }, section_rules: {}, item: input.content },
      inputRef: { purpose: 'content_check' },
    });
    return {
      verdict: r.data.verdict,
      issues: r.data.issues.map((i) => ({ field: i.area, severity: i.severity === 'major' ? 'error' : 'warning', message: i.detail + (i.fix ? ` → ${i.fix}` : '') })),
      report: r.data,
      ai_task_id: r.aiTaskId,
    };
  }

  /** Kiểm tra bản head của câu trong catalog rồi ghi review stage ai_check (pass → ai_checked; fail chặn gửi duyệt) */
  async runForQuestion(actor: Actor, questionId: string, meta: { ip?: string | null; userAgent?: string | null } = {}) {
    const q = await this.workflow.get(questionId);
    const res = await this.check({ program: q.program, section_code: q.section_code, content: q.head_version.content, difficulty_target: q.difficulty_target ?? undefined });
    const aiReport: AiCheckReport = { verdict: res.verdict, issues: res.issues, ai_task_id: res.ai_task_id, checked_at: new Date().toISOString(), report: res.report };
    const decision = res.verdict === 'pass' ? 'approve' : res.verdict === 'fail' ? 'reject' : 'needs_change';
    const question = await this.workflow.review(actor, 'question', questionId, { stage: 'ai_check', decision, notes: res.issues.map((i) => i.message).join('\n') || undefined, aiReport, viaAiCheck: true }, meta);
    return { question, ai_check: res };
  }
}
