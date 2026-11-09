'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { DEFAULT_PROGRAM, isProgramCode, programDef, type ProgramDef } from '@allingo/schemas/program/registry';
import type { ProgramCode } from '@allingo/schemas/common';
import { useMe } from '@/lib/queries';

/**
 * C1 – chương trình hiện hành của khu học (ADR-0038). Thứ tự ưu tiên:
 *  1) tham số route `/[program]/…` (dashboard, đề, luyện tập, sổ lỗi, thống kê, lộ trình, từ vựng);
 *  2) ProgramProvider tường minh (trang ngoài `[program]` biết chương trình – vd. kết quả/xem lại theo chương trình của bài làm);
 *  3) `me.active_program` (bộ chọn chương trình);
 *  4) DEFAULT_PROGRAM (TOEIC – tương thích GĐ1).
 */

const ProgramContext = React.createContext<ProgramCode | null>(null);

export function ProgramProvider({ program, children }: { program: ProgramCode; children: React.ReactNode }) {
  return <ProgramContext.Provider value={program}>{children}</ProgramContext.Provider>;
}

/** Chương trình theo route (null khi trang không nằm dưới `/[program]`) */
export function useRouteProgram(): ProgramCode | null {
  const params = useParams<{ program?: string | string[] }>();
  const raw = Array.isArray(params?.program) ? params.program[0] : params?.program;
  return isProgramCode(raw) ? raw : null;
}

export function useProgram(): ProgramCode {
  const ctx = React.useContext(ProgramContext);
  const route = useRouteProgram();
  const me = useMe({ enabled: !ctx && !route });
  if (ctx) return ctx;
  if (route) return route;
  const active = me.data?.active_program;
  return isProgramCode(active) ? active : DEFAULT_PROGRAM;
}

export function useProgramDef(): ProgramDef {
  return programDef(useProgram()) ?? programDef(DEFAULT_PROGRAM)!;
}

/** Trang trong khu học của chương trình: programHref('ielts', 'dashboard') → '/ielts/dashboard' */
export const PROGRAM_PAGES = ['dashboard', 'diagnostic', 'errors', 'plan', 'practice', 'stats', 'test-sets', 'today', 'vocab'] as const;
export type ProgramPage = (typeof PROGRAM_PAGES)[number];

export function programHref(program: string, page: ProgramPage | `vocab/${string}`, query?: string): string {
  const base = `/${program}/${page}`;
  return query ? `${base}${query.startsWith('?') ? query : `?${query}`}` : base;
}

/** Hook tiện dụng: `href('practice', '?section=part5')` theo chương trình hiện hành */
export function useProgramHref(): (page: ProgramPage | `vocab/${string}`, query?: string) => string {
  const program = useProgram();
  return React.useCallback((page, query) => programHref(program, page, query), [program]);
}
