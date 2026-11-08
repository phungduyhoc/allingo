'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

/** Tabs theo WAI-ARIA (roving tabindex, mũi tên trái/phải, Home/End) – không phụ thuộc thư viện ngoài */

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
  /** S11 (a11y): giá trị có TabsContent thật – `aria-controls` chỉ trỏ tới panel tồn tại (axe aria-valid-attr-value) */
  panels: ReadonlySet<string>;
  registerPanel: (v: string) => () => void;
}
const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error('Tabs components must be used within <Tabs>');
  return ctx;
}

export interface TabsProps extends Omit<React.ComponentProps<'div'>, 'defaultValue' | 'onChange'> {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export function Tabs({ value, defaultValue, onValueChange, className, ...props }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? '');
  const current = value ?? internal;
  const baseId = React.useId();
  const setValue = React.useCallback(
    (v: string) => {
      if (value === undefined) setInternal(v);
      onValueChange?.(v);
    },
    [value, onValueChange],
  );
  const [panels, setPanels] = React.useState<ReadonlySet<string>>(() => new Set());
  const registerPanel = React.useCallback((v: string) => {
    setPanels((p) => (p.has(v) ? p : new Set([...p, v])));
    return () =>
      setPanels((p) => {
        if (!p.has(v)) return p;
        const n = new Set(p);
        n.delete(v);
        return n;
      });
  }, []);
  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId, panels, registerPanel }}>
      <div data-slot="tabs" className={cn('flex flex-col gap-3', className)} {...props} />
    </TabsContext.Provider>
  );
}

export function TabsList({ className, onKeyDown, ...props }: React.ComponentProps<'div'>) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
    const idx = tabs.findIndex((t) => t === document.activeElement);
    if (idx < 0 || tabs.length === 0) return;
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  };
  return (
    <div
      role="tablist"
      data-slot="tabs-list"
      onKeyDown={handleKeyDown}
      className={cn('inline-flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1 text-muted-foreground', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ value, className, ...props }: React.ComponentProps<'button'> & { value: string }) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${ctx.baseId}-tab-${value}`}
      aria-selected={selected}
      aria-controls={ctx.panels.has(value) ? `${ctx.baseId}-panel-${value}` : undefined}
      tabIndex={selected ? 0 : -1}
      data-state={selected ? 'active' : 'inactive'}
      onClick={() => ctx.setValue(value)}
      className={cn(
        'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50',
        selected ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ value, className, ...props }: React.ComponentProps<'div'> & { value: string }) {
  const ctx = useTabs();
  const selected = ctx.value === value;
  const { registerPanel } = ctx;
  React.useEffect(() => registerPanel(value), [registerPanel, value]);
  return (
    <div
      role="tabpanel"
      id={`${ctx.baseId}-panel-${value}`}
      aria-labelledby={`${ctx.baseId}-tab-${value}`}
      hidden={!selected}
      tabIndex={0}
      data-slot="tabs-content"
      className={cn('outline-none', className)}
      {...props}
    />
  );
}
