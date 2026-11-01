import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { SpeechModule } from '../speech/index.js';
import { UploadsController } from './uploads.controller.js';
import { UploadsService } from './uploads.service.js';

/**
 * Module grading – Sprint 2: tải lên trực tiếp (`POST /uploads/presign`) cho ghi âm/ảnh của người học.
 * Pipeline chấm Writing/Speaking (submissions, grade.*) ở các sprint sau – xem README.md.
 */
@Module({
  imports: [BillingModule, SpeechModule],
  controllers: [UploadsController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class GradingModule {}
