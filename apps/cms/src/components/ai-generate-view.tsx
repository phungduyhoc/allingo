import type { AdminViewServerProps } from 'payload';
import { DefaultTemplate } from '@payloadcms/next/templates';
import { Gutter } from '@payloadcms/ui';
import { redirect } from 'next/navigation';
import React from 'react';
import { AiGenerateViewClient } from './ai-generate-view-client';

/** Trang admin "Sinh câu hỏi bằng AI" (/admin/ai-generate) – Sprint 5 */
export function AiGenerateView({ initPageResult, params, searchParams }: AdminViewServerProps) {
  const { req, permissions, visibleEntities, locale } = initPageResult;
  const adminRoute = req.payload.config.routes.admin;
  if (!req.user) {
    redirect(`${adminRoute}/login?redirect=${encodeURIComponent(`${adminRoute}/ai-generate`)}`);
  }
  const apiBase = `${req.payload.config.serverURL ?? ''}${req.payload.config.routes.api}`;
  return (
    <DefaultTemplate i18n={req.i18n} locale={locale} params={params} payload={req.payload} permissions={permissions} searchParams={searchParams} user={req.user ?? undefined} visibleEntities={visibleEntities}>
      <Gutter>
        <h1>Sinh câu hỏi bằng AI</h1>
        <p className="allingo-muted">
          AI (task <code>generate_questions</code>) viết câu GỐC theo định dạng Part đã chọn; mỗi câu vào trạng thái <strong>Nháp</strong> với nguồn <code>ai</code>, được <code>check_question</code> kiểm tra tự động và so trùng (embedding cosine ≥ 0,92 với câu đã phát hành, trigram ≥ 0,85). Câu nghi trùng được gắn cờ – hãy sửa hoặc từ chối trước khi gửi duyệt. Mọi câu vẫn qua duyệt 2 vòng như bình thường.
        </p>
        <AiGenerateViewClient apiBase={apiBase} adminRoute={adminRoute} />
      </Gutter>
    </DefaultTemplate>
  );
}
