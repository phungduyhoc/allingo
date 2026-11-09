'use client';

import { useTranslations } from 'next-intl';
import { PROGRAM_LIST } from '@allingo/schemas/program/registry';

/** Mã phần thi của mọi chương trình (registry – C1) + nhóm kỹ năng listening/reading; nhãn ở `sections.*` (packages/i18n) */
const KNOWN_SECTIONS: ReadonlySet<string> = new Set([...PROGRAM_LIST.flatMap((p) => p.sections.map((s) => s.code)), 'listening', 'reading']);

export const isKnownSection = (code: string): boolean => KNOWN_SECTIONS.has(code);

/** Tên phần thi theo i18n (`sections.*`); `short` → chỉ phần trước dấu "·" ("Part 5"). Mã lạ/thiếu nhãn → hiển thị nguyên mã. */
export function useSectionLabel(): (code: string, opts?: { short?: boolean }) => string {
  const ts = useTranslations('sections');
  return (code, opts) => {
    if (!isKnownSection(code) || !ts.has(code)) return code;
    const full = ts(code as 'part1');
    return opts?.short ? (full.split(' · ')[0] ?? full) : full;
  };
}
