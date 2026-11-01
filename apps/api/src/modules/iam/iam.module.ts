import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ConsentsService } from './consents.service.js';
import { DeletionService } from './deletion.service.js';
import { EnrollmentsService } from './enrollments.service.js';
import { MeController } from './me.controller.js';
import { MergeService } from './merge.service.js';
import { OAuthService } from './oauth/oauth.service.js';
import { OtpService } from './otp/otp.service.js';
import { SessionsService } from './sessions.service.js';
import { TurnstileService } from './turnstile.service.js';
import { UsersService } from './users.service.js';
import { WelcomeCreditsService } from './welcome-credits.service.js';

@Module({
  imports: [BillingModule],
  controllers: [AuthController, MeController],
  providers: [AuthService, UsersService, SessionsService, MergeService, EnrollmentsService, ConsentsService, DeletionService, OAuthService, OtpService, TurnstileService, WelcomeCreditsService],
  exports: [UsersService, EnrollmentsService, SessionsService, DeletionService, OAuthService, OtpService, ConsentsService],
})
export class IamModule {}
