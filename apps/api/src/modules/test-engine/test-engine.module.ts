import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { BillingModule } from '../billing/index.js';
import { CatalogModule } from '../catalog/index.js';
import { IamModule } from '../iam/index.js';
import { IdempotencyService } from '../../shared/http/idempotency.js';
import { AttemptsController } from './attempts.controller.js';
import { AttemptsService } from './attempts.service.js';
import { AttemptDiagnosisController } from './attempt-diagnosis.controller.js';
import { AttemptDiagnosisService } from './attempt-diagnosis.service.js';

@Module({
  imports: [CatalogModule, BillingModule, AiGatewayModule, IamModule],
  controllers: [AttemptsController, AttemptDiagnosisController],
  providers: [AttemptsService, IdempotencyService, AttemptDiagnosisService],
  exports: [AttemptsService, AttemptDiagnosisService],
})
export class TestEngineModule {}
