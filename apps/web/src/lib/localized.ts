import { pickLocalized, type LocalizedText } from '@allingo/schemas';
import { useLocale } from 'next-intl';

/** Lấy chuỗi đa ngôn ngữ JSONB {vi,en,...} theo locale hiện tại, fallback en → vi (CLAUDE.md §5.11) */
export function useLocalized(): (text: LocalizedText | Record<string, string | undefined> | null | undefined) => string {
  const locale = useLocale();
  return (text) => pickLocalized(text as LocalizedText | null | undefined, locale);
}

export { pickLocalized };
