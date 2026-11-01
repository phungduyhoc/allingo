import { transcriptHighlightSchema, type TranscriptHighlight } from '@allingo/schemas';

/**
 * Transcript Listening (Review / phản hồi practice): dòng theo người nói (M/W/N…), dòng đang phát theo mốc thời gian
 * `segments`, tô `evidence` (trích đoạn quyết định đáp án). Logic thuần để kiểm thử.
 */

export interface TranscriptLine {
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export type SpeakerTone = 'man' | 'woman' | 'narrator' | 'other';

export function parseTranscript(raw: unknown): TranscriptHighlight | null {
  if (!raw) return null;
  const r = transcriptHighlightSchema.safeParse(raw);
  return r.success && r.data.text.trim() ? r.data : null;
}

/** "M: Hello" / "W1: Hi" / "Narrator: …" → người nói + câu; dòng không có tiền tố → speaker null */
const SPEAKER_RE = /^\s*([A-Z][A-Za-z]{0,9}\d?|[A-Z]\d)\s*:\s+(.*)$/;

export function transcriptLines(t: Pick<TranscriptHighlight, 'text' | 'segments'>): TranscriptLine[] {
  if (t.segments?.length) return t.segments.map((s) => ({ speaker: s.speaker, text: s.text, startMs: s.start_ms, endMs: s.end_ms }));
  return t.text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = SPEAKER_RE.exec(l);
      return m ? { speaker: m[1]!, text: m[2]!, startMs: null, endMs: null } : { speaker: null, text: l, startMs: null, endMs: null };
    });
}

export function hasTimings(lines: readonly TranscriptLine[]): boolean {
  return lines.some((l) => l.startMs !== null);
}

/** Dòng đang phát tại `ms`: start ≤ ms < end (thiếu end → tới start dòng kế); khoảng lặng giữa hai dòng → giữ dòng trước */
export function activeLineIndex(lines: readonly TranscriptLine[], ms: number | null): number {
  if (ms === null || ms < 0) return -1;
  let found = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startMs === null) continue;
    if (l.startMs > ms) break;
    const end = l.endMs ?? lines.slice(i + 1).find((x) => x.startMs !== null)?.startMs ?? Infinity;
    found = i;
    if (ms < end) return i;
  }
  // Sau dòng cuối có mốc (audio còn vài trăm ms im lặng) → giữ dòng cuối
  return found >= 0 && lines[found]!.endMs !== null && ms - lines[found]!.endMs! > 1500 ? -1 : found;
}

export function speakerTone(speaker: string | null): SpeakerTone {
  if (!speaker) return 'other';
  const s = speaker.toUpperCase();
  if (s.startsWith('N')) return 'narrator';
  if (s.startsWith('M')) return 'man';
  if (s.startsWith('W')) return 'woman';
  return 'other';
}

export interface MarkedPart {
  text: string;
  mark: boolean;
}

/** Tách `text` thành phần thường/phần tô (mọi lần xuất hiện của các `evidence`, không phân biệt hoa thường, không chồng nhau) */
export function markEvidence(text: string, evidence: readonly (string | null | undefined)[]): MarkedPart[] {
  const needles = [...new Set(evidence.map((e) => e?.trim()).filter((e): e is string => !!e && e.length >= 2))].sort((a, b) => b.length - a.length);
  if (!needles.length) return [{ text, mark: false }];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const n of needles) {
    const ln = n.toLowerCase();
    for (let from = 0, i = lower.indexOf(ln, from); i >= 0; from = i + ln.length, i = lower.indexOf(ln, from)) {
      const r: [number, number] = [i, i + ln.length];
      if (!ranges.some(([a, b]) => r[0] < b && a < r[1])) ranges.push(r);
    }
  }
  if (!ranges.length) return [{ text, mark: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const out: MarkedPart[] = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    if (a > pos) out.push({ text: text.slice(pos, a), mark: false });
    out.push({ text: text.slice(a, b), mark: true });
    pos = b;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out;
}
