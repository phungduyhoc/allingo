import { redirect } from '@/i18n/navigation';

/**
 * S9 mở bộ từ của task bằng `/vocab/{id}?task=` (trang tạm). S10: trang bộ từ thật ở `/toeic/vocab/{id}` – giữ đường dẫn cũ
 * (thông báo/đường dẫn đã lưu) bằng chuyển hướng, kèm `?task=`.
 */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; listId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { locale, listId } = await params;
  const sp = await searchParams;
  const task = typeof sp.task === 'string' ? sp.task : undefined;
  redirect({ href: { pathname: `/toeic/vocab/${listId}`, query: task ? { task } : {} }, locale });
}
