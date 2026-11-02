/**
 * Dựng ảnh OG tĩnh cho trang chia sẻ referral: public/og/referral.png (1200×630) – HTML/SVG tự thiết kế (navy + vàng của
 * thương hiệu), chụp bằng Chromium của Playwright (đã có trong devDependencies). Chạy: `node scripts/build-og.mjs`
 * (E2E_CHROME_CHANNEL=chrome để dùng Google Chrome cài sẵn). Ảnh được commit; chỉ chạy lại khi đổi thiết kế.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/og/referral.png');
mkdirSync(dirname(out), { recursive: true });

const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1200px;height:630px;overflow:hidden;font-family:Inter,'DejaVu Sans',system-ui,sans-serif;background:#0B1F4B;color:#fff;position:relative}
  .glow{position:absolute;border-radius:50%;filter:blur(2px)}
  .g1{width:520px;height:520px;right:-140px;top:-160px;background:radial-gradient(circle,#0B3BA7 0%,rgba(11,59,167,0) 70%)}
  .g2{width:420px;height:420px;left:-120px;bottom:-200px;background:radial-gradient(circle,rgba(230,179,37,.35) 0%,rgba(230,179,37,0) 70%)}
  .wrap{position:absolute;inset:0;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between}
  .brand{display:flex;align-items:center;gap:18px;font-size:40px;font-weight:800;letter-spacing:-.5px}
  .brand small{display:block;font-size:20px;font-weight:500;color:#C9D3EA;letter-spacing:0;margin-top:4px}
  h1{font-size:66px;line-height:1.08;font-weight:800;letter-spacing:-1.5px;max-width:760px}
  h1 em{font-style:normal;color:#E6B325}
  .sub{margin-top:22px;font-size:28px;color:#DDE4F4;max-width:720px;line-height:1.35}
  .row{display:flex;align-items:center;justify-content:space-between}
  .chips{display:flex;gap:14px}
  .chip{border:2px solid rgba(255,255,255,.28);border-radius:999px;padding:10px 22px;font-size:24px;font-weight:700;letter-spacing:1px}
  .credit{display:flex;align-items:center;gap:14px;background:#E6B325;color:#1B1500;border-radius:20px;padding:16px 28px;font-size:30px;font-weight:800}
  .gift{position:absolute;right:92px;top:150px}
</style></head><body>
  <div class="glow g1"></div><div class="glow g2"></div>
  <svg class="gift" width="250" height="250" viewBox="0 0 64 64" aria-hidden="true">
    <rect x="8" y="26" width="48" height="32" rx="5" fill="#0B3BA7" stroke="#E6B325" stroke-width="2.5"/>
    <rect x="5" y="18" width="54" height="11" rx="4" fill="#E6B325"/>
    <rect x="29" y="18" width="6" height="40" fill="#E6B325"/>
    <path d="M32 18c-4-9-15-10-15-3 0 4 7 3 15 3zm0 0c4-9 15-10 15-3 0 4-7 3-15 3z" fill="none" stroke="#E6B325" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="50" cy="10" r="2.2" fill="#fff"/><circle cx="12" cy="9" r="1.6" fill="#fff"/><circle cx="58" cy="30" r="1.4" fill="#fff"/>
  </svg>
  <div class="wrap">
    <div class="brand">
      <svg width="64" height="64" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#fff" fill-opacity=".08"/><path d="M8 24 L16 8 L24 24" fill="none" stroke="#E6B325" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M11.5 18.5 H20.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>
      <div>Allingo<small>Ngoại ngữ cho tất cả</small></div>
    </div>
    <div>
      <h1>Bạn được mời luyện thi <em>cùng AI</em></h1>
      <p class="sub">Đề đúng định dạng, AI giải thích song ngữ từng câu, lộ trình tới ngày thi.</p>
    </div>
    <div class="row">
      <div class="chips"><span class="chip">TOEIC</span><span class="chip">IELTS</span><span class="chip">JLPT</span><span class="chip">HSK</span></div>
      <div class="credit">🎁 Nhận credit AI miễn phí</div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: process.env.E2E_CHROME_CHANNEL || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: out, type: 'png' });
  console.log(`OG image → ${out}`);
} finally {
  await browser.close();
}
