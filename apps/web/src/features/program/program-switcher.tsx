'use client';

import { useTranslations } from 'next-intl';
import { isProgramCode, PROGRAM_LIST } from '@allingo/schemas/program/registry';
import { NativeSelect, cn } from '@allingo/ui';
import { usePrograms } from '@/lib/queries';
import { useProgram } from './program-context';
import { useSwitchProgram } from './use-switch-program';

/**
 * C1 – bộ chọn chương trình (dải đầu nội dung khu học, trang Cài đặt): danh sách theo registry, nhãn "sắp ra mắt"
 * theo `GET /programs` (chưa tải → theo cờ ra mắt mặc định: chỉ TOEIC mở). Chọn → PATCH /me {active_program} → trang tương ứng.
 * `<select>` gốc: bàn phím/trình đọc màn hình/mobile dùng được, không cần thư viện menu.
 */
export function ProgramSwitcher({ className, id, navigate = true }: { className?: string; id?: string; navigate?: boolean }) {
  const t = useTranslations('programArea');
  const tp = useTranslations('programs');
  const program = useProgram();
  const programs = usePrograms();
  const { switchTo, isPending } = useSwitchProgram();
  const statusOf = (code: string) => programs.data?.find((p) => p.code === code)?.status ?? (code === 'toeic' ? 'available' : 'coming_soon');
  return (
    <NativeSelect
      id={id}
      aria-label={t('switcherLabel')}
      className={cn('h-9 w-auto font-semibold', className)}
      value={program}
      disabled={isPending}
      data-testid="program-switcher"
      onChange={(e) => {
        const next = e.target.value;
        if (isProgramCode(next) && next !== program) void switchTo(next, { navigate });
      }}
    >
      {PROGRAM_LIST.map((p) => (
        <option key={p.code} value={p.code}>
          {statusOf(p.code) === 'available' ? tp(p.code) : t('optionSoon', { program: tp(p.code) })}
        </option>
      ))}
    </NativeSelect>
  );
}
