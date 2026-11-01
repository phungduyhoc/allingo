'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Dialog/Sheet dựng trên phần tử <dialog> gốc của trình duyệt (showModal):
 * có sẵn focus trap, lớp phủ, Esc đóng, inert nền – không phụ thuộc thư viện ngoài.
 */

interface DialogContextValue {
  titleId: string;
  descriptionId: string;
  close: () => void;
}
const DialogContext = React.createContext<DialogContextValue | null>(null);

export interface DialogProps extends Omit<React.ComponentProps<'dialog'>, 'open' | 'title'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** center: hộp thoại giữa màn; right/bottom: dạng Sheet trượt từ cạnh */
  side?: 'center' | 'right' | 'bottom';
  /** Cho phép đóng khi bấm nền (mặc định true) */
  dismissible?: boolean;
}

export function Dialog({ open, onOpenChange, side = 'center', dismissible = true, className, children, ...props }: DialogProps) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <DialogContext.Provider value={{ titleId, descriptionId, close }}>
      <dialog
        ref={ref}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(e) => {
          e.preventDefault();
          if (dismissible) close();
        }}
        onClose={close}
        onClick={(e) => {
          if (dismissible && e.target === e.currentTarget) close();
        }}
        className={cn(
          'fixed inset-0 z-50 m-auto max-h-none max-w-none bg-card p-0 text-foreground shadow-2xl outline-none backdrop:bg-navy/60 backdrop:backdrop-blur-[2px]',
          'open:animate-in open:fade-in-0 open:duration-200 motion-reduce:open:animate-none',
          side === 'center' && 'w-[calc(100%-2rem)] max-w-lg rounded-xl border border-border open:zoom-in-95',
          side === 'right' && 'mr-0 h-full w-full max-w-sm rounded-none border-l border-border open:slide-in-from-right',
          side === 'bottom' && 'mb-0 max-h-[85vh] w-full rounded-t-xl border-t border-border open:slide-in-from-bottom',
          className,
        )}
        {...props}
      >
        {open ? children : null}
      </dialog>
    </DialogContext.Provider>
  );
}

export function DialogContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-content" className={cn('flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6', className)} {...props} />;
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  const ctx = React.useContext(DialogContext);
  return <h2 id={ctx?.titleId} data-slot="dialog-title" className={cn('text-lg leading-tight font-semibold', className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const ctx = React.useContext(DialogContext);
  return <p id={ctx?.descriptionId} data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export function DialogClose({ className, children, ...props }: React.ComponentProps<'button'>) {
  const ctx = React.useContext(DialogContext);
  return (
    <button
      type="button"
      onClick={() => ctx?.close()}
      className={cn(
        'absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40',
        className,
      )}
      {...props}
    >
      {children ?? <X className="size-4" aria-hidden />}
    </button>
  );
}

/** Sheet = Dialog trượt từ cạnh phải (desktop) hoặc đáy (mobile) */
export function Sheet({ side = 'right', ...props }: DialogProps) {
  return <Dialog side={side} {...props} />;
}
