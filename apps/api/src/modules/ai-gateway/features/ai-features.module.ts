import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/index.js';
import { CatalogModule } from '../../catalog/index.js';
import { IamModule } from '../../iam/index.js';
import { AiGatewayModule } from '../core/ai-gateway.module.js';
import { AiController } from './ai.controller.js';
import { ExplainService } from './explain.service.js';
import { FeedbackService } from './feedback.service.js';
import { ThreadsService } from './threads.service.js';

/** Endpoint /ai/* (explain, tutor chat, feedback) – tách khỏi lõi để tránh phụ thuộc vòng với catalog */
@Module({
  imports: [AiGatewayModule, CatalogModule, BillingModule, IamModule],
  controllers: [AiController],
  providers: [ExplainService, ThreadsService, FeedbackService],
  exports: [ExplainService],
})
export class AiFeaturesModule {}
