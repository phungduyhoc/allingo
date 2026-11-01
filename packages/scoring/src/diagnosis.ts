/**
 * Chẩn đoán bài làm THEO QUY TẮC (Sprint 3, không AI): kỹ năng con/chủ đề/Part yếu, câu sai do hết giờ, câu làm chậm,
 * gợi ý luyện tập. Trả mã (code) để client dịch qua i18n; AI `diagnose_rl` bổ sung lời giải thích ở Sprint 5.
 */

export interface DiagnosisQuestion {
  question_id: string;
  section_code: string;
  subskill_codes: string[];
  topic_code: string | null;
  answered: boolean;
  is_correct: boolean | null;
  time_ms: number | null;
}

export interface WeakArea {
  code: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface AttemptDiagnosis {
  method: 'rules';
  overall_accuracy: number;
  weak_sections: WeakArea[];
  weak_subskills: WeakArea[];
  weak_topics: WeakArea[];
  /** Câu bỏ trống khi bị nộp tự động (hết giờ) */
  timeout_wrong: number;
  unanswered: number;
  /** Câu sai mà thời gian > 2× trung vị của Part */
  slow_wrong_question_ids: string[];
  flags: Array<'many_unanswered' | 'time_pressure' | 'slow_reading' | 'strong_performance'>;
  recommendations: Array<{ kind: 'drill'; section_code: string; subskill_code?: string; topic_code?: string }>;
}

const WEAK_THRESHOLD = 0.6;
const MIN_ITEMS = 2;

function areas(qs: DiagnosisQuestion[], keyOf: (q: DiagnosisQuestion) => string[]): WeakArea[] {
  const m = new Map<string, { correct: number; total: number }>();
  for (const q of qs) {
    if (q.is_correct === null) continue;
    for (const k of keyOf(q)) {
      const v = m.get(k) ?? { correct: 0, total: 0 };
      v.total++;
      if (q.is_correct) v.correct++;
      m.set(k, v);
    }
  }
  return [...m.entries()]
    .map(([code, v]) => ({ code, ...v, accuracy: Math.round((v.correct / v.total) * 1000) / 1000 }))
    .filter((a) => a.total >= MIN_ITEMS && a.accuracy < WEAK_THRESHOLD)
    .sort((a, b) => a.accuracy - b.accuracy || b.total - a.total);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function diagnoseAttempt(questions: DiagnosisQuestion[], opts: { autoSubmitted: boolean }): AttemptDiagnosis {
  const graded = questions.filter((q) => q.is_correct !== null);
  const correct = graded.filter((q) => q.is_correct).length;
  const overall = graded.length ? Math.round((correct / graded.length) * 1000) / 1000 : 0;
  const unanswered = questions.filter((q) => !q.answered).length;
  const timeoutWrong = opts.autoSubmitted ? unanswered : 0;

  const medBySection = new Map<string, number | null>();
  for (const s of new Set(questions.map((q) => q.section_code))) medBySection.set(s, median(questions.filter((q) => q.section_code === s && q.time_ms !== null).map((q) => q.time_ms!)));
  const slow = questions.filter((q) => q.is_correct === false && q.time_ms !== null && (medBySection.get(q.section_code) ?? Infinity) > 0 && q.time_ms > 2 * (medBySection.get(q.section_code) ?? Infinity)).map((q) => q.question_id);

  const weakSections = areas(questions, (q) => [q.section_code]);
  const weakSubskills = areas(questions, (q) => q.subskill_codes);
  const weakTopics = areas(questions, (q) => (q.topic_code ? [q.topic_code] : []));

  const flags: AttemptDiagnosis['flags'] = [];
  if (questions.length && unanswered / questions.length >= 0.1) flags.push('many_unanswered');
  if (timeoutWrong > 0) flags.push('time_pressure');
  if (slow.length >= 3) flags.push('slow_reading');
  if (overall >= 0.85 && graded.length >= 10) flags.push('strong_performance');

  // Gợi ý: tối đa 3 bài luyện – ưu tiên subskill yếu nhất kèm Part chứa nhiều câu sai nhất của subskill đó
  const recs: AttemptDiagnosis['recommendations'] = [];
  for (const w of weakSubskills.slice(0, 2)) {
    const sectionCounts = new Map<string, number>();
    for (const q of questions) if (q.is_correct === false && q.subskill_codes.includes(w.code)) sectionCounts.set(q.section_code, (sectionCounts.get(q.section_code) ?? 0) + 1);
    const section = [...sectionCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (section) recs.push({ kind: 'drill', section_code: section, subskill_code: w.code });
  }
  for (const s of weakSections) if (recs.length < 3 && !recs.some((r) => r.section_code === s.code)) recs.push({ kind: 'drill', section_code: s.code });

  return { method: 'rules', overall_accuracy: overall, weak_sections: weakSections, weak_subskills: weakSubskills, weak_topics: weakTopics, timeout_wrong: timeoutWrong, unanswered, slow_wrong_question_ids: slow, flags, recommendations: recs };
}
