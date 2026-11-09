'use client';

import { Button, toast } from '@payloadcms/ui';
import React, { useCallback, useEffect, useState } from 'react';
import {
  addQuestions,
  blueprintErrors,
  blueprintReport,
  blueprintsFor,
  builderSectionCodes,
  countsByMarks,
  countUnitLabel,
  marksOfContent,
  fromCollection,
  moveSection,
  moveUnit,
  pruneSections,
  removeQuestion,
  toCollectionData,
  unitsOf,
  type BankQuestion,
  type BuilderState,
} from '../lib/test-set-builder';
import { validateTestSetStructure, type TestSetKind } from '../lib/validate';
import { DIFFICULTY_CODES } from '../lib/reference';

interface LoadedTestSet {
  doc: TestSetDoc;
  state: BuilderState;
  questions: BankQuestion[];
}

interface TestSetDoc {
  id: string;
  code: string;
  program: string;
  kind: TestSetKind;
  status: 'draft' | 'published';
  title?: { vi?: string | null } | null;
  sections?: Array<{ sectionCode?: string | null; durationSec?: number | null }> | null;
  items?: Array<{ question?: unknown; sectionCode?: string | null; sortOrder?: number | null; groupKey?: string | null; points?: number | null }> | null;
  blueprint?: Array<{ sectionCode?: string | null; count?: number | null }> | null;
}
interface QuestionDoc {
  id: string;
  title?: string | null;
  sectionCode?: string | null;
  status?: string | null;
  difficulty?: string | null;
  passage?: unknown;
  content?: unknown;
}
interface StructureReport {
  ok: boolean;
  issues: Array<{ code: string; section?: string; message: string }>;
}

const toBank = (q: QuestionDoc): BankQuestion => ({
  id: String(q.id),
  title: q.title ?? String(q.id),
  sectionCode: q.sectionCode ?? '',
  status: q.status ?? 'draft',
  difficulty: q.difficulty ?? null,
  passageId: q.passage && typeof q.passage === 'object' && 'id' in q.passage ? String(q.passage.id) : typeof q.passage === 'string' ? q.passage : null,
  marks: marksOfContent(q.content),
});

/** Thông điệp lỗi Payload (ValidationError → errors[].data.errors[].message) */
function payloadError(body: unknown, status: number): string {
  const b = body as { errors?: Array<{ message?: string; data?: { errors?: Array<{ message?: string }> } }> } | null;
  const msgs = (b?.errors ?? []).flatMap((e) => (e.data?.errors?.length ? e.data.errors.map((x) => x.message ?? '') : [e.message ?? '']));
  return msgs.filter(Boolean).join(' ') || `HTTP ${status}`;
}

/** Kéo thả HTML5 trong một danh sách (`list` = khoá danh sách – không kéo chéo danh sách) */
function dragProps(list: string, index: number, onMove: (from: number, to: number) => void, over: string | null, setOver: (k: string | null) => void) {
  const key = `${list}:${index}`;
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', key);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (over !== key) setOver(key);
    },
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(null);
      const [fromList, fromIdx] = e.dataTransfer.getData('text/plain').split(':');
      if (fromList === list && fromIdx !== undefined) onMove(Number(fromIdx), index);
    },
    'data-drop-target': over === key ? 'true' : undefined,
  };
}

/**
 * A26 – trình dựng bộ đề kéo thả: sắp xếp Part / khối (câu đơn hoặc nhóm passage) bằng kéo thả hoặc nút ↑/↓ (bàn phím), bớt câu,
 * thêm câu từ ngân hàng (lọc chương trình/Part/độ khó/trạng thái/từ khoá), blueprint (đủ số câu mỗi Part), kiểm tra cấu trúc bằng
 * API (`/api/test_sets/validate-structure` → API nội bộ) rồi lưu/xuất bản qua REST của collection (hook hiện có phát hành catalog).
 */
export const TestSetBuilderClient: React.FC<{ apiBase: string; adminRoute: string; testSetId: string | null }> = ({ apiBase, adminRoute, testSetId }) => {
  const [sets, setSets] = useState<Array<{ id: string; code: string; status: string }>>([]);
  const [doc, setDoc] = useState<TestSetDoc | null>(null);
  const [state, setState] = useState<BuilderState>({ sections: [], items: [] });
  const [known, setKnown] = useState<Map<string, BankQuestion>>(new Map());
  const [blueprint, setBlueprint] = useState<Array<{ sectionCode: string; count: number }>>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [apiReport, setApiReport] = useState<StructureReport | null>(null);
  const [bankFilter, setBankFilter] = useState({ section: 'part5', difficulty: '', status: 'published', q: '' });
  const [bank, setBank] = useState<BankQuestion[]>([]);
  const [bankBusy, setBankBusy] = useState(false);

  const update = useCallback((next: BuilderState) => {
    setState(next);
    setDirty(true);
    setApiReport(null);
  }, []);

  // Danh sách bộ đề để chọn (khi chưa có ?id=)
  useEffect(() => {
    if (testSetId) return;
    void fetch(`${apiBase}/test_sets?limit=50&depth=0&sort=-updatedAt`, { credentials: 'include' })
      .then((r) => r.json())
      .then((b: { docs?: Array<{ id: string; code: string; status: string }> }) => setSets(b.docs ?? []))
      .catch(() => setSets([]));
  }, [apiBase, testSetId]);

  const loadQuestions = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return [] as BankQuestion[];
      const qs = new URLSearchParams({ limit: String(Math.min(ids.length, 500)), depth: '0' });
      ids.forEach((id, i) => qs.append(`where[id][in][${i}]`, id));
      const r = await fetch(`${apiBase}/questions?${qs.toString()}`, { credentials: 'include' });
      const b = (await r.json()) as { docs?: QuestionDoc[] };
      return (b.docs ?? []).map(toBank);
    },
    [apiBase],
  );

  // Tải bộ đề + câu hỏi (không setState) → áp vào state; effect chỉ setState trong callback bất đồng bộ (react-hooks v7)
  const fetchTestSet = useCallback(async (): Promise<LoadedTestSet | null> => {
    if (!testSetId) return null;
    const r = await fetch(`${apiBase}/test_sets/${encodeURIComponent(testSetId)}?depth=0`, { credentials: 'include' });
    if (!r.ok) {
      toast.error(`Không tải được bộ đề (HTTP ${r.status}).`);
      return null;
    }
    const d = (await r.json()) as TestSetDoc;
    const st = fromCollection(d);
    const qs = await loadQuestions(st.items.map((i) => i.question));
    return { doc: d, state: st, questions: qs };
  }, [apiBase, testSetId, loadQuestions]);

  const applyLoaded = useCallback((x: LoadedTestSet | null) => {
    if (!x) return;
    setDoc(x.doc);
    setState(x.state);
    setBlueprint((x.doc.blueprint ?? []).filter((b) => b.sectionCode && b.count).map((b) => ({ sectionCode: b.sectionCode!, count: b.count! })));
    setBankFilter((f) => (builderSectionCodes(x.doc.program).includes(f.section) ? f : { ...f, section: builderSectionCodes(x.doc.program)[0] ?? '' }));
    setKnown(new Map(x.questions.map((q) => [q.id, q])));
    setDirty(false);
  }, []);

  const load = useCallback(async () => {
    applyLoaded(await fetchTestSet());
  }, [fetchTestSet, applyLoaded]);

  useEffect(() => {
    let alive = true;
    void fetchTestSet().then((x) => {
      if (alive) applyLoaded(x);
    });
    return () => {
      alive = false;
    };
  }, [fetchTestSet, applyLoaded]);

  const searchBank = async () => {
    if (!doc) return;
    setBankBusy(true);
    try {
      const qs = new URLSearchParams({ limit: '30', depth: '0', sort: '-updatedAt' });
      qs.set('where[program][equals]', doc.program);
      if (bankFilter.section) qs.set('where[sectionCode][equals]', bankFilter.section);
      if (bankFilter.difficulty) qs.set('where[difficulty][equals]', bankFilter.difficulty);
      if (bankFilter.status) qs.set('where[status][equals]', bankFilter.status);
      if (bankFilter.q.trim()) qs.set('where[title][like]', bankFilter.q.trim());
      const r = await fetch(`${apiBase}/questions?${qs.toString()}`, { credentials: 'include' });
      const b = (await r.json()) as { docs?: QuestionDoc[] };
      const found = (b.docs ?? []).map(toBank);
      setBank(found);
      setKnown((k) => new Map([...k, ...found.map((q) => [q.id, q] as const)]));
    } catch (err) {
      toast.error(`Không tìm được câu: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBankBusy(false);
    }
  };

  const add = (qs: BankQuestion[]) => {
    const r = addQuestions(state, qs);
    if (r.added) update(r.state);
    toast.success(`Đã thêm ${r.added} câu.`);
  };

  const shapeItems = toCollectionData(state).items;
  const localIssues = doc ? validateTestSetStructure({ program: doc.program, kind: doc.kind, sections: state.sections, items: shapeItems.map((i) => ({ question: i.question, sectionCode: i.sectionCode, sortOrder: i.sortOrder, groupKey: i.groupKey })) }) : [];
  // C3: IELTS đếm theo câu hỏi (mục đánh số – markCount) thay vì câu catalog
  const perItem = countsByMarks(doc?.program);
  const unit = countUnitLabel(doc?.program);
  const marksOf = (qid: string) => known.get(qid)?.marks ?? 1;
  const countOf = (items: ReadonlyArray<{ question: string }>) => (perItem ? items.reduce((n, it) => n + marksOf(it.question), 0) : items.length);
  const bp = blueprint.length ? blueprintReport(blueprint, state, perItem ? marksOf : undefined) : null;
  const bpErrors = bp ? blueprintErrors(bp, unit) : [];
  const unpublished = state.items.filter((i) => (known.get(i.question)?.status ?? 'published') !== 'published');

  const checkApi = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const r = await fetch(`${apiBase}/test_sets/validate-structure`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program: doc.program, kind: doc.kind, items: shapeItems.map((i) => ({ question: i.question, sectionCode: i.sectionCode, sortOrder: i.sortOrder, groupKey: i.groupKey })) }),
      });
      const b = (await r.json().catch(() => null)) as StructureReport | { error?: { message?: string } } | null;
      if (!r.ok || !b || !('ok' in b)) {
        toast.error(`Kiểm tra cấu trúc thất bại: ${(b && 'error' in b && b.error?.message) || `HTTP ${r.status}`}`);
        return;
      }
      setApiReport(b);
      if (b.ok) toast.success('Cấu trúc hợp lệ (API).');
      else toast.warning(`Cấu trúc chưa hợp lệ: ${b.issues.length} vấn đề.`);
    } finally {
      setBusy(false);
    }
  };

  const save = async (publish: boolean) => {
    if (!doc) return;
    if (publish && bpErrors.length) {
      toast.error(`Chưa đạt blueprint: ${bpErrors.join(' ')}`);
      return;
    }
    setBusy(true);
    try {
      const data = toCollectionData(pruneSections(state));
      const r = await fetch(`${apiBase}/test_sets/${encodeURIComponent(doc.id)}?depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: data.sections, items: data.items, blueprint, ...(publish ? { status: 'published' } : {}) }),
      });
      const b = (await r.json().catch(() => null)) as unknown;
      if (!r.ok) {
        toast.error(`Lưu thất bại: ${payloadError(b, r.status)}`);
        return;
      }
      toast.success(publish ? 'Đã lưu và xuất bản bộ đề sang catalog.' : 'Đã lưu bộ đề.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!testSetId) {
    return (
      <div className="allingo-card" data-testid="builder-picker">
        <h3>Chọn bộ đề</h3>
        <ul>
          {sets.map((s) => (
            <li key={s.id}>
              <a href={`${adminRoute}/test-set-builder?id=${encodeURIComponent(s.id)}`}>{s.code}</a> <span className="allingo-muted">({s.status})</span>
            </li>
          ))}
        </ul>
        <p>
          <a href={`${adminRoute}/collections/test_sets/create`}>Tạo bộ đề mới →</a>
        </p>
      </div>
    );
  }
  if (!doc) return <p className="allingo-muted">Đang tải bộ đề…</p>;

  const sectionCodes = builderSectionCodes(doc.program);
  return (
    <div className="allingo-builder" data-testid="test-set-builder" data-dirty={dirty}>
      <div className="allingo-card">
        <h3>
          {doc.code} <span className={`allingo-badge ${doc.status === 'published' ? 'allingo-badge--pass' : 'allingo-badge--warn'}`}>{doc.status}</span>
        </h3>
        <p className="allingo-muted">
          {doc.program.toUpperCase()} · {doc.kind} · {state.items.length} câu{perItem ? ` · ${countOf(state.items)} câu hỏi (mục)` : ''} · {state.sections.length} Part {dirty ? '· có thay đổi chưa lưu' : ''}
        </p>
        <div className="allingo-actions">
          <Button buttonStyle="secondary" disabled={busy} onClick={() => void checkApi()}>
            Kiểm tra cấu trúc (API)
          </Button>
          <Button buttonStyle="secondary" disabled={busy || !dirty} onClick={() => void save(false)}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </Button>
          <Button buttonStyle="primary" disabled={busy || bpErrors.length > 0 || localIssues.length > 0 || unpublished.length > 0} onClick={() => void save(true)} tooltip={bpErrors.length ? 'Chưa đạt blueprint' : unpublished.length ? 'Còn câu chưa phát hành' : undefined}>
            Lưu và xuất bản
          </Button>
          <a href={`${adminRoute}/collections/test_sets/${encodeURIComponent(doc.id)}`}>Mở trang sửa bộ đề →</a>
        </div>
        {localIssues.length || bpErrors.length || unpublished.length || apiReport ? (
          <ul className="allingo-issues" data-testid="builder-issues">
            {localIssues.map((m) => (
              <li key={m} className="allingo-error">
                {m}
              </li>
            ))}
            {bpErrors.map((m) => (
              <li key={m} className="allingo-error" data-testid="builder-blueprint-error">
                {m}
              </li>
            ))}
            {unpublished.length ? <li className="allingo-error">{unpublished.length} câu chưa ở trạng thái published – không xuất bản được.</li> : null}
            {apiReport ? (
              apiReport.ok ? (
                <li className="allingo-badge allingo-badge--pass">API: cấu trúc hợp lệ</li>
              ) : (
                apiReport.issues.map((i, k) => (
                  <li key={`${i.code}-${k}`} className="allingo-error">
                    API: {i.message}
                  </li>
                ))
              )
            ) : null}
          </ul>
        ) : null}
      </div>

      <div className="allingo-grid allingo-grid--2">
        <div>
          {/* Part: kéo thả hoặc ↑/↓ */}
          <div className="allingo-card">
            <h3>Thứ tự Part</h3>
            <ol className="allingo-dnd-list" aria-label="Thứ tự Part">
              {state.sections.map((s, i) => (
                <li key={s.sectionCode} className="allingo-dnd-item" {...dragProps('sections', i, (f, t) => update(moveSection(state, f, t)), over, setOver)} data-testid={`builder-section-${s.sectionCode}`}>
                  <span className="allingo-dnd-handle" aria-hidden>
                    ⋮⋮
                  </span>
                  <strong>{s.sectionCode}</strong>
                  <span className="allingo-muted">
                    {countOf(state.items.filter((it) => it.sectionCode === s.sectionCode))} {unit}
                  </span>
                  <span className="allingo-dnd-buttons">
                    <button type="button" aria-label={`Đưa ${s.sectionCode} lên`} disabled={i === 0} onClick={() => update(moveSection(state, i, i - 1))}>
                      ↑
                    </button>
                    <button type="button" aria-label={`Đưa ${s.sectionCode} xuống`} disabled={i === state.sections.length - 1} onClick={() => update(moveSection(state, i, i + 1))}>
                      ↓
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          {/* Câu theo từng Part: khối = câu đơn hoặc trọn nhóm passage */}
          {state.sections.map((s) => {
            const units = unitsOf(state, s.sectionCode);
            return (
              <div key={s.sectionCode} className="allingo-card" data-testid={`builder-units-${s.sectionCode}`}>
                <h3>
                  {s.sectionCode} <span className="allingo-muted">({countOf(units.flatMap((u) => u.items))} {unit})</span>
                </h3>
                <ol className="allingo-dnd-list" aria-label={`Câu của ${s.sectionCode}`}>
                  {units.map((u, i) => (
                    <li key={u.key} className="allingo-dnd-item allingo-dnd-item--unit" {...dragProps(`units-${s.sectionCode}`, i, (f, t) => update(moveUnit(state, s.sectionCode, f, t)), over, setOver)} data-testid="builder-unit" data-group={u.groupKey ?? ''}>
                      <span className="allingo-dnd-handle" aria-hidden>
                        ⋮⋮
                      </span>
                      <div className="allingo-dnd-body">
                        {u.groupKey ? <span className="allingo-badge">Nhóm passage · {countOf(u.items)} {unit}</span> : null}
                        {u.items.map((it) => (
                          <div key={it.question} className="allingo-dnd-question" data-testid="builder-question" data-question={it.question}>
                            <span>{known.get(it.question)?.title ?? it.question}</span>
                            {perItem && marksOf(it.question) > 1 ? <span className="allingo-badge">{marksOf(it.question)} câu hỏi</span> : null}
                            {(known.get(it.question)?.status ?? 'published') !== 'published' ? <span className="allingo-badge allingo-badge--warn">{known.get(it.question)?.status}</span> : null}
                            <button type="button" className="allingo-link-button" aria-label={`Bớt câu ${known.get(it.question)?.title ?? it.question}`} onClick={() => update(removeQuestion(state, it.question))} data-testid="builder-remove">
                              Bớt
                            </button>
                          </div>
                        ))}
                      </div>
                      <span className="allingo-dnd-buttons">
                        <button type="button" aria-label="Đưa khối lên" disabled={i === 0} onClick={() => update(moveUnit(state, s.sectionCode, i, i - 1))} data-testid="builder-unit-up">
                          ↑
                        </button>
                        <button type="button" aria-label="Đưa khối xuống" disabled={i === units.length - 1} onClick={() => update(moveUnit(state, s.sectionCode, i, i + 1))} data-testid="builder-unit-down">
                          ↓
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>

        <div>
          {/* Blueprint */}
          <div className="allingo-card" data-testid="builder-blueprint">
            <h3>Blueprint ({perItem ? 'số câu hỏi mỗi part/passage' : 'số câu mỗi Part'})</h3>
            <div className="allingo-actions">
              {blueprintsFor(doc.program).map(([k, v]) => (
                <Button
                  key={k}
                  buttonStyle="secondary"
                  size="small"
                  onClick={() => {
                    setBlueprint(v.sections);
                    setDirty(true);
                  }}
                >
                  {v.label}
                </Button>
              ))}
              <Button
                buttonStyle="secondary"
                size="small"
                onClick={() => {
                  setBlueprint([]);
                  setDirty(true);
                }}
              >
                Bỏ blueprint
              </Button>
            </div>
            {blueprint.length ? (
              <table className="allingo-table">
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>Cần</th>
                    <th>Hiện có</th>
                  </tr>
                </thead>
                <tbody>
                  {blueprint.map((b, i) => {
                    const row = bp?.rows.find((r) => r.section_code === b.sectionCode);
                    return (
                      <tr key={b.sectionCode} data-testid={`builder-bp-${b.sectionCode}`} data-ok={row?.diff === 0}>
                        <td>{b.sectionCode}</td>
                        <td>
                          <input
                            type="number"
                            min={1}
                            max={200}
                            className="allingo-input"
                            aria-label={`Số ${unit} cần cho ${b.sectionCode}`}
                            value={b.count}
                            onChange={(e) => {
                              const next = [...blueprint];
                              next[i] = { ...b, count: Math.max(1, Number(e.target.value) || 1) };
                              setBlueprint(next);
                              setDirty(true);
                            }}
                          />
                        </td>
                        <td className={row?.diff === 0 ? '' : 'allingo-error'}>{row?.actual ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="allingo-muted">Chưa đặt blueprint – chỉ kiểm tra cấu trúc theo loại đề.</p>
            )}
          </div>

          {/* Ngân hàng câu */}
          <div className="allingo-card" data-testid="builder-bank">
            <h3>Thêm câu từ ngân hàng</h3>
            <form
              className="allingo-grid allingo-grid--2"
              onSubmit={(e) => {
                e.preventDefault();
                void searchBank();
              }}
            >
              <label>
                Part
                <select className="allingo-input" value={bankFilter.section} onChange={(e) => setBankFilter({ ...bankFilter, section: e.target.value })} data-testid="bank-section">
                  <option value="">Mọi Part</option>
                  {sectionCodes.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Độ khó
                <select className="allingo-input" value={bankFilter.difficulty} onChange={(e) => setBankFilter({ ...bankFilter, difficulty: e.target.value })}>
                  <option value="">Mọi độ khó</option>
                  {DIFFICULTY_CODES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Trạng thái
                <select className="allingo-input" value={bankFilter.status} onChange={(e) => setBankFilter({ ...bankFilter, status: e.target.value })} data-testid="bank-status">
                  <option value="">Mọi trạng thái</option>
                  {['published', 'review2', 'review1', 'ai_checked', 'draft'].map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Từ khoá (tiêu đề)
                <input className="allingo-input" value={bankFilter.q} onChange={(e) => setBankFilter({ ...bankFilter, q: e.target.value })} />
              </label>
              <div className="allingo-actions">
                <Button buttonStyle="secondary" type="submit" disabled={bankBusy}>
                  {bankBusy ? 'Đang tìm…' : 'Tìm'}
                </Button>
                {bank.length ? (
                  <Button buttonStyle="secondary" onClick={() => add(bank.filter((q) => !state.items.some((i) => i.question === q.id)))}>
                    Thêm tất cả kết quả
                  </Button>
                ) : null}
              </div>
            </form>
            <ul className="allingo-bank-list">
              {bank.map((q) => {
                const inSet = state.items.some((i) => i.question === q.id);
                return (
                  <li key={q.id} data-testid="bank-result" data-question={q.id}>
                    <span>
                      <strong>{q.sectionCode}</strong> {q.title} <span className="allingo-muted">({q.status}{q.difficulty ? ` · ${q.difficulty}` : ''}{perItem ? ` · ${q.marks ?? 1} câu hỏi` : ''})</span>
                    </span>
                    <button type="button" className="allingo-link-button" disabled={inSet} onClick={() => add([q])} data-testid="bank-add">
                      {inSet ? 'Đã có' : 'Thêm'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
