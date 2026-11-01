import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FS_ROUTE_PREFIX, verifyFsRequest, type FsMethod, type FsStorageDriver } from './fs.driver.js';
import { baseMime, type Bucket } from './storage.types.js';

type Req = FastifyRequest<{ Params: { bucket: string; '*': string }; Querystring: Record<string, unknown> }> & { traceId?: string };

/** Envelope lỗi chuẩn (CLAUDE.md §6) cho route fastify thuần (ngoài Nest exception filter) */
function sendError(req: Req, reply: FastifyReply, status: number, code: string, message: string, details?: Record<string, unknown>) {
  return reply.status(status).header('content-type', 'application/json; charset=utf-8').send({ error: { code, message, details: details ?? null, trace_id: req.traceId ?? null } });
}

function verify(driver: FsStorageDriver, req: Req, reply: FastifyReply, method: FsMethod) {
  const r = verifyFsRequest(driver.signingKey, { method, bucket: req.params.bucket, objectKey: req.params['*'], query: req.query });
  if (!r.ok) {
    // Không phân biệt lý do chi tiết ra ngoài ngoài 'expired' (giúp client xin URL mới)
    void sendError(req, reply, 403, 'forbidden', r.reason === 'expired' ? 'Signed URL expired' : 'Invalid signed URL', { reason: r.reason === 'expired' ? 'expired' : 'invalid' });
    return null;
  }
  return r.params;
}

/** Range "bytes=a-b" đơn (đủ cho thẻ <audio>); null = không có/không hợp lệ */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

/**
 * Route nội bộ cho driver fs (dev/test, ADR-0025): mô phỏng PUT/GET presigned của S3.
 * Chỉ đăng ký khi STORAGE_DRIVER = fs; nằm trong context fastify riêng (parser nhị phân, bodyLimit riêng),
 * không qua Nest (không AuthGuard – quyền nằm trong chữ ký HMAC + hạn), không xuất hiện trong OpenAPI.
 */
export async function registerFsStorageRoutes(fastify: FastifyInstance, driver: FsStorageDriver, opts: { maxBodyBytes: number }): Promise<void> {
  await fastify.register(async (instance) => {
    instance.removeAllContentTypeParsers();
    instance.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: opts.maxBodyBytes }, (_req, body, done) => done(null, body));
    instance.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
      const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
      const code = status === 413 ? 'validation_failed' : status < 500 ? 'validation_failed' : 'internal';
      return sendError(req as Req, reply, status, code, status === 413 ? 'Payload too large' : status < 500 ? 'Bad request' : 'Internal error');
    });

    instance.route({
      method: 'PUT',
      url: `${FS_ROUTE_PREFIX}/:bucket/*`,
      bodyLimit: opts.maxBodyBytes,
      handler: async (request, reply) => {
        const req = request as Req;
        const params = verify(driver, req, reply, 'PUT');
        if (!params) return reply;
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) return sendError(req, reply, 400, 'validation_failed', 'Empty body');
        const sent = baseMime(req.headers['content-type']);
        if (params.contentType !== undefined && sent !== baseMime(params.contentType)) {
          return sendError(req, reply, 403, 'forbidden', 'Content-Type does not match signed URL', { expected: baseMime(params.contentType) });
        }
        if (params.maxBytes !== undefined && body.length > params.maxBytes) {
          return sendError(req, reply, 413, 'validation_failed', 'Payload exceeds declared size', { max_bytes: params.maxBytes });
        }
        await driver.putObject(params.bucket, params.key, body, { contentType: params.contentType ?? (sent || 'application/octet-stream') });
        const head = await driver.headObject(params.bucket, params.key);
        return reply.status(200).header('etag', `"${head?.etag ?? ''}"`).send();
      },
    });

    instance.route({
      method: 'GET',
      url: `${FS_ROUTE_PREFIX}/:bucket/*`,
      handler: async (request, reply) => {
        const req = request as Req;
        const params = verify(driver, req, reply, 'GET');
        if (!params) return reply;
        const bucket: Bucket = params.bucket;
        const head = await driver.headObject(bucket, params.key);
        if (!head) return sendError(req, reply, 404, 'not_found', 'Object not found');
        const maxAge = Math.max(0, params.exp - Math.floor(Date.now() / 1000));
        // SVG (ảnh nội dung Sprint 4): chặn script nếu mở trực tiếp URL (đã kiểm tra khi xử lý, đây là lớp phòng thủ thêm)
        if (baseMime(head.contentType) === 'image/svg+xml') reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:").header('x-content-type-options', 'nosniff');
        reply
          .header('content-type', head.contentType ?? 'application/octet-stream')
          .header('accept-ranges', 'bytes')
          .header('cache-control', `private, max-age=${maxAge}`)
          .header('etag', `"${head.etag ?? ''}"`);
        const range = parseRange(req.headers.range, head.size);
        if (range === 'invalid') return reply.status(416).header('content-range', `bytes */${head.size}`).send();
        if (range) {
          reply.status(206).header('content-range', `bytes ${range.start}-${range.end}/${head.size}`).header('content-length', String(range.end - range.start + 1));
          return reply.send(driver.createRangeStream(bucket, params.key, range.start, range.end));
        }
        reply.status(200).header('content-length', String(head.size));
        return reply.send(await driver.getObject(bucket, params.key));
      },
    });
  });
}
