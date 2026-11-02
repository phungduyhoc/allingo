import { expect, test, type Page } from '@playwright/test';
import { freshGuestStorage, REAL, startAsGuest, startTestSet } from './helpers';

/**
 * Sprint 4 – Listening Part 1–4.
 * - Exam Mode (`listen_policy = once`): màn "Bắt đầu nghe", phát liên tục một lần, KHÔNG tua/tạm dừng (không thanh tua,
 *   ←/→ không đổi currentTime, click không dừng, pause()/currentTime từ ngoài bị trả lại), tự chuyển câu theo audio,
 *   câu chưa phát bị khoá, tải lại tiếp tục đúng chỗ, URL 403 → gia hạn qua /media rồi phát tiếp.
 * - Practice: tua ±5 s, tốc độ, lặp; đáp án hiện ngay. Review: transcript + nghe lại + tô dòng đang phát.
 * - Đề L&R: hết Listening chuyển sang Reading; kết quả Listening/Reading/Tổng (ước tính).
 *
 * Audio được tăng tốc bằng `window.__ALLINGO_AUDIO_RATE__` (chỉ có ở bản dev – xem listening/test-rate.ts).
 * Mock: `toeic-listening-mini-01` (Part 1–4, 10 câu, WAV im lặng ngắn) + `toeic-lr-mini-01`.
 * API thật: drill `toeic-listening-01-drill-part1` (6 câu, MP3 im lặng ~19 s/câu), practice Part 3, đề L&R `toeic-mini-lr-01` (60 câu).
 */

const LISTENING = { mock: 'toeic-listening-mini-01', real: 'toeic-listening-01-drill-part1' };
/** Tốc độ chuỗi phát trong E2E: đủ nhanh nhưng vẫn phân biệt được "tua +5 s" với thời gian trôi tự nhiên */
const RATE = REAL ? 4 : 2;
const TOTAL = REAL ? 6 : 10;

test.beforeEach(async ({ page }) => {
  await freshGuestStorage(page);
  await page.addInitScript((rate) => {
    (window as unknown as { __ALLINGO_AUDIO_RATE__: number }).__ALLINGO_AUDIO_RATE__ = rate;
  }, RATE);
});

interface AudioSnapshot {
  t: number;
  duration: number;
  paused: boolean;
  controls: boolean;
  src: string;
  rate: number;
}

const activeAudio = (page: Page) =>
  page.evaluate((): AudioSnapshot | null => {
    const el = document.querySelector<HTMLAudioElement>('audio[data-testid="exam-audio"][data-active="true"]');
    return el ? { t: el.currentTime, duration: el.duration, paused: el.paused, controls: el.controls, src: el.currentSrc, rate: el.playbackRate } : null;
  });

/** Chờ một audio đang phát còn ≥ `realSec` giây thực (đủ thời gian thao tác trước khi sang bước khác) */
async function waitLongAudio(page: Page, realSec: number): Promise<AudioSnapshot> {
  let snap: AudioSnapshot | null = null;
  await expect
    .poll(
      async () => {
        snap = await activeAudio(page);
        return !!snap && !snap.paused && snap.t > 0 && (snap.duration - snap.t) / RATE >= realSec;
      },
      { timeout: 60_000, intervals: [100] },
    )
    .toBe(true);
  return snap!;
}

const barStep = async (page: Page) => Number(await page.getByTestId('listening-bar').getAttribute('data-step'));

test('Exam Mode Listening: Bắt đầu nghe → phát một lần liên tục, không tua/tạm dừng, chuyển câu theo audio, tải lại tiếp tục; Review có transcript', async ({ page, isMobile }) => {
  test.setTimeout(150_000);
  await startAsGuest(page);
  await startTestSet(page, LISTENING, 'exam');

  // Màn "Bắt đầu nghe" (bắt buộc bấm – autoplay); câu 1 chưa phát → khoá chọn đáp án
  const gate = page.getByTestId('listening-gate');
  await expect(gate).toBeVisible();
  await expect(gate).toHaveAttribute('data-resumed', 'false');
  await expect(page.getByTestId('question-card').getByTestId('option-A')).toBeDisabled();
  await expect(page.getByTestId('question-card')).toHaveAttribute('data-listen', 'upcoming');
  // Part 1: ảnh + hướng dẫn chung (chữ của lựa chọn chỉ có trong audio)
  await expect(page.getByTestId('question-card').getByTestId('question-image')).toBeVisible();
  await expect(page.getByTestId('question-card').getByTestId('listening-direction')).toBeVisible();
  await page.getByTestId('start-listening').click();
  await expect(gate).toHaveCount(0);
  await expect(page.getByTestId('listening-bar')).toBeVisible();

  // Không có điều khiển tua/tạm dừng (thanh tua, nút phát, controls gốc)
  await expect(page.getByTestId('player-seek')).toHaveCount(0);
  await expect(page.locator('audio[controls]')).toHaveCount(0);
  await expect(page.getByTestId('player-toggle')).toHaveCount(0);

  // Câu đang phát chọn được đáp án
  await page.getByTestId('question-card').getByTestId('option-A').click();
  await expect(page.getByText(`1/${TOTAL} đã trả lời`).filter({ visible: true }).first()).toBeVisible();

  // Xem trước câu chưa phát: khoá + nút "Về câu đang nghe" (ngừng tự chuyển theo audio)
  if (isMobile) {
    await page.getByRole('button', { name: 'Mở danh sách câu' }).click();
    await page.getByRole('dialog').getByTestId(`grid-${TOTAL}`).click();
  } else {
    await page.getByTestId(`grid-${TOTAL}`).click();
  }
  await expect(page.getByTestId('question-card')).toContainText(`Câu ${TOTAL}/${TOTAL}`);
  await expect(page.getByTestId('question-card').getByTestId('option-A')).toBeDisabled();
  await expect(page.getByTestId('listening-bar')).toHaveAttribute('data-following', 'false');
  await page.getByTestId('listening-jump').click();
  await expect(page.getByTestId('listening-bar')).toHaveAttribute('data-following', 'true');

  // ←/→ và click lên thanh nghe/vùng câu hỏi: currentTime chỉ tăng theo thời gian thực, audio không dừng
  await waitLongAudio(page, 1.5);
  const before = Date.now();
  const s0 = (await activeAudio(page))!;
  expect(s0.controls).toBe(false);
  expect(s0.rate).toBe(RATE);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.getByTestId('listening-bar').click({ position: { x: 10, y: 10 } });
  const s1 = (await activeAudio(page))!;
  // Thời gian nội dung tối đa có thể trôi giữa hai lần đo (tua +5 s sẽ vượt mức này)
  const elapsed = ((Date.now() - before) / 1000) * RATE;
  expect(s1.src).toBe(s0.src);
  expect(s1.paused).toBe(false);
  expect(s1.t).toBeGreaterThanOrEqual(s0.t);
  expect(s1.t - s0.t).toBeLessThanOrEqual(elapsed + 0.25);

  // Tạm dừng / tua từ bên ngoài (phím media, devtools, tiện ích) bị trả lại ngay
  const guarded = await page.evaluate(async () => {
    const el = document.querySelector<HTMLAudioElement>('audio[data-testid="exam-audio"][data-active="true"]')!;
    const pos = el.currentTime;
    el.pause();
    el.currentTime = 0;
    await new Promise((r) => setTimeout(r, 300));
    return { paused: el.paused, t: el.currentTime, pos, same: el.getAttribute('data-active') === 'true' };
  });
  if (guarded.same) {
    expect(guarded.paused).toBe(false);
    expect(guarded.t).toBeGreaterThanOrEqual(guarded.pos - 0.05);
  }
  if ((await page.getByTestId('listening-bar').getAttribute('data-following')) === 'false') await page.getByTestId('listening-jump').click();

  // Tự chuyển câu theo audio
  await expect(page.getByTestId('question-card')).toContainText(/Câu [2-9]\//, { timeout: 30_000 });
  await expect(page.getByTestId('question-card')).toHaveAttribute('data-listen', /playing|played/);
  const stepBefore = await barStep(page);
  expect(stepBefore).toBeGreaterThan(0);

  // Tải lại giữa Listening → "Tiếp tục nghe", không phát lại đoạn đã nghe (bước không lùi)
  await page.reload();
  await expect(page.getByTestId('listening-gate')).toBeVisible();
  await expect(page.getByTestId('listening-gate')).toHaveAttribute('data-resumed', 'true');
  await expect(page.getByTestId('question-card').getByTestId('option-A')).toBeEnabled();
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('listening-bar')).toBeVisible();
  expect(await barStep(page)).toBeGreaterThanOrEqual(stepBefore);

  // Hết Listening → thanh nghe ẩn, mọi câu chọn được
  await expect(page.getByTestId('listening-bar')).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByTestId('question-card').getByTestId('option-B')).toBeEnabled();
  await page.getByTestId('question-card').getByTestId('option-B').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');

  // Nộp → kết quả Listening (ước tính) → Review có transcript, nghe lại từng câu, tô dòng đang phát
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  await expect(page.getByTestId('scaled-scores')).toBeVisible();
  await expect(page.getByTestId('scaled-listening')).not.toHaveAttribute('data-score', '');
  await expect(page.getByTestId('scaled-reading')).toHaveAttribute('data-score', '');
  await expect(page.getByTestId('scaled-note')).toContainText('không phải điểm chính thức');
  await expect(page.getByTestId('breakdown-part1')).toBeVisible();

  await page.getByTestId('review-link').click();
  await expect(page).toHaveURL(/\/review$/);
  const first = page.getByTestId('review-item-1');
  await expect(first.getByTestId('transcript')).toBeVisible();
  await expect(first.getByTestId('transcript-speaker').first()).toBeVisible();
  await expect(first.getByTestId('transcript-evidence').first()).toBeVisible();
  await expect(first.getByTestId('question-image')).toBeVisible();
  await first.getByTestId('player-toggle').click();
  await expect(first.locator('[data-testid="transcript-line"][data-active="true"]')).toHaveCount(1, { timeout: 10_000 });
  if (!REAL) {
    // Part 3/4: một đầu nhóm cho mỗi hội thoại/bài nói (nghe lại cả nhóm + transcript)
    await expect(page.getByTestId('review-audio-group')).toHaveCount(2);
    await expect(page.getByTestId('review-audio-group').first().getByTestId('transcript-line').first()).toBeVisible();
  }
});

test('Vị trí chuỗi phát lưu lên server (ui_state.listening – S5): mất localStorage → tải lại vẫn tiếp tục đúng chỗ', async ({ page }) => {
  test.setTimeout(120_000);
  await startAsGuest(page);
  const attemptId = await startTestSet(page, LISTENING, 'exam');
  await page.getByTestId('start-listening').click();
  // Audio tự chuyển sang câu 2 → lượt lưu nháp (PUT /answers) mang ui_state.listening
  await expect(page.getByTestId('question-card')).toContainText(`Câu 2/${TOTAL}`, { timeout: 60_000 });
  const serverCursor = async (): Promise<{ step: number; offset_ms: number } | null> => {
    if (REAL) {
      const res = await page.request.get(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1'}/attempts/${attemptId}`);
      return ((await res.json()) as { ui_state?: { listening?: { step: number; offset_ms: number } } }).ui_state?.listening ?? null;
    }
    return page.evaluate((id) => {
      const st = JSON.parse(window.localStorage.getItem('allingo.mock.v1') ?? '{}') as { attempts?: Record<string, { ui_state?: { listening?: { step: number; offset_ms: number } } }> };
      return st.attempts?.[id]?.ui_state?.listening ?? null;
    }, attemptId);
  };
  await expect.poll(async () => (await serverCursor())?.step ?? -1, { timeout: 30_000 }).toBeGreaterThan(0);
  const saved = (await serverCursor())!;
  expect(saved.offset_ms).toBeGreaterThanOrEqual(0);
  // Mất lớp nhanh (localStorage) – như đổi thiết bị/xoá dữ liệu trình duyệt
  await page.evaluate((id) => window.localStorage.removeItem(`allingo.listening.${id}`), attemptId);
  await page.reload();
  await expect(page.getByTestId('listening-gate')).toHaveAttribute('data-resumed', 'true');
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('listening-bar')).toBeVisible();
  expect(await barStep(page)).toBeGreaterThanOrEqual(saved.step);
});

test('URL ký 403 (hết hạn) giữa Listening → gia hạn qua /attempts/{id}/media rồi phát tiếp', async ({ page }) => {
  test.setTimeout(120_000);
  // Câu 2: lần tải đầu trả 403 (như URL ký đã hết hạn); URL gia hạn (sig khác) cho qua
  const target = REAL ? /\/storage\/fs\/media\/seed\/l01-q2\/audio\.mp3/ : /\/demo-audio\/listening\/p1-02\.wav/;
  // URL ban đầu của câu 2 luôn trả 403 (kể cả khi trình duyệt tự thử lại); URL gia hạn (chữ ký khác) cho qua
  let firstUrl: string | null = null;
  let blocked = 0;
  const requested: string[] = [];
  await page.route(target, async (route) => {
    const url = route.request().url();
    requested.push(url);
    firstUrl ??= url;
    if (url === firstUrl) {
      blocked++;
      await route.fulfill({ status: 403, body: 'expired' });
      return;
    }
    await route.continue();
  });
  const mediaCalls: string[] = [];
  page.on('request', (r) => {
    if (/\/attempts\/[0-9a-f-]+\/media$/.test(new URL(r.url()).pathname)) mediaCalls.push(r.url());
  });
  await startAsGuest(page);
  await startTestSet(page, LISTENING, 'exam');
  await page.getByTestId('start-listening').click();
  // Qua được câu 2 dù lần tải đầu bị 403
  await expect(page.getByTestId('question-card')).toContainText(`Câu 3/${TOTAL}`, { timeout: 60_000 });
  expect(blocked).toBeGreaterThan(0);
  expect(new Set(requested).size).toBeGreaterThan(1);
  if (REAL) expect(mediaCalls.length).toBeGreaterThan(0);
});

test('Practice Part 3: tua ±5 s, đổi tốc độ, lặp; đáp án hiện ngay', async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/vi/toeic/practice');
  await page.getByTestId('practice-section').selectOption('part3');
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toHaveAttribute('data-mode', 'drill');
  await expect(page.getByTestId('listening-gate')).toHaveCount(0);
  const player = page.getByTestId('group-audio-player');
  await expect(player).toBeVisible();
  const audio = player.locator('audio');
  const state = () => audio.evaluate((el: HTMLAudioElement) => ({ t: el.currentTime, paused: el.paused, rate: el.playbackRate, loop: el.loop, duration: el.duration }));

  await player.getByTestId('player-toggle').click();
  await expect.poll(async () => (await state()).paused).toBe(false);
  await player.getByTestId('player-toggle').click();
  await expect.poll(async () => (await state()).paused).toBe(true);
  const t0 = (await state()).t;
  // → trên thanh tua: +5 s (không chuyển câu)
  await player.getByTestId('player-seek').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await state()).t).toBeGreaterThanOrEqual(Math.min(t0 + 4.5, (await state()).duration - 0.1));
  await expect(page.getByTestId('question-card')).toContainText('Câu 1/');
  const t1 = (await state()).t;
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => (await state()).t).toBeLessThanOrEqual(Math.max(0, t1 - 4.5));
  await player.getByTestId('player-forward').click();
  await expect.poll(async () => (await state()).t).toBeGreaterThan(1);

  await player.getByTestId('player-rate-1.25').click();
  await expect.poll(async () => (await state()).rate).toBe(1.25);
  await expect(player.getByTestId('player-rate-1.25')).toHaveAttribute('aria-pressed', 'true');
  await player.getByTestId('player-loop').click();
  await expect.poll(async () => (await state()).loop).toBe(true);

  // Đáp án hiện ngay (như S3)
  const card = page.getByTestId('question-card');
  await card.getByTestId('option-A').click();
  await expect(card.getByTestId('practice-feedback')).toBeVisible();
});

test('Luyện tính giờ từng câu (timed_drill): đồng hồ câu, hết giờ tự sang câu kế', async ({ page }) => {
  test.setTimeout(60_000);
  await startAsGuest(page);
  await page.goto('/vi/toeic/practice');
  await page.getByTestId('practice-section').selectOption('part5');
  await page.getByTestId('practice-timed').check();
  await page.getByTestId('practice-per-question').selectOption('10');
  await page.getByTestId('practice-start').click();
  await expect(page).toHaveURL(/\/vi\/attempts\/[0-9a-f-]+$/);
  await expect(page.getByTestId('attempt-runner')).toHaveAttribute('data-mode', 'timed_drill');
  await expect(page.getByTestId('exam-clock')).toBeVisible();
  const timer = page.getByTestId('question-timer');
  await expect(timer).toBeVisible();
  expect(Number(await timer.getAttribute('data-left'))).toBeLessThanOrEqual(10);
  await expect(page.getByTestId('question-card')).toContainText('Câu 1/');
  await page.getByTestId('question-card').getByTestId('option-A').click();
  // Không phản hồi trước khi nộp
  await expect(page.getByTestId('practice-feedback')).toHaveCount(0);
  await expect(page.getByTestId('question-card')).toContainText('Câu 2/', { timeout: 15_000 });
});

test('Đề L&R: hết Listening tự chuyển sang Reading; kết quả Listening / Reading / Tổng + khoảng ước tính', async ({ page }) => {
  // API thật: toeic-mini-lr-01 (60 câu, Listening ~13,5′ audio + chờ) → tăng tốc 16× (~1′)
  test.setTimeout(REAL ? 240_000 : 120_000);
  if (REAL) {
    await page.addInitScript(() => {
      (window as unknown as { __ALLINGO_AUDIO_RATE__: number }).__ALLINGO_AUDIO_RATE__ = 16;
    });
  }
  await startAsGuest(page);
  await startTestSet(page, { mock: 'toeic-lr-mini-01', real: 'toeic-mini-lr-01' }, 'exam');
  await expect(page.getByTestId('part-tab-part1')).toHaveAttribute('data-active', 'true');
  await page.getByTestId('start-listening').click();
  await expect(page.getByTestId('listening-bar')).toHaveCount(0, { timeout: REAL ? 200_000 : 90_000 });
  await expect(page.getByTestId('question-card')).toContainText(REAL ? 'Câu 35/60' : 'Câu 11/20');
  await expect(page.getByTestId('part-tab-part5')).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('attempt-live')).toContainText('Reading');
  await page.getByTestId('question-card').getByTestId('option-A').click();
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await page.getByTestId('submit-button').click();
  await page.getByTestId('confirm-submit').click();
  await expect(page).toHaveURL(/\/result$/);
  for (const k of ['listening', 'reading', 'total']) await expect(page.getByTestId(`scaled-${k}`)).not.toHaveAttribute('data-score', '');
  await expect(page.getByTestId('scaled-total-range')).toContainText('Khoảng ước tính');
  await expect(page.getByTestId('score-range')).toBeVisible();
  await expect(page.getByTestId('scale-range')).toContainText('10–990');
  await expect(page.getByTestId('breakdown-listening')).toBeVisible();
  await expect(page.getByTestId('breakdown-reading')).toBeVisible();
});
