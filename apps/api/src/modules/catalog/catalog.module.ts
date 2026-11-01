import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { BillingModule } from '../billing/index.js';
import { IamModule } from '../iam/index.js';
import { AdminContentController } from './admin-content.controller.js';
import { AdminTestSetsController } from './admin-test-sets.controller.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { ContentAiCheckService } from './content-ai-check.service.js';
import { ContentGenerationService } from './content-generation.service.js';
import { ContentPublishService } from './content-publish.service.js';
import { ContentWorkflowService } from './content-workflow.service.js';
import { InternalContentController, InternalTokenGuardFactory } from './internal-content.controller.js';
import { MiniTestService } from './mini-test.service.js';
import { SearchService } from './search/search.service.js';

@Module({
  imports: [BillingModule, AiGatewayModule, IamModule],
  controllers: [CatalogController, InternalContentController, AdminContentController, AdminTestSetsController],
  providers: [CatalogQueryService, ContentPublishService, ContentWorkflowService, ContentAiCheckService, ContentGenerationService, SearchService, InternalTokenGuardFactory, MiniTestService],
  exports: [CatalogQueryService, ContentPublishService, ContentWorkflowService, ContentGenerationService, SearchService, MiniTestService],
})
export class CatalogModule {}
