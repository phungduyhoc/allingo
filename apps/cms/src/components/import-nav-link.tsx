'use client';

import { useConfig } from '@payloadcms/ui';
import Link from 'next/link';
import React from 'react';

/** Liên kết "Nhập câu hỏi" trong thanh điều hướng admin */
export const ImportNavLink: React.FC = () => {
  const { config } = useConfig();
  return (
    <div className="nav__link" style={{ marginTop: 8 }}>
      <Link className="nav__link" href={`${config.routes.admin}/import-questions`} prefetch={false}>
        <span className="nav__link-label">Nhập câu hỏi (JSON/CSV)</span>
      </Link>
    </div>
  );
};
