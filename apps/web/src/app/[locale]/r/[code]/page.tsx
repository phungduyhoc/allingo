import { redirect } from 'next/navigation';

/**
 * Link giới thiệu dạng web `/r/<code>?utm_*` (API thật phục vụ `/v1/r/{code}` có thẻ OG rồi chuyển hướng; API giả lập trỏ link về
 * đây) → trang đăng ký giữ `ref` + UTM.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, code } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ ref: code });
  for (const [k, v] of Object.entries(sp)) if (k.startsWith('utm_') && typeof v === 'string') q.set(k, v);
  redirect(`/${locale}/register?${q.toString()}`);
}
