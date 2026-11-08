'use client';

import { Button, useConfig, useDocumentInfo } from '@payloadcms/ui';
import { useRouter } from 'next/navigation';
import React from 'react';

/** A26: nút "Trình dựng kéo thả" trong edit view của test_sets → /admin/test-set-builder?id=<id> */
export const TestSetBuilderLink: React.FC = () => {
  const { id, collectionSlug } = useDocumentInfo();
  const { config } = useConfig();
  const router = useRouter();
  if (collectionSlug !== 'test_sets') return null;
  return (
    <Button buttonStyle="secondary" size="medium" disabled={!id} tooltip={id ? 'Sắp xếp Part/nhóm/câu bằng kéo thả, thêm câu từ ngân hàng, kiểm tra blueprint' : 'Lưu bộ đề trước'} onClick={() => router.push(`${config.routes.admin}/test-set-builder?id=${encodeURIComponent(String(id))}`)}>
      Trình dựng kéo thả
    </Button>
  );
};
