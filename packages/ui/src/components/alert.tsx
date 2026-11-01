import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/utils';

export const alertVariants = cva('relative grid w-full gap-1 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 [&>svg]:mt-0.5 [&>svg]:size-4', {
  variants: {
    variant: {
      default: 'border-border bg-card text-foreground',
      info: 'border-primary/30 bg-primary/5 text-foreground',
      gold: 'border-accent/60 bg-accent/10 text-foreground',
      success: 'border-success/40 bg-success/10 text-foreground',
      destructive: 'border-destructive/40 bg-destructive/5 text-foreground [&>svg]:text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

export function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 font-semibold', className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('col-start-2 text-muted-foreground', className)} {...props} />;
}
