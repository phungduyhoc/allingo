import { Global, Module } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConnectedSocket, OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { JwtService } from '../auth/jwt.service.js';
import { ACCESS_COOKIE } from '../auth/auth.guard.js';
import { getLogger } from '../telemetry/logger.js';

/**
 * Socket.IO /ws: xác thực bằng cookie allingo_at hoặc auth.token (bearer); mỗi user vào room user:<id>.
 * Sự kiện đẩy: attempt.graded, ai_task.completed (từ EventEmitter local.*).
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;
  private readonly logger = getLogger({ component: 'realtime' });
  constructor(private readonly jwt: JwtService) {}

  async handleConnection(@ConnectedSocket() client: Socket): Promise<void> {
    const token = (client.handshake.auth?.token as string | undefined) ?? parseCookie(client.handshake.headers.cookie)[ACCESS_COOKIE];
    const claims = token ? await this.jwt.verifyAccess(token) : null;
    if (!claims) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${claims.sub}`);
    client.data.userId = claims.sub;
  }

  emitToUser(userId: string, event: string, payload: Record<string, unknown>): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  @OnEvent('local.attempt.graded')
  onAttemptGraded(payload: { user_id: string; attempt_id: string; scaled_score?: number | null }): void {
    this.emitToUser(payload.user_id, 'attempt.graded', { attempt_id: payload.attempt_id, scaled_score: payload.scaled_score ?? null });
  }

  @OnEvent('local.ai_task.completed')
  onAiTaskCompleted(payload: { user_id: string | null; ai_task_id: string; task_code: string; status: string }): void {
    if (payload.user_id) this.emitToUser(payload.user_id, 'ai_task.completed', payload);
  }
}

function parseCookie(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

@Global()
@Module({ providers: [RealtimeGateway], exports: [RealtimeGateway] })
export class RealtimeModule {}
