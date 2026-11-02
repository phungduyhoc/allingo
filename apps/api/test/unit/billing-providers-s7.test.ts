import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hmacHex } from '../../src/modules/billing/payments/crypto.js';
import { decodeMerchantRef, encodeMerchantRef, MERCHANT_REF_LENGTH } from '../../src/modules/billing/payments/merchant-ref.js';
import { MockPaymentProvider, signMockWebhook } from '../../src/modules/billing/payments/mock.provider.js';
import { MOMO_CREATE_FIELDS, MOMO_IPN_FIELDS, MomoProvider, momoRaw, momoStatus } from '../../src/modules/billing/payments/momo.provider.js';
import { asciiDescription, type CreatePaymentInput, type HttpClient } from '../../src/modules/billing/payments/payment-provider.js';
import { VnpayProvider, vnpaySign, vnpaySignData, vnpayStatus } from '../../src/modules/billing/payments/vnpay.provider.js';
import { ZalopayProvider, refFromAppTransId } from '../../src/modules/billing/payments/zalopay.provider.js';

/**
 * Sprint 7 – chữ ký 3 cổng bằng VECTOR TỰ TẠO (test/fixtures/payments/vectors.json): chuỗi canonical viết tay theo tài liệu
 * cổng + HMAC tính độc lập bằng `openssl dgst`. KHÔNG phải kết quả chạy sandbox thật (phiên không có credential/mạng).
 */
const V = JSON.parse(readFileSync(new URL('../fixtures/payments/vectors.json', import.meta.url), 'utf8')) as {
  order_id: string;
  merchant_ref: string;
  vnpay: Record<string, string>;
  momo: Record<string, string>;
  zalopay: Record<string, string>;
};
const REF = V.merchant_ref;

type Captured = { url: string; body?: string; headers: Record<string, string> };
function fakeHttp(responses: Array<Record<string, unknown> | ((req: Captured) => Record<string, unknown>)>, status = 200): { client: HttpClient; calls: Captured[] } {
  const calls: Captured[] = [];
  const client: HttpClient = async (url, init) => {
    const req = { url, body: init.body, headers: init.headers };
    calls.push(req);
    const r = responses.shift() ?? {};
    const json = typeof r === 'function' ? r(req) : r;
    return { status, text: async () => JSON.stringify(json) };
  };
  return { client, calls };
}

const baseInput = (provider: 'vnpay' | 'momo' | 'zalopay', createdAt: Date): CreatePaymentInput => ({
  merchantRef: REF,
  orderId: V.order_id,
  amount: 199_000,
  currency: 'VND',
  description: 'Allingo toeic_pro_monthly abc123',
  returnUrl: `https://api.allingo.test/v1/payments/return/${provider}`,
  ipnUrl: `https://api.allingo.test/v1/webhooks/payments/${provider}`,
  ipAddress: '127.0.0.1',
  locale: 'vi',
  createdAt,
  expiresAt: new Date(createdAt.getTime() + 30 * 60_000),
  userRef: V.zalopay.app_user!,
});

describe('merchant ref', () => {
  it('order_id ↔ mã tham chiếu 31 ký tự [0-9a-z] (vector), nonce khác nhau mỗi lần; sai định dạng → null', () => {
    expect(encodeMerchantRef(V.order_id, 'abc123')).toBe(REF);
    expect(REF).toHaveLength(MERCHANT_REF_LENGTH);
    expect(decodeMerchantRef(REF)).toBe(V.order_id);
    const a = encodeMerchantRef(V.order_id);
    const b = encodeMerchantRef(V.order_id);
    expect(a).not.toBe(b);
    expect(decodeMerchantRef(a)).toBe(V.order_id);
    expect(decodeMerchantRef('xyz')).toBeNull();
    expect(decodeMerchantRef(`${'z'.repeat(25)}abc123`)).toBeNull(); // > 128 bit
    expect(decodeMerchantRef(REF.toUpperCase())).toBeNull();
  });
});

describe('VNPay 2.1.0', () => {
  const vnpay = (http: HttpClient = fakeHttp([]).client) => new VnpayProvider({ tmnCode: V.vnpay.tmn_code, hashSecret: V.vnpay.hash_secret, payUrl: 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html', apiUrl: 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction', timeoutMs: 1000 }, () => http);
  const created = new Date('2026-11-02T10:15:00+07:00');

  it('URL thanh toán: chuỗi ký sắp xếp + encodeURIComponent (%20→+) và vnp_SecureHash HMAC-SHA512 khớp vector; vnp_Amount = VND × 100', () => {
    const p = vnpay().buildPayParams(baseInput('vnpay', created));
    expect(p.vnp_Amount).toBe('19900000');
    expect(p.vnp_CreateDate).toBe('20261102101500');
    expect(p.vnp_ExpireDate).toBe('20261102103000'); // ≤ 15 phút dù đơn còn 30 phút
    expect(vnpaySignData(p)).toBe(V.vnpay.pay_canonical);
    expect(p.vnp_SecureHash).toBe(V.vnpay.pay_hash);
  });

  it('createPayment trả redirect_url sandbox có đủ tham số và chữ ký kiểm lại được', async () => {
    const r = await vnpay().createPayment(baseInput('vnpay', created));
    expect(r.method).toBe('redirect');
    const u = new URL(r.redirectUrl!);
    expect(u.origin + u.pathname).toBe('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html');
    const q = Object.fromEntries(u.searchParams);
    expect(q.vnp_TxnRef).toBe(REF);
    expect(q.vnp_SecureHash).toBe(V.vnpay.pay_hash);
    expect(vnpaySign(V.vnpay.hash_secret!, q)).toBe(V.vnpay.pay_hash);
    expect(r.meta).toMatchObject({ create_date: '20261102101500' });
  });

  const ipn = (over: Record<string, string> = {}) => ({
    vnp_Amount: '19900000',
    vnp_BankCode: 'NCB',
    vnp_BankTranNo: 'VNP14226112',
    vnp_CardType: 'ATM',
    vnp_OrderInfo: 'Allingo toeic_pro_monthly abc123',
    vnp_PayDate: '20261102101800',
    vnp_ResponseCode: '00',
    vnp_TmnCode: 'ALLINGO1',
    vnp_TransactionNo: '14226112',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: REF,
    vnp_SecureHashType: 'HmacSHA512',
    vnp_SecureHash: V.vnpay.ipn_hash!,
    ...over,
  });

  it('IPN: chữ ký vector hợp lệ (bỏ SecureHash/SecureHashType, so không phân biệt hoa thường) → paid, số tiền ÷ 100, mã GD = vnp_TransactionNo', () => {
    const p = vnpay();
    const q = ipn({ vnp_SecureHash: V.vnpay.ipn_hash!.toUpperCase() });
    expect(vnpaySignData(q)).toBe(V.vnpay.ipn_canonical);
    expect(p.verifyWebhook({ method: 'GET', query: q, body: null, headers: {} })).toBe(true);
    const parsed = p.parseWebhook({ method: 'GET', query: q, body: null, headers: {} });
    expect(parsed).toMatchObject({ merchantRef: REF, providerTxnId: '14226112', amount: 199_000, status: 'paid', currency: 'VND' });
    expect(parsed.paidAt?.toISOString()).toBe('2026-11-02T03:18:00.000Z');
  });

  it('IPN: sửa số tiền / TmnCode khác / thiếu hash → sai chữ ký; ack 97 kèm HTTP 400; ack đúng mã 00/01/02/04', () => {
    const p = vnpay();
    expect(p.verifyWebhook({ method: 'GET', query: ipn({ vnp_Amount: '100' }), body: null, headers: {} })).toBe(false);
    expect(p.verifyWebhook({ method: 'GET', query: ipn({ vnp_TmnCode: 'OTHER' }), body: null, headers: {} })).toBe(false);
    expect(p.verifyWebhook({ method: 'GET', query: ipn({ vnp_SecureHash: '' }), body: null, headers: {} })).toBe(false);
    expect(p.ack('invalid_signature')).toEqual({ status: 400, body: { RspCode: '97', Message: 'Invalid Checksum' } });
    expect((p.ack('ok').body as { RspCode: string }).RspCode).toBe('00');
    expect((p.ack('order_not_found').body as { RspCode: string }).RspCode).toBe('01');
    expect((p.ack('duplicate').body as { RspCode: string }).RspCode).toBe('02');
    expect((p.ack('amount_mismatch').body as { RspCode: string }).RspCode).toBe('04');
    // vnp_Amount không chia hết 100 → NaN (coi là lệch số tiền)
    expect(Number.isNaN(p.parseWebhook({ method: 'GET', query: ipn({ vnp_Amount: '19900050' }), body: null, headers: {} }).amount)).toBe(true);
  });

  it('mã trạng thái: 00/00 paid · 24 cancelled · TransactionStatus 01 pending · khác failed', () => {
    expect(vnpayStatus('00', '00')).toBe('paid');
    expect(vnpayStatus('24', '02')).toBe('cancelled');
    expect(vnpayStatus('99', '01')).toBe('pending');
    expect(vnpayStatus('51', '02')).toBe('failed');
  });

  it('querydr: chữ ký yêu cầu nối "|" khớp vector; phản hồi ký đúng → paid, ký sai → lỗi', async () => {
    const p = vnpay();
    const body = p.buildQueryBody({ merchantRef: REF, createdAt: created, amount: 199_000, init: { create_date: '20261102101500' } }, new Date('2026-11-02T12:00:00+07:00'), 'req00000000000000000000000000001');
    expect(body.vnp_SecureHash).toBe(V.vnpay.querydr_hash);
    expect(hmacHex('sha512', V.vnpay.hash_secret!, V.vnpay.querydr_data!)).toBe(V.vnpay.querydr_hash);
    const resp: Record<string, string> = { vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: '00', vnp_Message: 'QueryDR Success', vnp_TmnCode: 'ALLINGO1', vnp_TxnRef: REF, vnp_Amount: '19900000', vnp_BankCode: 'NCB', vnp_PayDate: '20261102101800', vnp_TransactionNo: '14226112', vnp_TransactionType: '01', vnp_TransactionStatus: '00', vnp_OrderInfo: 'x', vnp_PromotionCode: '', vnp_PromotionAmount: '' };
    resp.vnp_SecureHash = p.querySignature(resp);
    const { client, calls } = fakeHttp([resp]);
    const r = await vnpay(client).queryStatus({ merchantRef: REF, createdAt: created, amount: 199_000, init: { create_date: '20261102101500' } });
    expect(r).toMatchObject({ status: 'paid', providerTxnId: '14226112', amount: 199_000 });
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ vnp_Command: 'querydr', vnp_TxnRef: REF, vnp_TransactionDate: '20261102101500' });
    const bad = fakeHttp([{ ...resp, vnp_SecureHash: 'deadbeef' }]);
    await expect(vnpay(bad.client).queryStatus({ merchantRef: REF, createdAt: created, amount: 199_000 })).rejects.toThrow(/signature/);
    expect(await vnpay(fakeHttp([{ vnp_ResponseCode: '91' }]).client).queryStatus({ merchantRef: REF, createdAt: created, amount: 1 })).toBeNull();
  });

  it('thiếu credential → unavailable', () => {
    expect(new VnpayProvider({ payUrl: 'x', apiUrl: 'y', timeoutMs: 1 }, () => fakeHttp([]).client).available()).toBe(false);
  });
});

describe('MoMo AIO v2', () => {
  const created = new Date(1793600100000);
  const momo = (http: HttpClient = fakeHttp([]).client) => new MomoProvider({ partnerCode: V.momo.partner_code, accessKey: V.momo.access_key, secretKey: V.momo.secret_key, endpoint: 'https://test-payment.momo.vn', requestType: 'captureWallet', timeoutMs: 1000 }, () => http);

  it('create: chuỗi raw theo thứ tự trường tài liệu + HMAC-SHA256 khớp vector; gửi JSON tới /v2/gateway/api/create; trả payUrl/deeplink/QR', async () => {
    const body = momo().buildCreateBody(baseInput('momo', created));
    expect(momoRaw(MOMO_CREATE_FIELDS, { ...body, accessKey: V.momo.access_key })).toBe(V.momo.create_raw);
    expect(body.signature).toBe(V.momo.create_signature);
    expect(body).toMatchObject({ amount: 199_000, orderId: REF, requestId: V.momo.request_id, orderExpireTime: 30 });
    const { client, calls } = fakeHttp([{ resultCode: 0, payUrl: 'https://test-payment.momo.vn/pay?t=1', deeplink: 'momo://pay?t=1', qrCodeUrl: '00020101…' }]);
    const r = await momo(client).createPayment(baseInput('momo', created));
    expect(calls[0]!.url).toBe('https://test-payment.momo.vn/v2/gateway/api/create');
    expect(r).toMatchObject({ method: 'redirect', redirectUrl: 'https://test-payment.momo.vn/pay?t=1', deeplink: 'momo://pay?t=1', qrCode: '00020101…' });
  });

  it('create: resultCode ≠ 0 → PaymentProviderError (controller trả 502 payment_failed)', async () => {
    await expect(momo(fakeHttp([{ resultCode: 22, message: 'amount invalid' }]).client).createPayment(baseInput('momo', created))).rejects.toMatchObject({ provider: 'momo', providerCode: '22' });
  });

  const ipnBody = (over: Record<string, unknown> = {}) => ({ partnerCode: 'ALLINGOTEST', orderId: REF, requestId: V.momo.request_id, amount: 199000, orderInfo: 'Allingo toeic_pro_monthly abc123', orderType: 'momo_wallet', transId: 4088878653, resultCode: 0, message: 'Successful.', payType: 'qr', responseTime: 1793600200000, extraData: '', signature: V.momo.ipn_signature, ...over });

  it('IPN: chữ ký vector hợp lệ → paid, transId; sửa amount/resultCode → sai chữ ký; ack 204 / 400', () => {
    const p = momo();
    expect(momoRaw(MOMO_IPN_FIELDS, { ...ipnBody(), accessKey: V.momo.access_key })).toBe(V.momo.ipn_raw);
    expect(p.verifyWebhook({ method: 'POST', query: {}, body: ipnBody(), headers: {} })).toBe(true);
    expect(p.parseWebhook({ method: 'POST', query: {}, body: ipnBody(), headers: {} })).toMatchObject({ merchantRef: REF, providerTxnId: '4088878653', amount: 199_000, status: 'paid' });
    expect(p.verifyWebhook({ method: 'POST', query: {}, body: ipnBody({ amount: 1000 }), headers: {} })).toBe(false);
    expect(p.verifyWebhook({ method: 'POST', query: {}, body: ipnBody({ resultCode: 1006 }), headers: {} })).toBe(false);
    expect(p.verifyWebhook({ method: 'POST', query: {}, body: ipnBody({ partnerCode: 'X' }), headers: {} })).toBe(false);
    expect(p.ack('ok')).toEqual({ status: 204, body: null });
    expect(p.ack('invalid_signature').status).toBe(400);
    expect(p.ack('error').status).toBe(500);
  });

  it('resultCode: 0 paid · 1006 cancelled · 1000/7000 pending · khác failed; query ký đúng vector', async () => {
    expect(momoStatus(0)).toBe('paid');
    expect(momoStatus(1006)).toBe('cancelled');
    expect(momoStatus(1000)).toBe('pending');
    expect(momoStatus(1005)).toBe('failed');
    const q = momo().buildQueryBody(REF, `${REF}-q1793600300000`);
    expect(q.signature).toBe(V.momo.query_signature);
    const { client } = fakeHttp([{ orderId: REF, amount: 199000, transId: 4088878653, resultCode: 0, message: 'ok' }]);
    expect(await momo(client).queryStatus({ merchantRef: REF, createdAt: created, amount: 199_000 })).toMatchObject({ status: 'paid', providerTxnId: '4088878653' });
  });
});

describe('ZaloPay v2', () => {
  const created = new Date(1793600100000);
  const zp = (http: HttpClient = fakeHttp([]).client) => new ZalopayProvider({ appId: V.zalopay.app_id, key1: V.zalopay.key1, key2: V.zalopay.key2, endpoint: 'https://sb-openapi.zalopay.vn', timeoutMs: 1000 }, () => http);

  it('create: app_trans_id = yymmdd(GMT+7)_ref ≤ 40 ký tự; mac key1 khớp vector; gửi form tới /v2/create', async () => {
    const p = zp().buildCreateParams({ ...baseInput('zalopay', created), returnUrl: 'https://api.allingo.test/v1/payments/return/zalopay' });
    expect(p.app_trans_id).toBe(`261102_${REF}`);
    expect(p.app_trans_id!.length).toBeLessThanOrEqual(40);
    expect([p.app_id, p.app_trans_id, p.app_user, p.amount, p.app_time, p.embed_data, p.item].join('|')).toBe(V.zalopay.create_data);
    expect(p.mac).toBe(V.zalopay.create_mac);
    const { client, calls } = fakeHttp([{ return_code: 1, order_url: 'https://qcgateway.zalopay.vn/openinapp?order=1', qr_code: '000201…' }]);
    const r = await zp(client).createPayment({ ...baseInput('zalopay', created), returnUrl: 'https://api.allingo.test/v1/payments/return/zalopay' });
    expect(calls[0]!.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(calls[0]!.body).get('mac')).toBe(V.zalopay.create_mac);
    expect(r).toMatchObject({ redirectUrl: 'https://qcgateway.zalopay.vn/openinapp?order=1', qrCode: '000201…' });
  });

  it('callback: mac = HMAC-SHA256(key2, data) khớp vector → paid, zp_trans_id; mac sai → -1 HTTP 400; trùng → return_code 2', () => {
    const p = zp();
    const body = { data: V.zalopay.callback_data, mac: V.zalopay.callback_mac, type: 1 };
    expect(p.verifyWebhook({ method: 'POST', query: {}, body, headers: {} })).toBe(true);
    expect(p.parseWebhook({ method: 'POST', query: {}, body, headers: {} })).toMatchObject({ merchantRef: REF, providerTxnId: '261102000000123', amount: 199_000, status: 'paid' });
    expect(p.verifyWebhook({ method: 'POST', query: {}, body: { ...body, data: V.zalopay.callback_data!.replace('199000', '1000') }, headers: {} })).toBe(false);
    expect(p.ack('invalid_signature')).toEqual({ status: 400, body: { return_code: -1, return_message: 'mac not equal' } });
    expect(p.ack('duplicate').body).toMatchObject({ return_code: 2 });
    expect(p.ack('ok').body).toMatchObject({ return_code: 1 });
    expect(refFromAppTransId(`261102_${REF}`)).toBe(REF);
    expect(refFromAppTransId('bad')).toBeNull();
  });

  it('query mac (key1) & checksum redirect (key2) khớp vector', async () => {
    const p = zp();
    expect(p.buildQueryParams(`261102_${REF}`).mac).toBe(V.zalopay.query_mac);
    const q = { appid: '2554', apptransid: `261102_${REF}`, pmcid: '38', bankcode: '', amount: '199000', discountamount: '0', status: '1', checksum: V.zalopay.return_checksum! };
    expect(p.verifyReturn(q)).toEqual({ valid: true, merchantRef: REF, displayStatus: 'paid' });
    expect(p.verifyReturn({ ...q, status: '2' }).valid).toBe(false);
    const { client } = fakeHttp([{ return_code: 3, is_processing: true }]);
    expect(await zp(client).queryStatus({ merchantRef: REF, createdAt: created, amount: 199_000 })).toMatchObject({ status: 'pending' });
  });
});

describe('Mock gateway', () => {
  it('chữ ký HMAC x-mock-signature; simulate → payload ký đúng; queryStatus theo trạng thái cổng giả', async () => {
    const m = new MockPaymentProvider({ secret: 's3cret', checkoutBaseUrl: 'http://api/v1/payments/mock/checkout', enabled: true });
    const r = await m.createPayment(baseInput('vnpay', new Date()));
    expect(r.redirectUrl).toBe(`http://api/v1/payments/mock/checkout?ref=${REF}`);
    expect(await m.queryStatus({ merchantRef: REF, createdAt: new Date(), amount: 199_000 })).toMatchObject({ status: 'pending', providerTxnId: null });
    const sim = m.simulate(REF, 'paid');
    expect(sim.signature).toBe(signMockWebhook('s3cret', sim.payload));
    expect(m.verifyWebhook({ method: 'POST', query: {}, body: sim.payload, headers: { 'x-mock-signature': sim.signature } })).toBe(true);
    expect(m.verifyWebhook({ method: 'POST', query: {}, body: { ...sim.payload, amount: 1 }, headers: { 'x-mock-signature': sim.signature } })).toBe(false);
    expect(await m.queryStatus({ merchantRef: REF, createdAt: new Date(), amount: 199_000 })).toMatchObject({ status: 'paid', providerTxnId: sim.payload.txn_id });
    expect(new MockPaymentProvider({ secret: 'x', checkoutBaseUrl: 'x', enabled: false }).available()).toBe(false);
  });

  it('asciiDescription bỏ dấu tiếng Việt và ký tự đặc biệt', () => {
    expect(asciiDescription('Thanh toán gói Đề thi #1 (TOEIC)!')).toBe('Thanh toan goi De thi 1 TOEIC');
  });
});
