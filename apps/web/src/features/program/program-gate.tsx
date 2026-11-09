'use client';

import * as React from 'react';
import { isProgramCode, programDef } from '@allingo/schemas/program/registry';
import { Spinner } from '@allingo/ui';
import { usePrograms } from '@/lib/queries';
import { ProgramProvider } from './program-context';
import { ProgramComingSoon } from './program-coming-soon';

/**
 * C1 – cổng khu học theo chương trình (mọi trang `/[program]/…`): đặt ngữ cảnh chương trình cho cây con; chương trình chưa có nội
 * dung/chưa ra mắt (`GET /programs` → status `coming_soon`) hiện trang "sắp ra mắt" + đăng ký chờ thay cho nội dung (không 404).
 * Mã chương trình sai đã bị proxy trả HTTP 404 trước khi tới đây (app-routes.ts, như S152).
 * TOEIC (không có cờ ra mắt) hiển thị ngay, không chờ `GET /programs` – giữ nguyên hành vi GĐ1.
 */
export function ProgramGate({ program, children }: { program: string; children: React.ReactNode }) {
  const def = isProgramCode(program) ? programDef(program) : null;
  const alwaysOpen = def?.launch_flag === null;
  const programs = usePrograms({ enabled: !!def && !alwaysOpen });
  if (!def) return <ProgramComingSoon program={null} />;
  if (alwaysOpen) return <ProgramProvider program={def.code}>{children}</ProgramProvider>;
  if (programs.isPending)
    return (
      <div className="flex justify-center py-16" data-testid="program-gate-loading">
        <Spinner className="size-6" />
      </div>
    );
  const status = programs.data?.find((p) => p.code === def.code)?.status;
  return <ProgramProvider program={def.code}>{status === 'available' ? children : <ProgramComingSoon program={def.code} />}</ProgramProvider>;
}
