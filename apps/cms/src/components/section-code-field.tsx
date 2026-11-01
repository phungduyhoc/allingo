'use client';

import type { TextFieldClientProps } from 'payload';
import { FieldDescription, FieldError, FieldLabel, useConfig, useField, useFormFields } from '@payloadcms/ui';
import React, { useEffect, useId, useState } from 'react';

/**
 * `questions.sectionCode`: ô nhập văn bản kèm datalist đổ từ `GET /api/questions/reference`
 * (API nội bộ → fallback tĩnh TOEIC part1–7). Lọc theo `program` đang chọn; vẫn cho phép gõ mã khác.
 */
interface ReferenceSection {
  program: string;
  code: string;
  name: string;
}

let cachedSections: ReferenceSection[] | null = null;
let cachedSource: string | null = null;

export const SectionCodeField: React.FC<TextFieldClientProps> = ({ field, path: pathFromProps, readOnly = false }) => {
  const { value, setValue, showError, errorMessage, path } = useField<string>({ path: pathFromProps });
  const program = useFormFields(([fields]) => fields?.program?.value);
  const { config } = useConfig();
  const [sections, setSections] = useState<ReferenceSection[]>(cachedSections ?? []);
  const [source, setSource] = useState<string | null>(cachedSource);
  const listId = useId();

  useEffect(() => {
    if (cachedSections) return;
    const url = `${config.serverURL ?? ''}${config.routes.api}/questions/reference`;
    fetch(url, { credentials: 'include' })
      .then(async (res) => (res.ok ? ((await res.json()) as { source?: string; sections?: ReferenceSection[] }) : null))
      .then((data) => {
        cachedSections = data?.sections ?? [];
        cachedSource = data?.source ?? 'static';
        setSections(cachedSections);
        setSource(cachedSource);
      })
      .catch(() => {
        cachedSections = [];
        cachedSource = 'unavailable';
        setSource('unavailable');
      });
  }, [config.routes.api, config.serverURL]);

  const filtered = sections.filter((s) => !program || s.program === program);

  return (
    <div className="field-type text" style={{ marginBottom: 'var(--base)' }}>
      <FieldLabel htmlFor={`field-${path}`} label={field.label ?? 'sectionCode'} required={field.required} path={path} />
      <input
        id={`field-${path}`}
        className="allingo-input"
        list={listId}
        type="text"
        value={value ?? ''}
        disabled={readOnly}
        placeholder="vd. part5"
        onChange={(e) => setValue(e.target.value.trim().toLowerCase())}
      />
      <datalist id={listId}>
        {filtered.map((s) => (
          <option key={`${s.program}:${s.code}`} value={s.code}>
            {s.name}
          </option>
        ))}
      </datalist>
      {showError && errorMessage ? <FieldError path={path} message={errorMessage} showError /> : null}
      <FieldDescription path={path} description={field.admin?.description} />
      <div className="allingo-muted">
        {source === 'api' ? 'Danh mục lấy từ API nội bộ.' : source === 'static' ? 'API nội bộ chưa chạy – dùng danh mục tĩnh.' : source === 'unavailable' ? 'Không tải được danh mục; nhập tay mã phần.' : 'Đang tải danh mục…'}
      </div>
    </div>
  );
};
