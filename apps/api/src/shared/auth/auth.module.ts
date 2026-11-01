import { Global, Module } from '@nestjs/common';
import { JwtService } from './jwt.service.js';
import { SessionRevocationService } from './session-revocation.service.js';

@Global()
@Module({ providers: [JwtService, SessionRevocationService], exports: [JwtService, SessionRevocationService] })
export class SharedAuthModule {}
