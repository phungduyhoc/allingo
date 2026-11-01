import { Module } from '@nestjs/common';
import { AiGatewayModule } from '../ai-gateway/core/ai-gateway.module.js';
import { AdminController } from './admin.controller.js';

@Module({ imports: [AiGatewayModule], controllers: [AdminController] })
export class AdminModule {}
