import { applyDecorators, createParamDecorator, type ExecutionContext, type PipeTransform } from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { z, type ZodType } from 'zod';
import { ValidationFailed } from './errors.js';

/** Pipe validate bằng Zod (CLAUDE.md §3: nestjs-zod hoặc pipe tự viết) */
export class ZodValidationPipe<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (!r.success) {
      throw new ValidationFailed({ issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })) });
    }
    return r.data;
  }
}

/** JSON Schema cho Swagger từ Zod (Zod 4 có sẵn toJSONSchema) */
export function zodToOpenApi(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function zodToOpenApiOutput(schema: ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any', io: 'output' }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

/** Body validate + metadata OpenAPI */
export const ZodBody = (schema: ZodType) => createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ body: unknown }>().body)(new ZodValidationPipe(schema));
export const ZodQuery = (schema: ZodType) => createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ query: unknown }>().query)(new ZodValidationPipe(schema));
/**
 * Path params validate bằng Zod. S12 (S125/F10): đồng thời khai báo `parameters` (in: path) cho OpenAPI sinh từ Nest – trước đây
 * route dùng @ZodParams thiếu khai báo nên ZAP/Schemathesis cảnh báo. Decorator tham số chạy trước decorator phương thức; metadata
 * gắn lên chính hàm handler (descriptor.value) nên Swagger đọc được như @ApiParam.
 */
export const ZodParams =
  (schema: ZodType): ParameterDecorator =>
  (target, key, index) => {
    createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<{ params: unknown }>().params)(new ZodValidationPipe(schema))(target, key, index);
    if (key === undefined) return;
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) return;
    const json = zodToOpenApi(schema) as { properties?: Record<string, Record<string, unknown>> };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      ApiParam({ name, required: true, schema: prop })(target, key, descriptor);
    }
  };

/** Gắn mô tả body/response vào Swagger (dùng kèm ZodBody/ZodQuery) */
export function ApiZod(opts: { body?: ZodType; query?: ZodType; responses?: Record<number, ZodType | 'empty' | 'sse'>; description?: string }) {
  const decorators: Array<MethodDecorator | ClassDecorator | PropertyDecorator> = [];
  if (opts.body) decorators.push(ApiBody({ schema: zodToOpenApi(opts.body) as never }));
  if (opts.query) {
    const json = zodToOpenApi(opts.query) as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      decorators.push(ApiQuery({ name, required: json.required?.includes(name) ?? false, schema: prop as never }));
    }
  }
  for (const [status, s] of Object.entries(opts.responses ?? {})) {
    if (s === 'empty') decorators.push(ApiResponse({ status: Number(status) }));
    else if (s === 'sse') decorators.push(ApiResponse({ status: Number(status), content: { 'text/event-stream': { schema: { type: 'string' } } } }));
    else decorators.push(ApiResponse({ status: Number(status), schema: zodToOpenApiOutput(s) }));
  }
  return applyDecorators(...(decorators as MethodDecorator[]));
}

export const uuidParam = z.object({ id: z.uuid() });
