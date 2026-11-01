'use client';

import { useTranslations } from 'next-intl';

const KNOWN_SECTIONS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7', 'listening', 'reading'] as const;
type KnownSection = (typeof KNOWN_SECTIONS)[number];

export const isKnownSection = (code: string): code is KnownSection => (KNOWN_SECTIONS as readonly string[]).includes(code);

/** Tên Part theo i18n (`sections.*`); `short` → chỉ phần trước dấu "·" ("Part 5"). Mã lạ → hiển thị nguyên mã. */
export function useSectionLabel(): (code: string, opts?: { short?: boolean }) => string {
  const ts = useTranslations('sections');
  return (code, opts) => {
    if (!isKnownSection(code)) return code;
    const full = ts(code);
    return opts?.short ? (full.split(' · ')[0] ?? full) : full;
  };
}
