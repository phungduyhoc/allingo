import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave, type AutosaveStatus } from './autosave';

describe('createAutosave – lưu ghi chú có debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('gõ liên tục → chỉ lưu MỘT lần với giá trị cuối sau `delay`', async () => {
    const save = vi.fn(async () => undefined);
    const statuses: AutosaveStatus[] = [];
    const a = createAutosave<string>({ delay: 800, save, onStatus: (s) => statuses.push(s) }, '');
    a.schedule('M');
    await vi.advanceTimersByTimeAsync(300);
    a.schedule('Mẹ');
    await vi.advanceTimersByTimeAsync(300);
    a.schedule('Mẹo: by + mốc');
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('Mẹo: by + mốc');
    expect(statuses.at(-1)).toBe('saved');
    expect(a.hasPending).toBe(false);
  });

  it('lưu nối tiếp: gõ tiếp trong lúc đang lưu → lần sau chờ lần trước xong (POST rồi PATCH)', async () => {
    const order: string[] = [];
    let release!: () => void;
    const save = vi.fn((v: string) => {
      order.push(`start:${v}`);
      return new Promise<void>((r) => {
        release = () => {
          order.push(`end:${v}`);
          r();
        };
      });
    });
    const a = createAutosave<string>({ delay: 100, save });
    a.schedule('a');
    await vi.advanceTimersByTimeAsync(100);
    expect(a.status).toBe('saving');
    a.schedule('ab');
    await vi.advanceTimersByTimeAsync(100);
    expect(order).toEqual(['start:a']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(['start:a', 'end:a', 'start:ab']);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(a.status).toBe('saved');
  });

  it('lỗi → status error, giữ giá trị; retry lưu lại thành công', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const a = createAutosave<string>({ delay: 50, save });
    a.schedule('ghi chú');
    await vi.advanceTimersByTimeAsync(50);
    expect(a.status).toBe('error');
    expect(a.hasPending).toBe(true);
    await a.retry();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('ghi chú');
    expect(a.status).toBe('saved');
  });

  it('giá trị trùng bản đã lưu (equals) → không gọi save; flush lưu ngay; cancel bỏ phần chờ', async () => {
    const save = vi.fn(async () => undefined);
    const a = createAutosave<string>({ delay: 1000, save, equals: (x, y) => x.trim() === y.trim() }, 'abc');
    a.schedule('abc  ');
    await a.flush();
    expect(save).not.toHaveBeenCalled();
    a.schedule('abcd');
    await a.flush();
    expect(save).toHaveBeenCalledWith('abcd');
    a.schedule('xyz');
    a.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
