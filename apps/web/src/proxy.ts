import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/**
 * Next 16: tệp `proxy.ts` thay cho `middleware.ts`. Chỉ xử lý chọn locale (vi mặc định, en);
 * kiểm tra phiên đăng nhập làm ở client (AuthGate) vì cookie httpOnly do API ở origin khác đặt.
 */
export default createMiddleware(routing);

export const config = {
  matcher: ['/((?!api|_next|_vercel|sw\\.js|manifest\\.webmanifest|icons|demo-audio|.*\\..*).*)'],
};
