'use client';

import { useConfig } from '@payloadcms/ui';
import Link from 'next/link';
import React from 'react';

/** Liên kết "Nhập câu hỏi", "Sinh câu hỏi bằng AI" (S5) và "Trình dựng bộ đề" (A26) trong thanh điều hướng admin */
export const ImportNavLink: React.FC = () => {
  const { config } = useConfig();
  return (
    <div className="nav__link" style={{ marginTop: 8 }}>
      <Link className="nav__link" href={`${config.routes.admin}/import-questions`} prefetch={false}>
        <span className="nav__link-label">Nhập câu hỏi (JSON/CSV)</span>
      </Link>
      <Link className="nav__link" href={`${config.routes.admin}/ai-generate`} prefetch={false} style={{ marginTop: 8 }}>
        <span className="nav__link-label">Sinh câu hỏi bằng AI</span>
      </Link>
      <Link className="nav__link" href={`${config.routes.admin}/test-set-builder`} prefetch={false} style={{ marginTop: 8 }}>
        <span className="nav__link-label">Trình dựng bộ đề (kéo thả)</span>
      </Link>
    </div>
  );
};
