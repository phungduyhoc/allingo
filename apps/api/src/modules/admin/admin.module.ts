import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { AnalyticsModule } from '../analytics/index.js';
import { BillingModule } from '../billing/index.js';
import { CatalogModule } from '../catalog/index.js';
import { GradingModule } from '../grading/index.js';
import { GrowthModule } from '../growth/index.js';
import { IamModule } from '../iam/index.js';
import { TestEngineModule } from '../test-engine/index.js';
import { AdminController } from './admin.controller.js';
import { AdminAiController } from './admin-ai.controller.js';
import { AdminOpsController } from './admin-ops.controller.js';
import { AdminOpsService } from './admin-ops.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { RetentionService } from './retention.service.js';

/** admin (tầng 4): S1/S5 vai trò & AI; S12 người dùng (khoá/impersonate), nội dung, hệ thống (DLQ, partition), audit, retention */
@Module({
  imports: [AiGatewayModule, IamModule, BillingModule, CatalogModule, GradingModule, GrowthModule, AnalyticsModule, TestEngineModule],
  controllers: [AdminController, AdminAiController, AdminUsersController, AdminOpsController],
  providers: [AdminOpsService, RetentionService],
  exports: [AdminOpsService, RetentionService],
})
export class AdminModule {}
