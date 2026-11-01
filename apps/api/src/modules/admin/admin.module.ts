import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { IamModule } from '../iam/index.js';
import { AdminController } from './admin.controller.js';

@Module({ imports: [AiGatewayModule, IamModule], controllers: [AdminController] })
export class AdminModule {}
