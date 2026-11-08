import type { VocabItem } from '@allingo/schemas/api/learning-s10';
import type { SrsCard } from '@allingo/schemas/api/learning-tools';
import { formatAnswer } from '@/lib/format-answer';

/**
 * Dữ liệu hiển thị của thẻ ôn từ `SrsCard.payload` (server dựng lúc tạo thẻ – không cần gọi thêm API). Thuần, không React.
 * vocab: headword, IPA, nghĩa (locale), ví dụ + dịch, collocations, `tts_text`; error: câu (đề rút gọn), lựa chọn, đáp án đúng,
 * giải thích, dẫn chứng, ghi chú của người học.
 */

export interface VocabCardView {
  kind: 'vocab';
  headword: string;
  pos: string | null;
  ipa: string | null;
  meaning: string | null;
  meaningEn: string | null;
  examples: { text: string; translation: string | null }[];
  collocations: string[];
  tts: string;
}

export interface ErrorCardView {
  kind: 'error';
  section: string | null;
  stem: string | null;
  excerpt: string | null;
  options: { key: string; text: string }[];
  correct: string;
  explanation: string | null;
  evidence: string | null;
  note: string | null;
}

export interface GenericCardView {
  kind: 'other';
  title: string;
  body: string | null;
}

export type CardView = VocabCardView | ErrorCardView | GenericCardView;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Bản dịch có thể là chuỗi hoặc {vi, en} */
export function localText(v: unknown, locale: string): string | null {
  if (typeof v === 'string') return v.trim() ? v : null;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return str(o[locale]) ?? str(o.vi) ?? str(o.en) ?? null;
  }
  return null;
}

/** IPA từ API đã có dấu "/" (vd "/ˈɪnvɔɪs/") – chuẩn hoá về đúng một cặp */
export function formatIpa(ipa: string | null | undefined): string | null {
  const s = ipa?.trim().replace(/^\/+|\/+$/g, '');
  return s ? `/${s}/` : null;
}

function examplesOf(raw: unknown, locale: string): { text: string; translation: string | null }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e) => {
      if (typeof e === 'string') return { text: e, translation: null };
      const o = (e ?? {}) as Record<string, unknown>;
      const text = str(o.text) ?? str(o.en);
      return text ? { text, translation: localText(o.translation ?? o.vi ?? null, locale) } : null;
    })
    .filter((x): x is { text: string; translation: string | null } => !!x)
    .slice(0, 3);
}

export function cardView(card: Pick<SrsCard, 'card_type' | 'payload'>, locale: string): CardView {
  const p: Record<string, unknown> = card.payload ?? {};
  if (card.card_type === 'vocab') {
    const headword = str(p.headword) ?? '—';
    const localMeanings = Array.isArray(p.meanings_local) ? (p.meanings_local as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return {
      kind: 'vocab',
      headword,
      pos: str(p.pos),
      ipa: formatIpa(str(p.ipa_us) ?? str(p.ipa) ?? str(p.ipa_uk)),
      meaning: (locale === 'en' ? str(p.meaning_en) : null) ?? (localMeanings.length ? localMeanings.join('; ') : str(p.meaning_local)) ?? str(p.meaning_en),
      meaningEn: str(p.meaning_en),
      examples: examplesOf(p.examples, locale),
      collocations: Array.isArray(p.collocations) ? (p.collocations as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 4) : [],
      tts: str(p.tts_text) ?? headword,
    };
  }
  if (card.card_type === 'error') {
    const options = Array.isArray(p.options)
      ? (p.options as unknown[]).map((o) => (o && typeof o === 'object' ? { key: str((o as { key?: unknown }).key) ?? '', text: str((o as { text?: unknown }).text) ?? '' } : null)).filter((o): o is { key: string; text: string } => !!o && !!o.key)
      : [];
    return { kind: 'error', section: str(p.section_code), stem: str(p.stem), excerpt: str(p.passage_excerpt), options, correct: formatAnswer(p.correct_answer) || '—', explanation: localText(p.explanation, locale), evidence: str(p.evidence), note: str(p.note) };
  }
  return { kind: 'other', title: str(p.title) ?? str(p.headword) ?? card.card_type, body: localText(p.body ?? p.description ?? null, locale) };
}

/** Nghĩa đầu tiên của mục bộ từ (`VocabItem.meanings` – mảng {en, vi} | chuỗi | {vi: [...]}) */
export function itemMeaning(item: Pick<VocabItem, 'meanings'>, locale: string): string | null {
  const m: unknown = item.meanings;
  if (!m) return null;
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) {
    const parts = m.map((x) => (typeof x === 'string' ? x : localText(x, locale))).filter((x): x is string => !!x);
    return parts.length ? parts.slice(0, 2).join('; ') : null;
  }
  if (typeof m === 'object') {
    const o = m as Record<string, unknown>;
    const v = o[locale] ?? o.vi ?? o.en;
    if (typeof v === 'string') return v;
    if (Array.isArray(v) && typeof v[0] === 'string') return v.slice(0, 2).join('; ');
  }
  return null;
}

export type CardStatus = 'none' | 'new' | 'learning' | 'review' | 'mastered';

/** Trạng thái hiển thị của một từ theo thẻ SRS của người học (null = chưa thêm) */
export function cardStatus(srs: Pick<SrsCard, 'state' | 'mastered'> | null | undefined): CardStatus {
  if (!srs) return 'none';
  if (srs.mastered) return 'mastered';
  if (srs.state === 'relearning') return 'learning';
  return srs.state;
}
