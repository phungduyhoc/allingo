/**
 * pnpm --filter @allingo/api push:vapid — sinh cặp khoá VAPID cho Web Push (dev). In ra dạng biến môi trường để dán vào `.env`
 * cục bộ (KHÔNG commit). Staging/production: sinh một lần, lưu Key Vault, không đổi (đổi khoá làm mất mọi đăng ký cũ).
 */
import { generateVapidKeys } from '../src/modules/growth/push/push-sender.js';

const k = generateVapidKeys();
process.stdout.write(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:dev@allingo.vn\n`);
