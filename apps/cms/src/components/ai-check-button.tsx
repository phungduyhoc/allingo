'use client';

import { Button, toast, useConfig, useDocumentInfo, useField, useFormModified } from '@payloadcms/ui';
import React, { useState } from 'react';

/**
 * Nút "Gửi AI kiểm tra" trong edit view của `questions` → POST /api/questions/:id/ai-check.
 * Thành công: cập nhật field status/aiReport trên form (không đánh dấu form modified).
 * API nội bộ chưa chạy: toast lỗi, giữ nguyên trạng thái.
 */
interface AiCheckResponse {
  status?: string;
  aiReport?: { verdict?: string; issues?: Array<{ severity: string; message: string; field?: string }> };
  error?: { message?: string };
}

export const AiCheckButton: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo();
  const modified = useFormModified();
  const { config } = useConfig();
  const status = useField<string>({ path: 'status' });
  const aiReport = useField<unknown>({ path: 'aiReport' });
  const [busy, setBusy] = useState(false);

  if (collectionSlug !== 'questions') return null;

  const current = status.value ?? 'draft';
  const canCheck = current === 'draft' || current === 'ai_checked' || current === 'rejected';

  const run = async () => {
    if (!id) {
      toast.error('Hãy lưu câu hỏi trước khi gửi AI kiểm tra.');
      return;
    }
    if (modified) {
      toast.warning('Có thay đổi chưa lưu – lưu trước rồi gửi AI kiểm tra để kiểm đúng nội dung.');
      return;
    }
    setBusy(true);
    try {
      const url = `${config.serverURL ?? ''}${config.routes.api}/questions/${String(id)}/ai-check`;
      const res = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
      const body = (await res.json().catch(() => ({}))) as AiCheckResponse;
      if (!res.ok) {
        toast.error(body.error?.message ?? `AI kiểm tra thất bại (HTTP ${res.status}).`);
        return;
      }
      const verdict = body.aiReport?.verdict ?? 'unknown';
      const issues = body.aiReport?.issues ?? [];
      if (body.status) status.setValue(body.status, true);
      if (body.aiReport) aiReport.setValue(body.aiReport, true);
      const summary = issues.length ? ` – ${issues.length} ghi chú: ${issues.slice(0, 2).map((i) => i.message).join('; ')}` : '';
      if (verdict === 'fail') toast.error(`AI kết luận FAIL${summary}`);
      else if (verdict === 'needs_change') toast.warning(`AI: cần chỉnh sửa (needs_change)${summary}. Trạng thái: ${body.status ?? ''}`);
      else toast.success(`AI: PASS${summary}. Trạng thái: ${body.status ?? ''}`);
    } catch (err) {
      toast.error(`Không gọi được AI kiểm tra: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button buttonStyle="secondary" size="medium" disabled={busy || !canCheck} onClick={() => void run()} tooltip={canCheck ? 'Gọi task check_question qua API nội bộ' : 'Chỉ dùng khi ở trạng thái nháp / AI đã kiểm tra / từ chối'}>
      {busy ? 'Đang gửi AI kiểm tra…' : 'Gửi AI kiểm tra'}
    </Button>
  );
};
