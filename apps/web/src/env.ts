import { z } from 'zod';

/**
 * Biến môi trường public của web (NEXT_PUBLIC_*). Validate bằng Zod lúc nạp module;
 * Next inline giá trị tại build nên phải đọc từng biến tường minh (không dùng process.env[key]).
 */
const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url().default('http://localhost:4000/v1'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_DEFAULT_LOCALE: z.enum(['vi', 'en']).default('vi'),
  /** '1' → dùng fetch giả lập (src/mock) thay cho API thật; mặc định tắt */
  NEXT_PUBLIC_API_MOCK: z.enum(['0', '1']).default('0'),
});

const parsed = envSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEFAULT_LOCALE: process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
  NEXT_PUBLIC_API_MOCK: process.env.NEXT_PUBLIC_API_MOCK,
});

if (!parsed.success) {
  throw new Error(`Invalid NEXT_PUBLIC_* environment: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
}

export const env = {
  apiUrl: parsed.data.NEXT_PUBLIC_API_URL.replace(/\/$/, ''),
  appUrl: parsed.data.NEXT_PUBLIC_APP_URL.replace(/\/$/, ''),
  defaultLocale: parsed.data.NEXT_PUBLIC_DEFAULT_LOCALE,
  apiMock: parsed.data.NEXT_PUBLIC_API_MOCK === '1',
} as const;
