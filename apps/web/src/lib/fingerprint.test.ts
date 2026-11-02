import { describe, expect, it } from 'vitest';
import { computeFingerprint, DEVICE_ID_KEY, fallbackHash, getOrCreateDeviceId, traitsString, type DeviceTraits } from './fingerprint';

const traits: DeviceTraits = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/153.0',
  language: 'vi-VN',
  languages: 'vi-VN,vi,en',
  timeZone: 'Asia/Ho_Chi_Minh',
  screen: '1920x1080x24',
  pixelRatio: 1,
  cores: 8,
  memory: 8,
  platform: 'Linux',
  touch: 0,
};

function memoryStore(init: Record<string, string> = {}) {
  const data = { ...init };
  return { data, getItem: (k: string) => data[k] ?? null, setItem: (k: string, v: string) => void (data[k] = v) };
}

describe('dấu vân tay thiết bị (X-Device-Fingerprint)', () => {
  it('ổn định: cùng đặc điểm + cùng id → cùng giá trị; định dạng fp1.<sha256 hex>', async () => {
    const a = await computeFingerprint(traits, 'device-123');
    const b = await computeFingerprint({ ...traits }, 'device-123');
    expect(a).toBe(b);
    expect(a).toMatch(/^fp1\.[0-9a-f]{64}$/);
    expect(a.length).toBeGreaterThanOrEqual(8);
  });
  it('khác id thiết bị hoặc khác đặc điểm → khác giá trị', async () => {
    const a = await computeFingerprint(traits, 'device-123');
    expect(await computeFingerprint(traits, 'device-456')).not.toBe(a);
    expect(await computeFingerprint({ ...traits, timeZone: 'Asia/Tokyo' }, 'device-123')).not.toBe(a);
  });
  it('không chứa dữ liệu thô (đã băm) và thứ tự khoá không ảnh hưởng', async () => {
    const fp = await computeFingerprint(traits, 'device-123');
    expect(fp).not.toContain('Chrome');
    const reordered = Object.fromEntries(Object.entries(traits).reverse()) as unknown as DeviceTraits;
    expect(traitsString(reordered)).toBe(traitsString(traits));
  });
  it('id thiết bị: tạo một lần rồi dùng lại từ storage', () => {
    const store = memoryStore();
    const id1 = getOrCreateDeviceId(store);
    expect(id1.length).toBeGreaterThanOrEqual(8);
    expect(store.data[DEVICE_ID_KEY]).toBe(id1);
    expect(getOrCreateDeviceId(store)).toBe(id1);
    expect(getOrCreateDeviceId(memoryStore({ [DEVICE_ID_KEY]: 'existing-device-id' }))).toBe('existing-device-id');
  });
  it('storage ném lỗi (chế độ riêng tư) → id trong bộ nhớ, ổn định trong phiên', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const a = getOrCreateDeviceId(broken);
    expect(getOrCreateDeviceId(broken)).toBe(a);
  });
  it('băm dự phòng (không có Web Crypto) xác định, 128 bit', () => {
    expect(fallbackHash('abc')).toBe(fallbackHash('abc'));
    expect(fallbackHash('abc')).not.toBe(fallbackHash('abd'));
    expect(fallbackHash('abc')).toMatch(/^[0-9a-f]{32}$/);
  });
});
