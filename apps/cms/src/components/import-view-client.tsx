'use client';

import { Button, toast } from '@payloadcms/ui';
import React, { useState } from 'react';

interface ImportReport {
  format: 'json' | 'csv';
  total: number;
  inserted: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
  insertedIds: string[];
  dryRun: boolean;
}

/** Phần client của trang nhập: chọn tệp → đọc text → POST /api/questions/import → hiển thị báo cáo */
export const ImportViewClient: React.FC<{ apiBase: string; adminRoute: string }> = ({ apiBase, adminRoute }) => {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [format, setFormat] = useState<'auto' | 'json' | 'csv'>('auto');
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);

  const onFile = async (f: File | null) => {
    setFile(f);
    setReport(null);
    if (f) setText(await f.text());
  };

  const submit = async (dryRun: boolean) => {
    if (!text.trim()) {
      toast.error('Chọn tệp hoặc dán nội dung trước.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/questions/import`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, fileName: file?.name, format: format === 'auto' ? undefined : format, dryRun }),
      });
      const body = (await res.json().catch(() => null)) as ImportReport | { error?: { message?: string } } | null;
      if (!res.ok || !body || !('total' in body)) {
        const msg = body && 'error' in body ? (body.error?.message ?? '') : '';
        toast.error(`Nhập thất bại (HTTP ${res.status}). ${msg}`);
        return;
      }
      setReport(body);
      if (dryRun) toast.info(`Kiểm tra xong: ${body.inserted} dòng hợp lệ, ${body.errors.length} lỗi.`);
      else if (body.errors.length) toast.warning(`Đã tạo ${body.inserted} câu, ${body.errors.length} dòng lỗi.`);
      else toast.success(`Đã tạo ${body.inserted} câu hỏi (nháp).`);
    } catch (err) {
      toast.error(`Lỗi mạng: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="allingo-card">
        <div className="allingo-grid allingo-grid--2">
          <div>
            <label className="field-label" htmlFor="allingo-import-file">
              Tệp JSON/CSV
            </label>
            <input id="allingo-import-file" type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <label className="field-label" htmlFor="allingo-import-format">
              Định dạng
            </label>
            <select id="allingo-import-format" className="allingo-input" value={format} onChange={(e) => setFormat(e.target.value as 'auto' | 'json' | 'csv')}>
              <option value="auto">Tự nhận (theo đuôi tệp / nội dung)</option>
              <option value="json">JSON</option>
              <option value="csv">CSV (mcq_single)</option>
            </select>
          </div>
        </div>
        <label className="field-label" htmlFor="allingo-import-text" style={{ marginTop: 12 }}>
          Hoặc dán nội dung
        </label>
        <textarea id="allingo-import-text" className="allingo-textarea allingo-textarea--code" style={{ minHeight: 200 }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="allingo-actions">
          <Button buttonStyle="secondary" disabled={busy} onClick={() => void submit(true)}>
            Kiểm tra (không ghi)
          </Button>
          <Button buttonStyle="primary" disabled={busy} onClick={() => void submit(false)}>
            {busy ? 'Đang nhập…' : 'Nhập vào CMS'}
          </Button>
        </div>
      </div>

      {report ? (
        <div className="allingo-card">
          <h3>
            Kết quả {report.dryRun ? '(kiểm tra)' : ''} – định dạng {report.format.toUpperCase()}
          </h3>
          <p>
            Tổng dòng: <strong>{report.total}</strong> · {report.dryRun ? 'Hợp lệ' : 'Đã tạo'}: <strong>{report.inserted}</strong> · Bỏ qua (trùng import_key): <strong>{report.skipped}</strong> · Lỗi: <strong>{report.errors.length}</strong>
          </p>
          {report.errors.length ? (
            <table className="allingo-table">
              <thead>
                <tr>
                  <th style={{ width: 80 }}>Dòng</th>
                  <th>Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((e, i) => (
                  <tr key={`${e.row}-${i}`}>
                    <td>{e.row}</td>
                    <td>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {!report.dryRun && report.inserted > 0 ? (
            <p style={{ marginTop: 12 }}>
              <a href={`${adminRoute}/collections/questions?where[status][equals]=draft`}>Mở danh sách câu hỏi nháp →</a>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
