import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AiStreamEvent } from '@allingo/schemas';

/** Ghi luồng SSE: `event: <tên>` + `data: <json>` theo chuẩn text/event-stream; heartbeat 15 s; dừng ở `done` */
/**
 * Header đã đặt trên reply bởi hook (CORS `access-control-allow-*`, helmet, set-cookie…) – phải chép sang `raw.writeHead`,
 * nếu không trình duyệt chặn luồng SSE cross-origin (web :3000 → api :4000). Bỏ các header mô tả thân phản hồi.
 */
export function inheritedHeaders(reply: FastifyReply): Record<string, string | number | string[]> {
  const out: Record<string, string | number | string[]> = {};
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v === undefined) continue;
    const key = k.toLowerCase();
    if (key === 'content-type' || key === 'content-length' || key === 'transfer-encoding') continue;
    out[k] = v;
  }
  return out;
}

export async function writeSse(reply: FastifyReply, events: AsyncIterable<AiStreamEvent>, req: FastifyRequest): Promise<void> {
  // Tự ghi raw stream → báo Fastify không gửi phản hồi nữa
  reply.hijack();
  reply.raw.writeHead(200, {
    ...inheritedHeaders(reply),
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
