import { describe, expect, it } from 'vitest';
import { buildCsp, generateNonce, nonceFromCsp, originOf, parseOriginList, sentryCspTargets, staticSecurityHeaders, wsOriginOf } from './csp';

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => [d.split(' ')[0]!, d.split(' ').slice(1)]));

describe('CSP nghiêm có nonce (S11)', () => {
  it('nonce ngẫu nhiên 128 bit base64, mỗi lần khác nhau', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
    expect(new Set(Array.from({ length: 200 }, generateNonce)).size).toBe(200);
  });

  it('production: script-src chỉ nonce + strict-dynamic (không unsafe-inline/eval), chặn khung/base/object', () => {
    const nonce = generateNonce();
    const csp = buildCsp({ nonce, dev: false, apiUrl: 'https://api.allingo.vn/v1', appUrl: 'https://allingo.vn', mediaOrigins: ['https://media.allingo.vn'], cmsUrl: 'https://cms.allingo.vn', upgradeInsecure: true });
    const d = directives(csp);
    expect(d['script-src']).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(csp).not.toContain("'unsafe-eval'");
    expect(d['script-src']).not.toContain("'unsafe-inline'");
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['default-src']).toEqual(["'self'"]);
    // API: REST + SSE + Socket.IO (wss), media ký URL trên origin API + origin lưu trữ; ảnh CMS
    expect(d['connect-src']).toEqual(expect.arrayContaining(["'self'", 'https://api.allingo.vn', 'wss://api.allingo.vn', 'https://media.allingo.vn']));
    expect(d['img-src']).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:', 'https://api.allingo.vn', 'https://cms.allingo.vn', 'https://media.allingo.vn']));
    expect(d['media-src']).toEqual(expect.arrayContaining(["'self'", 'blob:', 'https://api.allingo.vn', 'https://media.allingo.vn']));
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['worker-src']).toEqual(["'self'", 'blob:']);
    expect(csp).toContain('upgrade-insecure-requests');
    expect(nonceFromCsp(csp)).toBe(nonce);
  });

  it('dev: unsafe-eval (React) + WebSocket HMR + frame-ancestors self (iframe làm nóng trang offline); không upgrade', () => {
    const d = directives(buildCsp({ nonce: 'AAAAAAAAAAAAAAAAAAAAAA==', dev: true, apiUrl: 'http://localhost:4000/v1', appUrl: 'http://localhost:3000' }));
    expect(d['script-src']).toContain("'unsafe-eval'");
    expect(d['connect-src']).toEqual(expect.arrayContaining(['http://localhost:4000', 'ws://localhost:4000', 'ws://localhost:3000']));
    expect(d['frame-ancestors']).toEqual(["'self'"]);
    expect(d['upgrade-insecure-requests']).toBeUndefined();
  });

  it('Sentry: connect-src ingest + report-uri endpoint security; Google Sign-In: khung/style/connect GIS; form-action cổng', () => {
    const csp = buildCsp({
      nonce: 'BBBBBBBBBBBBBBBBBBBBBB==',
      dev: false,
      apiUrl: 'https://api.allingo.vn/v1',
      sentryDsn: 'https://pubkey123@o42.ingest.sentry.io/4507',
      google: true,
      formActionOrigins: ['https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'],
    });
    const d = directives(csp);
    expect(d['connect-src']).toContain('https://o42.ingest.sentry.io');
    expect(d['report-uri']).toEqual(['https://o42.ingest.sentry.io/api/4507/security/?sentry_key=pubkey123']);
    expect(d['frame-src']).toContain('https://accounts.google.com/gsi/');
    expect(d['style-src']).toContain('https://accounts.google.com/gsi/style');
    expect(d['form-action']).toEqual(["'self'", 'https://sandbox.vnpayment.vn']);
  });

  it('nonce sai định dạng → lỗi (không chèn được chỉ thị qua nonce)', () => {
    expect(() => buildCsp({ nonce: "x'; script-src *", dev: false, apiUrl: 'https://api.allingo.vn/v1' })).toThrow();
    expect(() => buildCsp({ nonce: 'short', dev: false, apiUrl: 'https://api.allingo.vn/v1' })).toThrow();
  });

  it('origin: bỏ path/query, URL sai/giao thức lạ bị loại; danh sách từ env', () => {
    expect(originOf('https://api.allingo.vn/v1?x=1')).toBe('https://api.allingo.vn');
    expect(originOf('javascript:alert(1)')).toBeNull();
    expect(originOf('not a url')).toBeNull();
    expect(wsOriginOf('https://a.b')).toBe('wss://a.b');
    expect(parseOriginList('https://a.example/x, http://localhost:9000 ,bad, javascript:1')).toEqual(['https://a.example', 'http://localhost:9000']);
    expect(sentryCspTargets('https://key@self.host/sentry/12')).toEqual({ origin: 'https://self.host', reportUri: 'https://self.host/sentry/api/12/security/?sentry_key=key' });
    expect(sentryCspTargets('https://self.host/12')).toBeNull();
  });

  it('header tĩnh: HSTS chỉ production; chặn nhúng khung, sniff MIME', () => {
    const prod = Object.fromEntries(staticSecurityHeaders({ production: true }).map((h) => [h.key, h.value]));
    expect(prod['Strict-Transport-Security']).toMatch(/max-age=\d{8,}; includeSubDomains/);
    expect(prod['X-Frame-Options']).toBe('DENY');
    expect(prod['X-Content-Type-Options']).toBe('nosniff');
    expect(prod['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    const dev = Object.fromEntries(staticSecurityHeaders({ production: false }).map((h) => [h.key, h.value]));
    expect(dev['Strict-Transport-Security']).toBeUndefined();
    expect(dev['X-Frame-Options']).toBe('SAMEORIGIN');
  });
});
