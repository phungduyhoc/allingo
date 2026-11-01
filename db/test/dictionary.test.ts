import { describe, expect, it } from 'vitest';
import { DEMO_PART2, DEMO_PART5, DEMO_VOCAB } from '../seed/demo/content.js';
import { LISTENING_FULL_01, type ListeningScript } from '../seed/demo/toeic-listening-01.js';
import { READING_FULL_01, READING_TOPICS } from '../seed/demo/toeic-reading-01.js';
import {
  DICTIONARY_LICENSE,
  DICTIONARY_TOEIC_CORE,
  DICTIONARY_TOPICS,
  buildFormIndex,
  normalizeTerm,
  type DictEntry,
  type DictPos,
} from '../seed/dictionary/toeic-core-en-vi.js';

/**
 * Kiểm tra từ điển lõi TOEIC Anh–Việt (không cần DB): số mục, khoá (headword, pos) duy nhất, IPA/nghĩa/ví dụ/topic hợp lệ,
 * tra ngược bằng buildFormIndex, và độ phủ từ nội dung của ngân hàng câu demo (Reading 01, Listening 01, content.ts).
 */

const POS: readonly DictPos[] = [
  'noun',
  'verb',
  'adjective',
  'adverb',
  'preposition',
  'conjunction',
  'phrase',
  'phrasal_verb',
];
const LEVELS: readonly DictEntry['level'][] = ['A2', 'B1', 'B2', 'C1'];
const REQUIRED = [
  'invoice',
  'shipment',
  'warehouse',
  'itinerary',
  'reimbursement',
  'deadline',
  'quarterly',
  'revenue',
  'applicant',
  'refund',
];

const entries = DICTIONARY_TOEIC_CORE;
const index = buildFormIndex();
const label = (e: DictEntry) => `${e.headword} (${e.pos})`;
const lookup = (term: string): DictEntry[] => (index.get(normalizeTerm(term)) ?? []).map((i) => entries[i]!);

// ---------------------------------------------------------------------------
// Tách từ dùng chung cho câu ví dụ và ngân hàng câu

const WORD_RE = /\p{L}+(?:'\p{L}+)*(?:-\p{L}+)*/gu;
const words = (s: string): string[] => (s.replace(/[’‘]/g, "'").match(WORD_RE) ?? []).map((w) => w.toLowerCase());

/**
 * Câu ví dụ có chứa headword hoặc một form (so theo ranh giới từ, không phân biệt hoa thường). Chấp nhận thêm hai biến
 * thể của câu: bỏ đuôi sở hữu 's (`company's` → company) và tách từ ghép gạch nối (`mid-January` → mid january).
 */
function exampleHasForm(entry: DictEntry, example: string): boolean {
  const tokens = words(example);
  const variants = [
    tokens,
    tokens.map((t) => t.replace(/'s$/, '')),
    tokens.flatMap((t) => t.replace(/'s$/, '').split('-')),
  ].map((ts) => ` ${ts.join(' ')} `);
  return [entry.headword, ...entry.forms].some((f) => {
    const key = ` ${words(f).join(' ')} `;
    return key.trim() !== '' && variants.some((v) => v.includes(key));
  });
}

// ---------------------------------------------------------------------------
// Ngân hàng câu demo → danh sách từ nội dung

/** Hư từ (mạo từ, đại từ, giới từ, liên từ, trợ động từ, lượng từ, số đếm, thán từ, dạng rút gọn) */
const STOPWORDS = new Set(
  `a an the i me my mine myself we us our ours ourselves you your yours yourself yourselves he him his himself she her
  hers herself it its itself they them their theirs themselves this that these those who whom whose which what whatever
  whoever whichever am is are was were be been being have has had having do does did doing done will would shall should
  can could may might must ought cannot and or but nor so yet if because although though unless whether while whereas
  than as since until till once of in on at by for with without within to from into onto upon about above below over
  under between among through throughout during before after against along across around beyond behind beside besides
  near toward towards per via despite except including regarding concerning up down out off not no yes all any both
  each either every neither none some several few many much more most less least other others another such own same
  here there where when why how then now just only also too very quite rather even still already again ever never always
  often sometimes else whenever wherever anyone anything anybody anywhere someone something somebody somewhere sometime
  everyone everything everybody everywhere nothing nobody nowhere one two three four five six seven eight nine ten
  eleven twelve fifteen twenty thirty forty fifty sixty hundred hundreds thousand thousands million oh hi hello hey okay
  ok um uh hmm yeah mr mrs ms dr st re etc vs o'clock don't doesn't didn't isn't aren't wasn't weren't haven't hasn't
  hadn't won't wouldn't can't couldn't shouldn't mustn't i'm i've i'll i'd we're we've we'll we'd you're you've you'll
  you'd he's he'll he'd she's she'll she'd it's it'll they're they've they'll they'd that's there's here's what's who's
  where's how's let's`
    .split(/\s+/)
    .filter(Boolean),
);

/** Trích văn bản tiếng Anh in trên đề/đọc trong audio: đoạn văn, đề bài, lựa chọn, evidence, transcript, bảng biểu */
function contentTexts(content: unknown): string[] {
  const c = content as { stem?: unknown; options?: unknown; evidence?: unknown };
  const out: string[] = [];
  if (typeof c.stem === 'string') out.push(c.stem);
  if (Array.isArray(c.options)) {
    for (const o of c.options as Array<{ text?: unknown }>) if (typeof o.text === 'string') out.push(o.text);
  }
  if (typeof c.evidence === 'string') out.push(c.evidence);
  return out;
}
const segmentTexts = (script: ListeningScript | undefined): string[] => script?.segments.map((s) => s.text) ?? [];

function demoBankTexts(): string[] {
  return [
    ...READING_FULL_01.passages.flatMap((p) => [p.title, p.body]),
    ...READING_FULL_01.questions.flatMap((q) => contentTexts(q.content)),
    ...LISTENING_FULL_01.groups.flatMap((g) => [g.title, ...segmentTexts(g.script), ...(g.graphic ? [g.graphic] : [])]),
    ...LISTENING_FULL_01.questions.flatMap((q) => [...segmentTexts(q.script), ...contentTexts(q.content)]),
    ...[...DEMO_PART5, ...DEMO_PART2].flatMap((q) => contentTexts(q.content)),
    ...DEMO_VOCAB.flatMap((v) => [v.headword, v.example]),
  ];
}

interface Token {
  raw: string;
  sentenceStart: boolean;
}

/** Viết tắt có dấu chấm không kết thúc câu (Ms. Lee, 9:00 A.M. …) */
const ABBREVIATION_END = /(?:\b(?:Mr|Mrs|Ms|Dr|St|Ave|No|Inc|Co|Ltd)|\b\p{Lu})\.$/u;

function tokenize(text: string): Token[] {
  const clean = text.replace(/[’‘]/g, "'").replace(/\S+@\S+|https?:\/\/\S+|\bwww\.\S+/g, ' ');
  const tokens: Token[] = [];
  for (const line of clean.split('\n')) {
    for (const m of line.matchAll(WORD_RE)) {
      const before = line.slice(0, m.index ?? 0).replace(/[\s"'([*#|—–-]+$/u, '');
      const sentenceStart =
        before === '' || (/[.!?]$/.test(before) && !ABBREVIATION_END.test(before)) || /^\(?[A-D]\)?$/.test(before);
      tokens.push({ raw: m[0], sentenceStart });
    }
  }
  return tokens;
}

/**
 * Từ nội dung (chữ thường) của ngân hàng demo: bỏ hư từ, bỏ tên riêng (chữ hoa không đứng đầu câu; một từ từng viết hoa
 * giữa câu mà không bao giờ xuất hiện dạng chữ thường thì bị loại ở mọi vị trí), bỏ từ viết hoa toàn bộ (tiêu đề/viết
 * tắt), bỏ đuôi sở hữu 's. Từ ghép có gạch nối không có trong từ điển được tách thành từng phần.
 */
function demoContentWords(formIndex: Map<string, number[]>): string[] {
  const tokens = demoBankTexts().flatMap(tokenize);
  const isCap = (w: string) => /^\p{Lu}/u.test(w);
  const isAllCaps = (w: string) => /^\p{Lu}[\p{Lu}'-]+$/u.test(w);
  const seenLower = new Set(tokens.filter((t) => /^\p{Ll}/u.test(t.raw)).map((t) => t.raw.toLowerCase()));
  const proper = new Set(
    tokens
      .filter((t) => isCap(t.raw) && !t.sentenceStart && !isAllCaps(t.raw))
      .map((t) => t.raw.toLowerCase())
      .filter((w) => !seenLower.has(w)),
  );
  const accept = (w: string): string | null => {
    let x = w;
    if (STOPWORDS.has(x)) return null;
    if (x.endsWith("'s")) x = x.slice(0, -2);
    if (x.includes("'")) x = x.split("'")[0] ?? '';
    if (x.length < 2 || STOPWORDS.has(x) || proper.has(x)) return null;
    return x;
  };
  const out: string[] = [];
  for (const t of tokens) {
    if (t.raw.length < 2 || isAllCaps(t.raw) || (isCap(t.raw) && !t.sentenceStart)) continue;
    const w = accept(t.raw.toLowerCase());
    if (w === null) continue;
    if (w.includes('-') && !formIndex.has(normalizeTerm(w))) {
      for (const part of w.split('-')) {
        const p = accept(part);
        if (p !== null) out.push(p);
      }
    } else out.push(w);
  }
  return out;
}

// ---------------------------------------------------------------------------

describe('Từ điển lõi TOEIC EN–VI – cấu trúc', () => {
  it('có ≥ 700 mục và DICTIONARY_LICENSE khớp số mục', () => {
    expect(entries.length).toBeGreaterThanOrEqual(700);
    expect(DICTIONARY_LICENSE).toMatchObject({ name: 'Allingo TOEIC Core EN–VI', version: '1.0' });
    expect(DICTIONARY_LICENSE.license).toMatch(/Proprietary/);
    expect(DICTIONARY_LICENSE.entries).toBe(entries.length);
  });

  it('không trùng (headword, pos)', () => {
    const seen = new Map<string, number>();
    for (const e of entries) seen.set(`${e.headword}|${e.pos}`, (seen.get(`${e.headword}|${e.pos}`) ?? 0) + 1);
    expect([...seen].filter(([, n]) => n > 1).map(([k]) => k)).toEqual([]);
  });

  it('headword chữ thường, đã chuẩn hoá; pos và level hợp lệ', () => {
    const bad = entries.filter(
      (e) =>
        e.headword !== e.headword.toLowerCase() ||
        normalizeTerm(e.headword) !== e.headword ||
        !POS.includes(e.pos) ||
        !LEVELS.includes(e.level),
    );
    expect(bad.map(label)).toEqual([]);
  });

  it('IPA Mỹ/Anh bắt đầu và kết thúc bằng "/"', () => {
    const ok = (s: string) => s.length > 2 && s.startsWith('/') && s.endsWith('/');
    expect(entries.filter((e) => !ok(e.ipa_us) || !ok(e.ipa_uk)).map(label)).toEqual([]);
  });

  it('1–3 nghĩa, mỗi nghĩa đủ vi và en', () => {
    const bad = entries.filter(
      (e) =>
        e.meanings.length < 1 ||
        e.meanings.length > 3 ||
        e.meanings.some((m) => m.vi.trim() === '' || m.en.trim() === ''),
    );
    expect(bad.map(label)).toEqual([]);
  });

  it('1–2 câu ví dụ ngắn (≤ 20 từ), đủ en và vi', () => {
    const bad = entries.filter(
      (e) =>
        e.examples.length < 1 ||
        e.examples.length > 2 ||
        e.examples.some((x) => x.en.trim() === '' || x.vi.trim() === '' || x.en.trim().split(/\s+/).length > 20),
    );
    expect(bad.map(label)).toEqual([]);
  });

  it('mỗi mục có ≥ 1 câu ví dụ chứa headword hoặc một form của nó', () => {
    const bad = entries.filter((e) => !e.examples.some((x) => exampleHasForm(e, x.en)));
    expect(bad.map(label)).toEqual([]);
  });

  it('collocations 0–4, không rỗng, không trùng', () => {
    const bad = entries.filter(
      (e) =>
        e.collocations.length > 4 ||
        e.collocations.some((c) => c.trim() === '') ||
        new Set(e.collocations).size !== e.collocations.length,
    );
    expect(bad.map(label)).toEqual([]);
  });

  it('topics không rỗng và thuộc catalog.topics của seed core', () => {
    expect([...DICTIONARY_TOPICS].sort()).toEqual([...READING_TOPICS].sort());
    const valid = new Set<string>(READING_TOPICS);
    const bad = entries.filter((e) => e.topics.length === 0 || e.topics.some((t) => !valid.has(t)));
    expect(bad.map(label)).toEqual([]);
  });

  it('forms không rỗng, không trùng, không lặp lại headword', () => {
    const bad = entries.filter(
      (e) =>
        e.forms.some((f) => f.trim() === '' || normalizeTerm(f) === normalizeTerm(e.headword)) ||
        new Set(e.forms).size !== e.forms.length,
    );
    expect(bad.map(label)).toEqual([]);
  });

  it('có đủ các từ bắt buộc', () => {
    const heads = new Set(entries.map((e) => e.headword));
    expect(REQUIRED.filter((w) => !heads.has(w))).toEqual([]);
  });
});

describe('normalizeTerm & buildFormIndex', () => {
  it("normalizeTerm: chữ thường, bỏ dấu câu đầu/cuối, gộp khoảng trắng, ’ → '", () => {
    expect(normalizeTerm('  Invoices. ')).toBe('invoices');
    expect(normalizeTerm('“Set   Up”')).toBe('set up');
    expect(normalizeTerm('Company’s')).toBe("company's");
    expect(normalizeTerm('(follow-up)')).toBe('follow-up');
    expect(normalizeTerm('E‑mail')).toBe('e-mail');
  });

  it("tra ngược 'invoices' → invoice, 'shipped' → ship", () => {
    expect(lookup('invoices').map(label)).toContain('invoice (noun)');
    expect(lookup('Shipped').map(label)).toContain('ship (verb)');
    expect(lookup('reimbursed').map((e) => e.headword)).toContain('reimburse');
  });

  it('một form thuộc nhiều mục khác loại từ; headword cũng tra được', () => {
    expect(lookup('orders').map(label).sort()).toEqual(['order (noun)', 'order (verb)']);
    expect(lookup('deadline').map(label)).toEqual(['deadline (noun)']);
    expect(lookup('set up').map((e) => e.pos)).toContain('phrasal_verb');
  });

  it('nhận danh sách mục tuỳ chọn', () => {
    const sample: DictEntry[] = [entries.find((e) => e.headword === 'refund' && e.pos === 'noun')!];
    const small = buildFormIndex(sample);
    expect(small.get('refunds')).toEqual([0]);
    expect(small.has('invoice')).toBe(false);
  });
});

describe('Độ phủ ngân hàng câu demo', () => {
  const contentWords = demoContentWords(index);
  const types = new Map<string, boolean>();
  let coveredTokens = 0;
  for (const w of contentWords) {
    const ids = index.get(normalizeTerm(w));
    const first = ids?.[0];
    if (first !== undefined) {
      coveredTokens++;
      types.set(`=${entries[first]!.headword}`, true);
    } else types.set(w, false);
  }
  const uncovered = [...types].filter(([, ok]) => !ok).map(([w]) => w);

  it('đủ dữ liệu để đo (ngân hàng demo có hàng nghìn từ nội dung)', () => {
    expect(contentWords.length).toBeGreaterThan(3000);
    expect(types.size).toBeGreaterThan(800);
  });

  it('phủ ≥ 90% số từ nội dung khác nhau (đã quy về dạng gốc)', () => {
    const coverage = (types.size - uncovered.length) / types.size;
    expect(coverage, `chưa có: ${uncovered.slice(0, 80).join(', ')}`).toBeGreaterThanOrEqual(0.9);
  });

  it('phủ ≥ 90% lượt từ nội dung', () => {
    expect(coveredTokens / contentWords.length).toBeGreaterThanOrEqual(0.9);
  });
});
