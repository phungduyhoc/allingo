import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/index.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LoginProtectionService } from './login-protection.service.js';
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
import { AdminUsersService } from './admin-users.service.js';
import { LegalController } from './legal/legal.controller.js';
import { MfaController } from './mfa/mfa.controller.js';
import { MfaService } from './mfa/mfa.service.js';
import { PasswordPolicyService } from './password/password-policy.js';

@Module({
  imports: [BillingModule],
  controllers: [AuthController, MeController, MfaController, LegalController],
  providers: [AuthService, UsersService, SessionsService, MergeService, EnrollmentsService, ConsentsService, DeletionService, OAuthService, OtpService, TurnstileService, WelcomeCreditsService, LoginProtectionService, MfaService, PasswordPolicyService, AdminUsersService],
  exports: [UsersService, EnrollmentsService, SessionsService, DeletionService, OAuthService, OtpService, ConsentsService, MfaService, PasswordPolicyService, AdminUsersService],
})
export class IamModule {}
