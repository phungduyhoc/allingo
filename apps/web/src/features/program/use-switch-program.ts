'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ProgramCode } from '@allingo/schemas/common';
import { usePathname, useRouter } from '@/i18n/navigation';
import { queryKeys, useUpdateMe } from '@/lib/queries';
import { PROGRAM_PAGES, programHref, type ProgramPage } from './program-context';

/** Trang khu học hiện tại (`/toeic/plan` → 'plan'); trang ngoài khu học → null */
export function currentProgramPage(pathname: string): ProgramPage | null {
  const m = /^\/[^/]+\/([^/?#]+)/.exec(pathname);
  const page = m?.[1];
  return page && (PROGRAM_PAGES as readonly string[]).includes(page) ? (page as ProgramPage) : null;
}

/**
 * C1 – đổi chương trình đang học: PATCH /me {active_program} (iam.users.active_program; API tạo enrollment nếu chưa có) → làm mới
 * dữ liệu theo chương trình → chuyển sang cùng trang của chương trình mới (đang ở /toeic/plan → /ielts/plan; trang chi tiết như
 * bộ từ → dashboard). Lỗi mạng vẫn chuyển trang (trang theo URL; lần sau chọn lại sẽ lưu).
 */
export function useSwitchProgram() {
  const update = useUpdateMe();
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const switchTo = React.useCallback(
    async (program: ProgramCode, opts: { page?: ProgramPage; navigate?: boolean } = {}) => {
      try {
        await update.mutateAsync({ active_program: program });
      } catch {
        // giữ chuyển trang – lựa chọn chưa lưu chỉ ảnh hưởng chương trình mặc định lần đăng nhập sau
      }
      void qc.invalidateQueries({ queryKey: queryKeys.enrollments });
      // Trang không thuộc khu học (Cài đặt) giữ nguyên chỗ – ngữ cảnh chương trình đổi theo me.active_program
      if (opts.navigate === false) return;
      const sub = pathname.split('/').length > 3 ? null : currentProgramPage(pathname);
      router.push(programHref(program, opts.page ?? sub ?? 'dashboard'));
    },
    [pathname, qc, router, update],
  );
  return { switchTo, isPending: update.isPending };
}
