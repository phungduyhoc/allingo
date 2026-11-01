import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiStreamEvent } from '@allingo/schemas';

/** Ghi luồng SSE: `event: <tên>` + `data: <json>` theo chuẩn text/event-stream; heartbeat 15 s; dừng ở `done` */
export async function writeSse(reply: FastifyReply, events: AsyncIterable<AiStreamEvent>, req: FastifyRequest): Promise<void> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'x-trace-id': (req as FastifyRequest & { traceId?: string }).traceId ?? '',
  });
  reply.raw.write(': ok\n\n');
  const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);
  try {
    for await (const ev of events) {
      const { event, ...data } = ev;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      if (event === 'done') break;
    }
  } finally {
    clearInterval(heartbeat);
    reply.raw.end();
  }
}
