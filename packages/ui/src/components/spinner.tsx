import * as React from 'react';
import { cn } from '../lib/utils';

export function Spinner({ className, label, ...props }: React.ComponentProps<'span'> & { label?: string }) {
  return (
    <span role="status" aria-label={label} data-slot="spinner" className={cn('inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} {...props} />
  );
}
