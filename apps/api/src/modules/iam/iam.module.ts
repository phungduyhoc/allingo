import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { EnrollmentsService } from './enrollments.service.js';
import { MeController } from './me.controller.js';
import { MergeService } from './merge.service.js';
import { SessionsService } from './sessions.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [BillingModule],
  controllers: [AuthController, MeController],
  providers: [AuthService, UsersService, SessionsService, MergeService, EnrollmentsService],
  exports: [UsersService, EnrollmentsService, SessionsService],
})
export class IamModule {}
