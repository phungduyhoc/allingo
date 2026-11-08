import { Global, Module } from '@nestjs/common';
import { JwtService } from './jwt.service.js';
import { MfaEnrollmentLookup } from './mfa-enrollment.lookup.js';
import { SessionRevocationService } from './session-revocation.service.js';

@Global()
@Module({ providers: [JwtService, SessionRevocationService, MfaEnrollmentLookup], exports: [JwtService, SessionRevocationService, MfaEnrollmentLookup] })
export class SharedAuthModule {}
