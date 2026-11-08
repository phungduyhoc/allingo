import { describe, expect, it } from 'vitest';
import { base32Decode, totpAt, verifyTotp } from './totp';

// RFC 6238 phụ lục B: khoá ASCII "12345678901234567890" (SHA1), T = 59 s → 94287082 (8 số) → 287082 (6 số)
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP của máy chủ giả lập (S12 – MFA)', () => {
  it('base32 + vector RFC 6238', async () => {
    expect(new TextDecoder().decode(base32Decode(RFC_SECRET))).toBe('12345678901234567890');
    expect(await totpAt(RFC_SECRET, Math.floor(59 / 30))).toBe('287082');
    expect(await totpAt(RFC_SECRET, Math.floor(1111111109 / 30))).toBe('081804');
  });
  it('cửa sổ ±1 bước, sai định dạng → null', async () => {
    const now = 1111111109 * 1000;
    expect(await verifyTotp(RFC_SECRET, '081804', now)).toBe(Math.floor(1111111109 / 30));
    expect(await verifyTotp(RFC_SECRET, '081804', now + 30_000)).not.toBeNull();
    expect(await verifyTotp(RFC_SECRET, '081804', now + 95_000)).toBeNull();
    expect(await verifyTotp(RFC_SECRET, '12345', now)).toBeNull();
  });
});
