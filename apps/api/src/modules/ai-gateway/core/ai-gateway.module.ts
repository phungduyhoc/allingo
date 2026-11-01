import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/index.js';
import { AiGatewayService } from './ai-gateway.service.js';
import { ExplanationCacheService } from './explanation-cache.service.js';
import { GuardrailsService } from './guardrails.service.js';
import { ModelRouter } from './model-router.js';
import { PromptRenderer } from './prompt-renderer.js';
import { TaskRegistry } from './task-registry.js';

/** Lõi AI Gateway – không phụ thuộc module nghiệp vụ nào ngoài billing (credit) */
@Module({
  imports: [BillingModule],
  providers: [AiGatewayService, TaskRegistry, PromptRenderer, ModelRouter, ExplanationCacheService, GuardrailsService],
  exports: [AiGatewayService, TaskRegistry, ModelRouter, ExplanationCacheService, GuardrailsService],
})
export class AiGatewayModule {}
