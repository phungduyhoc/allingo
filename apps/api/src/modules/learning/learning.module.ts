import { Module } from '@nestjs/common';
import { IamModule } from '../iam/index.js';
import { TestEngineModule } from '../test-engine/index.js';
import { LearningController } from './learning.controller.js';
import { ProgressService } from './progress.service.js';

@Module({ imports: [IamModule, TestEngineModule], controllers: [LearningController], providers: [ProgressService], exports: [ProgressService] })
export class LearningModule {}
