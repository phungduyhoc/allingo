import { expect, type Locator, type Page } from '@playwright/test';

/** Dùng chung cho các spec Sprint 3. REAL = chạy với API thật (E2E_REAL_API=1, cần seed demo). */
export const REAL = process.env.E2E_REAL_API === '1';

/** Mỗi test là một khách mới: xoá trạng thái allingo.* MỘT LẦN ở lần tải đầu (init script chạy lại ở mọi lần tải) */
export async function freshGuestStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (window.sessionStorage.getItem('e2e.cleared')) return;
    for (const k of Object.keys(window.localStorage)) if (k.startsWith('allingo.')) window.localStorage.removeItem(k);
    window.sessionStorage.setItem('e2e.cleared', '1');
  });
}

export async function startAsGuest(page: Page): Promise<void> {
  await page.goto('/vi');
  await page.getByRole('button', { name: 'Luyện thử miễn phí' }).first().click();
  await expect(page).toHaveURL(/\/vi\/toeic\/dashboard/);
}

/** Mở đề theo mã (mock và seed demo dùng mã khác nhau) và bắt đầu ở chế độ đã chọn; trả attempt id */
export async function startTestSet(
  page: Page,
  code: { mock: string; real: string },
  mode: 'exam' | 'practice',
): Promise<string> {
  await page.goto('/vi/toeic/test-sets');
  await page
    .getByTestId(`test-set-${REAL ? code.real : code.mock}`)
    .getByRole('button', { name: /Bắt đầu/ })
    .click();
  await page.getByTestId(`mode-${mode}`).click();
  await page.getByTestId('start-attempt').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toBeVisible();
  return page.url().split('/').pop()!;
}

/** Chọn đáp án ở câu đang xem (trong nhóm đoạn văn có nhiều câu → luôn trong `question-card`) */
export async function answerCurrent(page: Page, key: string): Promise<void> {
  const card = page.getByTestId('question-card');
  await card.getByTestId(`option-${key}`).click();
  await expect(card.getByTestId(`option-${key}`)).toHaveAttribute('aria-checked', 'true');
}

/** Số câu nháp đang nằm trong IndexedDB `allingo-drafts` cho attempt (0 nếu chưa có DB/bản ghi) */
export async function draftsInIndexedDb(page: Page, attemptId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    if (!dbs.some((d) => d.name === 'allingo-drafts')) return 0;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('allingo-drafts');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('open failed'));
    });
    try {
      if (!db.objectStoreNames.contains('drafts')) return 0;
      const value = await new Promise<{ entries?: Record<string, unknown> } | undefined>((resolve, reject) => {
        const g = db.transaction('drafts', 'readonly').objectStore('drafts').get(id);
        g.onsuccess = () => resolve(g.result as { entries?: Record<string, unknown> } | undefined);
        g.onerror = () => reject(g.error ?? new Error('get failed'));
      });
      return value ? Object.keys(value.entries ?? {}).length : 0;
    } finally {
      db.close();
    }
  }, attemptId);
}

/**
 * S6 – chọn chữ trong một vùng tra từ (`[data-lookup]`): tìm `text` trong các text node của `root`.
 * `how = 'dblclick'` → nhấp đúp thật vào giữa từ (trình duyệt tự chọn từ); `'select'` → đặt vùng chọn bằng Range rồi phát
 * `mouseup` như khi người học bôi đen bằng chuột. Trả false nếu không thấy chữ.
 */
export async function selectInZone(
  page: Page,
  root: Locator,
  text: string,
  how: 'dblclick' | 'select' = 'select',
): Promise<boolean> {
  const rect = await root.evaluate(
    (el, { needle, mode }) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const idx = (n.textContent ?? '').indexOf(needle);
        if (idx < 0) continue;
        const range = document.createRange();
        range.setStart(n, idx);
        range.setEnd(n, idx + needle.length);
        (n.parentElement ?? el).scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = range.getBoundingClientRect();
        if (mode === 'select') {
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        }
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      return null;
    },
    { needle: text, mode: how },
  );
  if (!rect) return false;
  if (how === 'dblclick') await page.mouse.dblclick(rect.x, rect.y);
  return true;
}
