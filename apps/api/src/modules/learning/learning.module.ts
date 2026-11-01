import { Module } from '@nestjs/common';
import { IamModule } from '../iam/index.js';
import { TestEngineModule } from '../test-engine/index.js';
import { LearningController } from './learning.controller.js';
import { ProgressService } from './progress.service.js';
import { AttemptSummaryService } from './attempt-summary.service.js';
import { AiGatewayModule } from '../ai-gateway/index.js';

@Module({ imports: [IamModule, TestEngineModule, AiGatewayModule], controllers: [LearningController], providers: [ProgressService, AttemptSummaryService], exports: [ProgressService, AttemptSummaryService] })
export class LearningModule {}
