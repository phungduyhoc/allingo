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

/** learning: tiến bộ, tóm tắt (S5), gia sư AI /ai/threads* + tra từ & thẻ SRS (S6) */
@Module({
  imports: [IamModule, TestEngineModule, AiGatewayModule, CatalogModule, BillingModule],
  controllers: [LearningController, TutorController, VocabController],
  providers: [ProgressService, AttemptSummaryService, ThreadsService, SrsService],
  exports: [ProgressService, AttemptSummaryService, ThreadsService, SrsService],
})
export class LearningModule {}
