import { AiQualityService } from './ai-quality.service.js';
import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/index.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { AiTelemetry } from './ai-telemetry.js';
import { EmbeddingService } from './embedding.service.js';
import { EvalService } from './eval.service.js';
import { ExplanationCacheService } from './explanation-cache.service.js';
import { GuardrailsService } from './guardrails.service.js';
import { ModelRouter } from './model-router.js';
import { PromptAdminService } from './prompt-admin.service.js';
import { PromptRenderer } from './prompt-renderer.js';
import { TaskRegistry } from './task-registry.js';

/** Lõi AI Gateway – không phụ thuộc module nghiệp vụ nào ngoài billing (credit) */
@Module({
  imports: [BillingModule],
  providers: [AiQualityService, AiGatewayService, TaskRegistry, PromptRenderer, ModelRouter, ExplanationCacheService, GuardrailsService, AiTelemetry, EmbeddingService, PromptAdminService, EvalService],
  exports: [AiQualityService, AiGatewayService, TaskRegistry, PromptRenderer, ModelRouter, ExplanationCacheService, GuardrailsService, AiTelemetry, EmbeddingService, PromptAdminService, EvalService],
})
export class AiGatewayModule {}
