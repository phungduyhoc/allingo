import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { CatalogModule } from '../catalog/index.js';
import { IamModule } from '../iam/index.js';
import { TestEngineModule } from '../test-engine/index.js';
import { AiGatewayModule } from '../ai-gateway/index.js';
import { LearningController } from './learning.controller.js';
import { ProgressService } from './progress.service.js';
import { AttemptSummaryService } from './attempt-summary.service.js';
import { SrsService } from './srs.service.js';
import { VocabController } from './vocab.controller.js';
import { ThreadsService } from './tutor/threads.service.js';
import { TutorController } from './tutor/tutor.controller.js';
import { GamificationService } from './gamification/gamification.service.js';
import { PlanService } from './plan/plan.service.js';
import { PlanAdjustService } from './plan/plan-adjust.service.js';
import { PlanController } from './plan/plan.controller.js';
import { DiagnosticService } from './diagnostic/diagnostic.service.js';
import { DiagnosticController } from './diagnostic/diagnostic.controller.js';
import { LearningJobsService } from './learning-jobs.service.js';

/**
 * learning: tiến bộ, tóm tắt (S5), gia sư AI /ai/threads* + tra từ & thẻ SRS (S6), S9: bài chẩn đoán thích ứng, lộ trình tuần
 * (PlanGenerator @allingo/planner), check-in + plan_adjust, streak/XP/huy hiệu.
 */
@Module({
  imports: [IamModule, TestEngineModule, AiGatewayModule, CatalogModule, BillingModule],
  controllers: [LearningController, TutorController, VocabController, PlanController, DiagnosticController],
  providers: [ProgressService, AttemptSummaryService, ThreadsService, SrsService, GamificationService, PlanService, PlanAdjustService, DiagnosticService, LearningJobsService],
  exports: [ProgressService, AttemptSummaryService, ThreadsService, SrsService, GamificationService, PlanService, PlanAdjustService, DiagnosticService, LearningJobsService],
})
export class LearningModule {}
