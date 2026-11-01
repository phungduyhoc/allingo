import { Global, Module } from '@nestjs/common';
import { JwtService } from './jwt.service.js';

@Global()
@Module({ providers: [JwtService], exports: [JwtService] })
export class SharedAuthModule {}
