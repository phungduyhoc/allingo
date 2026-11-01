import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { BillingModule } from '../billing/index.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { ContentPublishService } from './content-publish.service.js';
import { InternalContentController, InternalTokenGuardFactory } from './internal-content.controller.js';

@Module({
  imports: [BillingModule, AiGatewayModule],
  controllers: [CatalogController, InternalContentController],
  providers: [CatalogQueryService, ContentPublishService, InternalTokenGuardFactory],
  exports: [CatalogQueryService, ContentPublishService],
})
export class CatalogModule {}
