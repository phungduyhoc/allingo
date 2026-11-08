import * as React from 'react';
import { cn } from '../lib/utils';

export interface ToggleChipProps extends Omit<React.ComponentProps<'button'>, 'onChange'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

/**
 * Nút bật/tắt dạng "chip" (aria-pressed) – chọn ngày học trong tuần, cảm nhận check-in, mức giờ học…
 * Dùng trong nhóm `role="group"` có nhãn; bàn phím: Tab tới từng chip, Space/Enter đổi trạng thái (nút gốc).
 */
export function ToggleChip({ pressed, onPressedChange, className, disabled, children, ...props }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      data-state={pressed ? 'on' : 'off'}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-9 min-w-11 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors outline-none select-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        pressed ? 'border-navy bg-navy text-navy-foreground dark:border-accent dark:bg-accent dark:text-accent-foreground' : 'border-input bg-card text-foreground hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
