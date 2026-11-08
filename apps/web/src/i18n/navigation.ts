import { createElement, type ComponentProps } from 'react';
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

const nav = createNavigation(routing);

/** Link/router nhận biết locale – luôn dùng thay cho next/link & next/navigation trong UI */
export const { redirect, usePathname, useRouter, getPathname } = nav;

/**
 * S11 (hiệu năng): `prefetch` mặc định TẮT. Mọi trang render động (CSP nonce theo request) và khu vực học dựng ở client sau
 * AuthGate, nên tải trước RSC + JS của ~20 liên kết thanh điều hướng khi vào dashboard chỉ tốn CPU/mạng (Lighthouse mobile:
 * ~200 KB JS route + 30 request RSC trong lúc trang đang dựng). Liên kết cần tải trước truyền `prefetch` tường minh.
 */
export function Link(props: ComponentProps<typeof nav.Link>) {
  return createElement(nav.Link, { prefetch: false, ...props });
}
