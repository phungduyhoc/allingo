// Giao diện công khai của module iam (CLAUDE.md §5.1)
export { IamModule } from './iam.module.js';
export { UsersService, type UserRow } from './users.service.js';
export { EnrollmentsService } from './enrollments.service.js';
export { SessionsService } from './sessions.service.js';
export { DeletionService } from './deletion.service.js';
export { OAuthService } from './oauth/oauth.service.js';
export { OtpService } from './otp/otp.service.js';
export { ConsentsService } from './consents.service.js';
