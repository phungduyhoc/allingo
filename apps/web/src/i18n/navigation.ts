import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/** Link/router nhận biết locale – luôn dùng thay cho next/link & next/navigation trong UI */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
