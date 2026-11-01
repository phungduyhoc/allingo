/**
 * Hệ số tăng tốc chuỗi phát Listening CHỈ cho kiểm thử E2E (Playwright đặt `window.__ALLINGO_AUDIO_RATE__` bằng init script):
 * nhân `playbackRate` và chia `pause_ms` để đề 45′ chạy trong vài phút. Bản build production luôn trả 1
 * (`process.env.NODE_ENV` được inline → nhánh đọc window bị loại bỏ), người học không đổi được tốc độ ở Exam Mode.
 */
export function audioTestRate(): number {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return 1;
  const v = (window as unknown as { __ALLINGO_AUDIO_RATE__?: unknown }).__ALLINGO_AUDIO_RATE__;
  return typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 16 ? v : 1;
}
