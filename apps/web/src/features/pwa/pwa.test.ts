import { describe, expect, it } from 'vitest';
import { pushSupport, sameKey, subscriptionBody, urlBase64ToUint8Array } from './push';
import { isIosSafari, shouldShowInstall } from './install-state';
import { parseViewed, upsertViewed, VIEWED_MAX, type ViewedEntry } from '@/features/offline/viewed-store';
import { examLockDecision } from '@/lib/exam-lock';

const VAPID = 'BLPAaqWp0X3nGv9rDk9TlK8mmpHEFWmhi2fAmmzQsMyMpLUbCFGPUc75v4mxEN1XGKXJ8XB3mCY67mHzdlhmLdg';

describe('Web Push – trình duyệt', () => {
  it('urlBase64ToUint8Array: khoá VAPID P-256 65 byte bắt đầu 0x04; sameKey so khớp', () => {
    const key = urlBase64ToUint8Array(VAPID);
    expect(key.length).toBe(65);
    expect(key[0]).toBe(4);
    expect(sameKey(key.buffer, urlBase64ToUint8Array(VAPID))).toBe(true);
    expect(sameKey(new Uint8Array(65).buffer, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });

  it('subscriptionBody: PushSubscription.toJSON() → body API (+ user_agent cắt 300, locale hợp lệ)', () => {
    const json: PushSubscriptionJSON = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      expirationTime: null,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    };
    expect(subscriptionBody(json, 'UA'.repeat(200), 'vi')).toEqual({
      endpoint: json.endpoint,
      expirationTime: null,
      keys: json.keys,
      user_agent: 'UA'.repeat(150),
      locale: 'vi',
    });
    expect(subscriptionBody({ endpoint: 'x' }, null, 'xx')).toBeNull();
    expect(subscriptionBody(json, null, 'de')).not.toHaveProperty('locale');
  });

  it('pushSupport: iOS chưa cài → hướng dẫn cài; thiếu API → unsupported', () => {
    const base = { hasSw: true, hasPushManager: true, hasNotification: true, ios: false, standalone: false };
    expect(pushSupport(base)).toBe('supported');
    expect(pushSupport({ ...base, ios: true })).toBe('ios-install');
    expect(pushSupport({ ...base, ios: true, standalone: true })).toBe('supported');
    expect(pushSupport({ ...base, hasPushManager: false })).toBe('unsupported');
  });
});

describe('Cài PWA (A2HS)', () => {
  it('chỉ gợi ý sau 2 lượt truy cập, không khi đã cài/đã "Để sau"; iOS → hướng dẫn', () => {
    const base = { visits: 2, snoozed: false, standalone: false, hasPrompt: true, ios: false };
    expect(shouldShowInstall(base)).toBe('prompt');
    expect(shouldShowInstall({ ...base, visits: 1 })).toBeNull();
    expect(shouldShowInstall({ ...base, snoozed: true })).toBeNull();
    expect(shouldShowInstall({ ...base, standalone: true })).toBeNull();
    expect(shouldShowInstall({ ...base, hasPrompt: false })).toBeNull();
    expect(shouldShowInstall({ ...base, hasPrompt: false, ios: true })).toBe('ios');
  });
  it('isIosSafari: Safari iPhone/iPadOS, không phải Chrome iOS', () => {
    expect(
      isIosSafari(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(true);
    expect(
      isIosSafari(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
        5,
      ),
    ).toBe(true);
    expect(
      isIosSafari(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe(false);
    expect(isIosSafari('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36')).toBe(false);
  });
});

describe('Đề đã xem (trang offline)', () => {
  const e = (id: string, at: number, title: string | null = null): ViewedEntry => ({
    id,
    kind: 'review',
    title,
    href: `/attempts/${id}/review`,
    at,
  });
  it('upsert: mới nhất trước, cùng id thay thế nhưng giữ tên đã biết, tối đa 20', () => {
    let list = upsertViewed([], { ...e('a', 1, 'Part 5 mini'), kind: 'attempt' });
    list = upsertViewed(list, e('b', 2));
    list = upsertViewed(list, e('a', 3));
    expect(list.map((x) => [x.id, x.kind, x.title])).toEqual([
      ['a', 'review', 'Part 5 mini'],
      ['b', 'review', null],
    ]);
    for (let i = 0; i < 30; i++) list = upsertViewed(list, e(`x${i}`, 10 + i));
    expect(list).toHaveLength(VIEWED_MAX);
  });
  it('parseViewed bỏ mục hỏng và đường dẫn ngoài (//, http)', () => {
    expect(parseViewed('{bad')).toEqual([]);
    expect(
      parseViewed(JSON.stringify([e('a', 1), { id: 'b', href: '//evil' }, { id: 'c', href: 'https://x' }, null])),
    ).toHaveLength(1);
  });
});

describe('examLockDecision (khoá Exam Mode phía UI)', () => {
  it('có bài thi trong danh sách → khoá; 403 mới hơn danh sách → khoá; danh sách mới hơn không còn bài thi → mở', () => {
    expect(examLockDecision({ openExamId: 'x', listUpdatedAt: 10, apiLock: null })).toEqual({
      locked: true,
      attemptId: 'x',
    });
    expect(examLockDecision({ openExamId: null, listUpdatedAt: 10, apiLock: { attemptId: 'y', at: 20 } })).toEqual({
      locked: true,
      attemptId: 'y',
    });
    expect(examLockDecision({ openExamId: null, listUpdatedAt: 30, apiLock: { attemptId: 'y', at: 20 } })).toEqual({
      locked: false,
      attemptId: null,
    });
    expect(examLockDecision({ openExamId: null, listUpdatedAt: 0, apiLock: null })).toEqual({
      locked: false,
      attemptId: null,
    });
  });
});
