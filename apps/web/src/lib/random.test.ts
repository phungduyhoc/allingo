import { describe, expect, it, vi } from 'vitest';
import { randomHex, randomKey } from './random';

describe('random – Web Crypto, không Math.random', () => {
  it('randomHex: đúng độ dài, chỉ ký tự hex, hai lần gọi khác nhau', () => {
    const a = randomHex(16);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex(16)).not.toBe(a);
  });

  it('randomKey: UUID khi có randomUUID; ngữ cảnh không bảo mật → 32 hex từ getRandomValues', () => {
    expect(randomKey()).toMatch(/^[0-9a-f-]{36}$/);
    const spy = vi.spyOn(Math, 'random');
    // Che randomUUID bằng thuộc tính riêng (giả lập ngữ cảnh không bảo mật), xoá đi là về lại phương thức của prototype
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    try {
      expect(randomKey()).toMatch(/^[0-9a-f]{32}$/);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
      spy.mockRestore();
    }
    expect(randomKey()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
