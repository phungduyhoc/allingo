import { permanentRedirect } from 'next/navigation';

/** S12: văn bản pháp lý chuyển về /legal/* (đường dẫn `web_path` của GET /legal/policies); giữ liên kết cũ /terms */
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/legal/terms`);
}
