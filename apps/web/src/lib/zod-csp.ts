import { config } from 'zod/v4/core';

/**
 * S11 – CSP nghiêm (không `'unsafe-eval'`): Zod 4 thử `new Function("")` để bật JIT khi parse object; với CSP của web phép thử bị
 * chặn và trình duyệt báo `securitypolicyviolation` + lỗi console dù Zod đã bắt ngoại lệ. `jitless` bỏ phép thử (parse thường).
 * Nạp ở QueryProvider (layout gốc) – trước mọi lần parse; chỉ kéo hàm `config` (zod `sideEffects: false`).
 */
config({ jitless: true });
