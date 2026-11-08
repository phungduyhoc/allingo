// Giao diện công khai của module iam (CLAUDE.md §5.1)
export { IamModule } from './iam.module.js';
export { UsersService, type UserRow } from './users.service.js';
export { EnrollmentsService } from './enrollments.service.js';
export { SessionsService } from './sessions.service.js';
export { DeletionService } from './deletion.service.js';
export { OAuthService } from './oauth/oauth.service.js';
export { OtpService } from './otp/otp.service.js';
export { ConsentsService } from './consents.service.js';
// S10
export { sanitizeAttribution, type StoredAttribution } from './attribution.js';
// S12
export { AdminUsersService, maskEmail, maskPhone } from './admin-users.service.js';
export { MfaService } from './mfa/mfa.service.js';
export { PasswordPolicyService, checkPasswordPolicy, type PasswordIssue } from './password/password-policy.js';
export { base32Decode, base32Encode, hotp, totp, verifyTotp, otpauthUrl } from './mfa/totp.js';
export { policyCatalog } from './legal/legal.controller.js';
