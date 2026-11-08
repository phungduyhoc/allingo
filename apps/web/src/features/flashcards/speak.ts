'use client';

import { fetchTts } from '@/lib/learning-api';

/**
 * Phát âm thẻ từ: GET /tts (server cache theo văn bản × giọng, URL ký 10′) → `<audio>`. URL dùng lại tới khi sắp hết hạn; phát
 * lại cùng phần tử khi bấm liên tục. Lỗi (mạng, chặn autoplay) trả false – giao diện chỉ đổi trạng thái nút, không chặn phiên.
 */
const VOICE = 'en-US-neural-f';
const cache = new Map<string, { url: string; expiresAt: number }>();
let current: HTMLAudioElement | null = null;

export async function ttsUrl(text: string): Promise<string> {
  const key = text.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt - Date.now() > 30_000) return hit.url;
  const r = await fetchTts(text, VOICE);
  cache.set(key, { url: r.url, expiresAt: r.expires_at ? Date.parse(r.expires_at) : Date.now() + 9 * 60_000 });
  return r.url;
}

export async function speak(text: string): Promise<boolean> {
  if (!text.trim() || typeof Audio === 'undefined') return false;
  try {
    const url = await ttsUrl(text);
    current?.pause();
    current = new Audio(url);
    await current.play();
    return true;
  } catch {
    return false;
  }
}
