import type { AdminViewServerProps } from 'payload';
import { DefaultTemplate } from '@payloadcms/next/templates';
import { Gutter } from '@payloadcms/ui';
import { redirect } from 'next/navigation';
import React from 'react';
import { ImportViewClient } from './import-view-client';

/** Trang admin "Nhập câu hỏi" (/admin/import-questions) – server component bọc DefaultTemplate */
export function ImportView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult;
  const adminRoute = req.payload.config.routes.admin;
  if (!req.user) {
    redirect(`${adminRoute}/login?redirect=${encodeURIComponent(`${adminRoute}/import-questions`)}`);
  }
  const apiBase = `${req.payload.config.serverURL ?? ''}${req.payload.config.routes.api}`;
  return (
    <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={req.payload} permissions={permissions} searchParams={searchParams} user={req.user ?? undefined} visibleEntities={visibleEntities}>
      <Gutter>
        <h1>Nhập câu hỏi hàng loạt</h1>
        <p className="allingo-muted">
          Tải lên tệp JSON (mọi dạng câu) hoặc CSV (mcq_single). Mỗi dòng hợp lệ tạo một câu hỏi ở trạng thái <strong>Nháp</strong>; dòng lỗi được liệt kê bên dưới. Mẫu: <code>apps/cms/samples/questions.sample.json</code>, <code>questions.sample.csv</code>; mô tả cột: <code>apps/cms/docs/import-template.md</code>.
        </p>
        <ImportViewClient apiBase={apiBase} adminRoute={adminRoute} />
      </Gutter>
    </DefaultTemplate>
  );
}
