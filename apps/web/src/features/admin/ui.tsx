'use client';

import * as React from 'react';
import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { Button, cn, Input, Label, NativeSelect, Spinner } from '@allingo/ui';
import type { Page } from '@/lib/types';
import { ErrorState } from '@/components/states';

/** Khối dựng dùng chung của trang billing admin: danh sách cursor, bảng cuộn ngang trên mobile, bộ lọc, ô thời gian */

/** S12: kiểu trang `P` giữ trường thêm của trang đầu (`counts`, `today`, `computed_at`…) – hàng suy ra từ `P['data']` */
export function useCursorList<P extends Page<unknown>>(key: QueryKey, fetcher: (cursor: string | null) => Promise<P>) {
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => fetcher(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
  });
  const rows = (q.data?.pages.flatMap((p) => p.data) ?? []) as P['data'];
  return { q, rows };
}

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowTestId,
  rowAttrs,
  empty,
  list,
  label,
}: {
  /** Tên vùng bảng cho trình đọc màn hình (mặc định "Bảng dữ liệu") */
  label?: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowTestId?: string;
  rowAttrs?: (row: T) => Record<string, string>;
  empty: string;
  list?: { q: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown } };
}) {
  const tc = useTranslations('common');
  if (list?.q.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }
  if (list?.q.isError) return <ErrorState error={list.q.error} onRetry={() => void list.q.refetch()} />;
  return (
    <div className="space-y-3">
      {/* S12 (axe scrollable-region-focusable): vùng cuộn ngang tới được bằng bàn phím + có tên */}
      <div className="overflow-x-auto rounded-xl border border-border focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none" tabIndex={0} role="region" aria-label={label ?? tc('dataTable')}>
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn('px-3 py-2.5 font-semibold whitespace-nowrap', c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={rowKey(r)} className="border-t border-border align-top" data-testid={rowTestId} {...(rowAttrs?.(r) ?? {})}>
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2.5', c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {list?.q.hasNextPage ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={list.q.isFetchingNextPage} onClick={() => void list.q.fetchNextPage()}>
            {list.q.isFetchingNextPage ? <Spinner aria-hidden /> : null}
            {tc('next')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Thanh lọc: các ô nhập; "Áp dụng" mới đổi bộ lọc (tránh gọi API mỗi phím) */
export function FilterBar<F extends Record<string, string>>({
  value,
  onApply,
  fields,
  testId,
}: {
  value: F;
  onApply: (v: F) => void;
  fields: { name: keyof F & string; label: string; type?: 'text' | 'date' | 'select'; options?: { value: string; label: string }[]; placeholder?: string }[];
  testId?: string;
}) {
  const t = useTranslations('admin');
  const [draft, setDraft] = React.useState<F>(value);
  const id = React.useId();
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(draft);
      }}
      data-testid={testId}
    >
      {fields.map((f) => (
        <div key={f.name} className="space-y-1">
          <Label htmlFor={`${id}-${f.name}`} className="text-xs">
            {f.label}
          </Label>
          {f.type === 'select' ? (
            <NativeSelect id={`${id}-${f.name}`} value={draft[f.name]} onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })} className="h-9 w-40" data-testid={`filter-${f.name}`}>
              <option value="">{t('any')}</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={`${id}-${f.name}`}
              type={f.type ?? 'text'}
              value={draft[f.name]}
              placeholder={f.placeholder}
              onChange={(e) => setDraft({ ...draft, [f.name]: e.target.value })}
              className={cn('h-9', f.type === 'date' ? 'w-40' : 'w-64')}
              data-testid={`filter-${f.name}`}
            />
          )}
        </div>
      ))}
      <Button type="submit" variant="navy" size="sm" className="h-9" data-testid="filter-apply">
        {t('apply')}
      </Button>
    </form>
  );
}

export function When({ iso }: { iso: string | null | undefined }) {
  const fmt = useFormatter();
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return <span className="whitespace-nowrap">{fmt.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' })}</span>;
}

export function ShortId({ id, onClick, title }: { id: string | null | undefined; onClick?: () => void; title?: string }) {
  if (!id) return <span className="text-muted-foreground">—</span>;
  const text = <code className="font-mono text-xs">{id.slice(0, 8)}</code>;
  return onClick ? (
    <button type="button" onClick={onClick} title={title ?? id} className="rounded px-0.5 text-primary underline-offset-2 hover:underline">
      {text}
    </button>
  ) : (
    <span title={id}>{text}</span>
  );
}
