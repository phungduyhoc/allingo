import vi from './messages/vi.json' with { type: 'json' };
import en from './messages/en.json' with { type: 'json' };

export const LOCALES = ['vi', 'en'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'vi';

export const messages = { vi, en } as const;
export type Messages = typeof vi;

export function isAppLocale(x: string | undefined | null): x is AppLocale {
  return !!x && (LOCALES as readonly string[]).includes(x);
}
