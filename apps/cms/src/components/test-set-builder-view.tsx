import type { AdminViewServerProps } from 'payload';
import { DefaultTemplate } from '@payloadcms/next/templates';
import { Gutter } from '@payloadcms/ui';
import { redirect } from 'next/navigation';
import React from 'react';
import { TestSetBuilderClient } from './test-set-builder-client';

/** A26 – trang admin "Trình dựng bộ đề" (/admin/test-set-builder?id=…) – server component bọc DefaultTemplate */
export function TestSetBuilderView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult;
  const adminRoute = req.payload.config.routes.admin;
  const id = typeof searchParams?.id === 'string' ? searchParams.id : null;
  if (!req.user) {
    redirect(`${adminRoute}/login?redirect=${encodeURIComponent(`${adminRoute}/test-set-builder${id ? `?id=${id}` : ''}`)}`);
  }
  const apiBase = `${req.payload.config.serverURL ?? ''}${req.payload.config.routes.api}`;
  return (
    <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={req.payload} permissions={permissions} searchParams={searchParams} user={req.user ?? undefined} visibleEntities={visibleEntities}>
      <Gutter>
        <h1>Trình dựng bộ đề (kéo thả)</h1>
        <p className="allingo-muted">
          Kéo thả (hoặc dùng nút ↑/↓ bằng bàn phím) để sắp xếp Part, nhóm câu cùng đoạn văn và từng câu; thêm câu từ ngân hàng; bớt câu; kiểm tra blueprint (đủ số câu mỗi Part) trước khi xuất bản. Lưu → bộ đề được kiểm tra cấu trúc và phát hành sang catalog như khi sửa trực tiếp.
        </p>
        <TestSetBuilderClient apiBase={apiBase} adminRoute={adminRoute} testSetId={id} />
      </Gutter>
    </DefaultTemplate>
  );
}
