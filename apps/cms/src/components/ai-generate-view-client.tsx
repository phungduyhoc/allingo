'use client';

import { Button, toast } from '@payloadcms/ui';
import React, { useEffect, useRef, useState } from 'react';

interface Item {
  index: number;
  cmsId: string | null;
  externalRef: string | null;
  status: 'created' | 'invalid';
  workflowStatus: string | null;
  verdict: 'pass' | 'needs_change' | 'fail' | null;
  duplicate: { flagged: boolean; method: string | null; of_question_id: string | null; of_index: number | null; similarity: number | null };
  stem: string;
  imported: boolean;
  errors: string[];
}
interface StatusResponse {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: Record<string, unknown> | null;
  error?: string | null;
  summary?: { created?: number; invalid?: number; flagged_duplicates?: number; mock?: boolean; embedding_model?: string };
  items?: Item[];
}

const PARTS: Array<{ value: string; label: string }> = [
  { value: 'part5', label: 'TOEIC Part 5 – Hoàn thành câu' },
  { value: 'part6', label: 'TOEIC Part 6 – Hoàn thành đoạn văn' },
  { value: 'part7', label: 'TOEIC Part 7 – Đọc hiểu' },
];
const LEVELS = ['A2', 'B1', 'B2', 'C1'];

const verdictBadge = (v: Item['verdict']) => (v === 'pass' ? 'allingo-badge allingo-badge--pass' : v === 'fail' ? 'allingo-badge allingo-badge--fail' : 'allingo-badge allingo-badge--warn');

/** Form sinh câu → POST /api/questions/ai-generate → polling GET …/:jobId (CMS tự nhập câu khi job xong) */
export const AiGenerateViewClient: React.FC<{ apiBase: string; adminRoute: string }> = ({ apiBase, adminRoute }) => {
  const [sectionCode, setSection] = useState('part5');
  const [topic, setTopic] = useState('logistics');
  const [difficulty, setDifficulty] = useState('B1');
  const [count, setCount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<StatusResponse | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const poll = async (jobId: string, attempt = 0) => {
    try {
      const res = await fetch(`${apiBase}/questions/ai-generate/${jobId}`, { credentials: 'include' });
      const body = (await res.json().catch(() => null)) as StatusResponse | null;
      if (!res.ok || !body) {
        const errMsg = (body as { error?: { message?: string } } | null)?.error?.message ?? '';
        toast.error(`Không đọc được trạng thái (HTTP ${res.status}). ${errMsg}`);
        setBusy(false);
        return;
      }
      setState(body);
      if (body.status === 'completed') {
        setBusy(false);
        const s = body.summary ?? {};
        toast.success(`Đã tạo ${s.created ?? 0} câu nháp${s.flagged_duplicates ? `, ${s.flagged_duplicates} câu nghi trùng` : ''}.`);
        return;
      }
      if (body.status === 'failed') {
        setBusy(false);
        toast.error(`Sinh câu thất bại: ${typeof body.error === 'string' ? body.error : ''}`);
        return;
      }
      timer.current = setTimeout(() => void poll(jobId, attempt + 1), Math.min(4000, 800 + attempt * 200));
    } catch (err) {
      setBusy(false);
      toast.error(`Lỗi mạng: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const start = async () => {
    setBusy(true);
    setState(null);
    try {
      const res = await fetch(`${apiBase}/questions/ai-generate`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ program: 'toeic', sectionCode, questionType: 'mcq_single', topic: topic.trim() || undefined, difficulty, count }) });
      const body = (await res.json().catch(() => null)) as { jobId?: string; error?: { message?: string } } | null;
      if (!res.ok || !body?.jobId) {
        toast.error(`Không bắt đầu được (HTTP ${res.status}). ${body?.error?.message ?? ''}`);
        setBusy(false);
        return;
      }
      setState({ jobId: body.jobId, status: 'queued' });
      void poll(body.jobId);
    } catch (err) {
      setBusy(false);
      toast.error(`Lỗi mạng: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div>
      <div className="allingo-card">
        <div className="allingo-grid allingo-grid--2">
          <div>
            <label className="field-label" htmlFor="allingo-gen-section">
              Phần (Part)
            </label>
            <select id="allingo-gen-section" className="allingo-input" value={sectionCode} onChange={(e) => setSection(e.target.value)}>
              {PARTS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="allingo-gen-topic">
              Chủ đề
            </label>
            <input id="allingo-gen-topic" className="allingo-input" value={topic} maxLength={64} onChange={(e) => setTopic(e.target.value)} placeholder="logistics, hr, finance…" />
          </div>
          <div>
            <label className="field-label" htmlFor="allingo-gen-level">
              Độ khó (CEFR)
            </label>
            <select id="allingo-gen-level" className="allingo-input" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="allingo-gen-count">
              Số câu (1–50)
            </label>
            <input id="allingo-gen-count" className="allingo-input" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </div>
        </div>
        <div className="allingo-actions">
          <Button buttonStyle="primary" disabled={busy} onClick={() => void start()}>
            {busy ? 'Đang sinh câu…' : 'Sinh câu hỏi bằng AI'}
          </Button>
        </div>
        {state && state.status !== 'completed' ? (
          <p className="allingo-muted">
            Job {state.jobId}: {state.status}
            {state.progress ? ` – ${JSON.stringify(state.progress)}` : ''}
          </p>
        ) : null}
      </div>

      {state?.status === 'completed' && state.items ? (
        <div className="allingo-card">
          <h3>Kết quả – {state.summary?.created ?? 0} câu nháp · {state.summary?.flagged_duplicates ?? 0} nghi trùng · {state.summary?.invalid ?? 0} không hợp lệ{state.summary?.mock ? ' · (AI giả lập – chỉ để kiểm thử)' : ''}</h3>
          <table className="allingo-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Đề bài</th>
                <th style={{ width: 110 }}>AI kiểm tra</th>
                <th style={{ width: 210 }}>Trùng lặp</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((it) => (
                <tr key={it.index}>
                  <td>{it.index + 1}</td>
                  <td>
                    {it.stem || <em>(không có đề)</em>}
                    {it.errors.length ? <div className="allingo-muted">{it.errors.join('; ')}</div> : null}
                  </td>
                  <td>{it.verdict ? <span className={verdictBadge(it.verdict)}>{it.verdict}</span> : <span className="allingo-badge allingo-badge--fail">{it.status}</span>}</td>
                  <td>{it.duplicate.flagged ? <span className="allingo-badge allingo-badge--warn">⚠ {it.duplicate.method} {it.duplicate.similarity ?? ''}</span> : <span className="allingo-muted">không</span>}</td>
                  <td>{it.cmsId ? <a href={`${adminRoute}/collections/questions/${it.cmsId}`}>Mở →</a> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};
