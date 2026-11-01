import { notFound } from 'next/navigation';

/** Bắt mọi đường dẫn không khớp trong [locale] → trang not-found có layout/i18n */
export default function CatchAll() {
  notFound();
}
