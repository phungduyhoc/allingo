import * as React from 'react';
import { cn } from '../lib/utils';

export interface ProgressProps extends React.ComponentProps<'div'> {
  /** 0–100 */
  value: number;
  /** Màu thanh: primary | gold | success */
  tone?: 'primary' | 'gold' | 'success';
  label?: string;
}

export function Progress({ className, value, tone = 'primary', label, ...props }: ProgressProps) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const barClass = tone === 'gold' ? 'bg-accent' : tone === 'success' ? 'bg-success' : 'bg-primary';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      data-slot="progress"
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-300', barClass)} style={{ width: `${v}%` }} />
    </div>
  );
}
