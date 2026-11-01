import type { QuestionContent } from '@allingo/schemas';

/**
 * Đề TOEIC Listening đầy đủ số 01 – 100 câu (1–100), cấu trúc Part 1 (6) / Part 2 (25) / Part 3 (39) / Part 4 (30).
 *
 * Nội dung TỰ BIÊN SOẠN hoàn toàn (khi seed: source = 'human'), không sao chép hay diễn lại đề ETS hoặc sách luyện thi.
 * Mọi công ty, con người, địa danh (Holloway, Port Callan, Dunhaven, Marrowfield Logistics…) đều hư cấu, dùng chung thế
 * giới với đề Reading 01. Ảnh Part 1 là SVG tự vẽ (minh hoạ phẳng, không chữ, không nhân vật/thương hiệu có thật).
 *
 * Quy ước dữ liệu:
 * - Câu hỏi: key `l01-q<số câu>`; Part 3/4 có `group_key` = key của hội thoại/bài nói (`l01-p3-cNN`, `l01-p4-tNN`).
 * - Script chia theo segment để TTS từng giọng: `N` = người dẫn (giọng Mỹ cố định) đọc số câu, lời dẫn và câu hỏi
 *   Part 3/4; `M1/M2/W1/W2` = giọng nam/nữ, `accent` us/uk/au/ca trộn như đề thật.
 * - Part 1: N đọc "Number n. Look at the picture…", sau đó MỘT giọng khác đọc (A)–(D) (như đề thật). Lựa chọn trong
 *   `content.options` để text rỗng vì không in trên đề.
 * - Part 2: N đọc "Number n.", một giọng nói câu hỏi/câu nói, giọng khác đọc (A)–(C). `content.tags` ghi dạng câu hỏi
 *   (`form:wh|yes_no|tag|choice|request|statement`) độc lập với subskill (subskill `indirect_response` khi đáp án gián tiếp).
 * - Part 3/4: script của nhóm = lời dẫn N + hội thoại/bài nói; script của từng câu = N đọc câu hỏi. `content.stem` = câu
 *   hỏi in trên đề, câu "Look at the graphic" có thêm graphic (markdown table) của nhóm.
 * - `evidence` luôn là chuỗi con NGUYÊN VĂN của `scriptText()` (script của câu với Part 1/2, của nhóm với Part 3/4).
 */

export type Speaker = 'N' | 'M1' | 'M2' | 'W1' | 'W2';
export type Accent = 'us' | 'uk' | 'au' | 'ca';

export interface ScriptSegment {
  speaker: Speaker;
  accent: Accent;
  text: string;
}

export interface ListeningScript {
  segments: ScriptSegment[];
}

export interface ListeningImage {
  key: string;
  alt_vi: string;
  alt_en: string;
  /** SVG tự vẽ, viewBox 0 0 800 600, không <text> – chuyển PNG/WebP khi seed media */
  svg: string;
}

export interface ListeningGroup {
  key: string;
  group_key: string;
  section: 'part3' | 'part4';
  topic: ListeningTopic;
  title: string;
  script: ListeningScript;
  /** Bảng/lịch/biểu đồ (markdown table) in trên đề – chỉ các bộ graphic */
  graphic?: string;
}

export interface ListeningQuestion {
  key: string;
  number: number;
  section: 'part1' | 'part2' | 'part3' | 'part4';
  group_key?: string;
  subskill: ListeningSubskill;
  topic: ListeningTopic;
  difficulty: 'A2' | 'B1' | 'B2';
  script?: ListeningScript;
  image?: ListeningImage;
  content: QuestionContent;
}

/** Mã topic khớp catalog.topics (seed core) */
export const LISTENING_TOPICS = [
  'business',
  'office',
  'travel',
  'shopping',
  'logistics',
  'hr',
  'finance',
  'technology',
  'health',
  'education',
] as const;
export type ListeningTopic = (typeof LISTENING_TOPICS)[number];

/** Subskill TOEIC Listening ĐÃ CÓ trong seed core (catalog.subskills, skill = listening) */
export const LISTENING_SUBSKILLS_IN_CORE = [
  'wh_question',
  'yes_no_question',
  'indirect_response',
  'similar_sound',
  'listening_detail',
  'listening_gist',
] as const;

/** Toàn bộ subskill dùng trong đề – các mã sau nhóm IN_CORE CHƯA có trong seed core (xem LISTENING_SUBSKILLS_TO_ADD) */
export const LISTENING_SUBSKILLS = [
  ...LISTENING_SUBSKILLS_IN_CORE,
  'photo_description',
  'tag_question',
  'choice_question',
  'request_suggestion',
  'statement_response',
  'listening_inference',
  'next_action',
  'speaker_intent',
  'graphic_question',
] as const;
export type ListeningSubskill = (typeof LISTENING_SUBSKILLS)[number];

/**
 * Subskill cần bổ sung vào seed core (program toeic, skill listening). Khi chưa có, seed bỏ qua liên kết
 * catalog.question_subskills cho các câu này (giống reading-01.seed.ts: chỉ insert khi tra được id).
 */
export const LISTENING_SUBSKILLS_TO_ADD: Record<
  Exclude<ListeningSubskill, (typeof LISTENING_SUBSKILLS_IN_CORE)[number]>,
  { vi: string; en: string }
> = {
  photo_description: { vi: 'Mô tả tranh', en: 'Photo description' },
  tag_question: { vi: 'Câu hỏi đuôi', en: 'Tag questions' },
  choice_question: { vi: 'Câu hỏi lựa chọn', en: 'Choice questions' },
  request_suggestion: { vi: 'Yêu cầu, đề nghị, gợi ý', en: 'Requests, offers and suggestions' },
  statement_response: { vi: 'Phản hồi câu trần thuật', en: 'Responses to statements' },
  listening_inference: { vi: 'Suy luận khi nghe', en: 'Inference (listening)' },
  next_action: { vi: 'Hành động tiếp theo', en: 'Next action' },
  speaker_intent: { vi: 'Hàm ý người nói', en: "Speaker's intent" },
  graphic_question: { vi: 'Câu hỏi kết hợp bảng/biểu đồ', en: 'Graphic questions' },
};

/** Dạng câu hỏi Part 2 – ghi trong content.tags dạng `form:<dạng>` */
export const PART2_FORMS = ['wh', 'yes_no', 'tag', 'choice', 'request', 'statement'] as const;
export type Part2Form = (typeof PART2_FORMS)[number];

// ---------------------------------------------------------------------------
// Transcript hiển thị & đếm từ

const isNarrator = (s: ScriptSegment) => s.speaker === 'N';

/**
 * Ghép transcript hiển thị, mỗi segment một dòng "M: …" / "W: …" (người dẫn: "N: …").
 * Khi script có 2 giọng cùng giới (M1 + M2 hoặc W1 + W2) thì giữ số: "M1: …", "M2: …".
 */
export function scriptText(script: ListeningScript, opts: { narrator?: boolean } = {}): string {
  const withNarrator = opts.narrator ?? true;
  const speakers = new Set(script.segments.map((s) => s.speaker));
  const twoMen = speakers.has('M1') && speakers.has('M2');
  const twoWomen = speakers.has('W1') && speakers.has('W2');
  const label = (sp: Speaker): string => {
    if (sp === 'N') return 'N';
    if (sp.startsWith('M')) return twoMen ? sp : 'M';
    return twoWomen ? sp : 'W';
  };
  return script.segments
    .filter((s) => withNarrator || !isNarrator(s))
    .map((s) => `${label(s.speaker)}: ${s.text}`)
    .join('\n');
}

/** Số từ phần nói (mặc định KHÔNG tính lời người dẫn) – dùng đo độ dài hội thoại/bài nói và word_count của audio_script */
export function scriptWordCount(script: ListeningScript, opts: { narrator?: boolean } = {}): number {
  const withNarrator = opts.narrator ?? false;
  return script.segments
    .filter((s) => withNarrator || !isNarrator(s))
    .flatMap((s) => s.text.split(/\s+/))
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// ---------------------------------------------------------------------------
// Tiện ích dựng dữ liệu

type Letter = 'A' | 'B' | 'C' | 'D';
type Level = ListeningQuestion['difficulty'];
type Options4 = readonly [string, string, string, string];
type Voice = (text: string) => ScriptSegment;

/** Người dẫn: một giọng Mỹ cố định như đề thật */
const NARRATOR_ACCENT: Accent = 'us';
const PAUSE_SHORT_MS = 5000;
const PAUSE_LONG_MS = 8000;

const say =
  (speaker: Exclude<Speaker, 'N'>, accent: Accent): Voice =>
  (text) => ({ speaker, accent, text });
const narrate = (text: string): ScriptSegment => ({ speaker: 'N', accent: NARRATOR_ACCENT, text });
const letterAt = (i: number): string => String.fromCharCode(65 + i);
const media = (pause_ms: number) => ({ listen_policy: 'once' as const, pause_ms });

export const questionKey = (n: number): string => `l01-q${n}`;

/** Gói SVG 800×600 (id trong <defs> có tiền tố riêng mỗi ảnh để không trùng khi nhiều ảnh cùng trang) */
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">${body}</svg>`;

interface PhotoSpec {
  n: number;
  topic: ListeningTopic;
  difficulty: Level;
  reader: Voice;
  options: Options4;
  correct: Letter;
  vi: string;
  en: string;
  alt_vi: string;
  alt_en: string;
  svg: string;
}

function p1(s: PhotoSpec): ListeningQuestion {
  const idx = s.correct.charCodeAt(0) - 65;
  return {
    key: questionKey(s.n),
    number: s.n,
    section: 'part1',
    subskill: 'photo_description',
    topic: s.topic,
    difficulty: s.difficulty,
    script: {
      segments: [
        narrate(`Number ${s.n}. Look at the picture marked number ${s.n} in your test book.`),
        ...s.options.map((o, i) => s.reader(`(${letterAt(i)}) ${o}`)),
      ],
    },
    image: { key: `l01-p1-img${s.n}`, alt_vi: s.alt_vi, alt_en: s.alt_en, svg: s.svg },
    content: {
      type: 'mcq_single',
      stem: '',
      options: s.options.map((_, i) => ({ key: letterAt(i), text: '' })),
      answer_key: { correct: s.correct },
      media: media(PAUSE_SHORT_MS),
      explanation: { vi: s.vi, en: s.en },
      evidence: s.options[idx] ?? '',
      tags: [],
    },
  };
}

interface ResponseSpec {
  n: number;
  topic: ListeningTopic;
  subskill: ListeningSubskill;
  form: Part2Form;
  difficulty: Level;
  asker: Voice;
  responder: Voice;
  prompt: string;
  responses: readonly [string, string, string];
  correct: 'A' | 'B' | 'C';
  vi: string;
  en: string;
}

function p2(s: ResponseSpec): ListeningQuestion {
  const idx = s.correct.charCodeAt(0) - 65;
  return {
    key: questionKey(s.n),
    number: s.n,
    section: 'part2',
    subskill: s.subskill,
    topic: s.topic,
    difficulty: s.difficulty,
    script: {
      segments: [
        narrate(`Number ${s.n}.`),
        s.asker(s.prompt),
        ...s.responses.map((r, i) => s.responder(`(${letterAt(i)}) ${r}`)),
      ],
    },
    content: {
      type: 'mcq_single',
      stem: '',
      options: s.responses.map((_, i) => ({ key: letterAt(i), text: '' })),
      answer_key: { correct: s.correct },
      media: media(PAUSE_SHORT_MS),
      explanation: { vi: s.vi, en: s.en },
      evidence: s.responses[idx] ?? '',
      tags: [`form:${s.form}`],
    },
  };
}

interface ItemSpec {
  n: number;
  subskill: ListeningSubskill;
  difficulty: Level;
  /** Câu hỏi in trên đề (N đọc nguyên câu này) */
  stem: string;
  options: Options4;
  correct: Letter;
  vi: string;
  en: string;
  /** Trích nguyên văn từ hội thoại/bài nói */
  evidence: string;
  /** Câu "Look at the graphic": stem in kèm graphic của nhóm */
  graphic?: true;
}

interface GroupSpec {
  section: 'part3' | 'part4';
  index: number;
  topic: ListeningTopic;
  title: string;
  /** Phần sau "refer to the following …" trong lời dẫn */
  kind: string;
  lines: readonly ScriptSegment[];
  graphic?: string;
  items: readonly ItemSpec[];
}

interface Group {
  group: ListeningGroup;
  questions: ListeningQuestion[];
}

function group(s: GroupSpec): Group {
  const key = `l01-${s.section === 'part3' ? 'p3-c' : 'p4-t'}${String(s.index).padStart(2, '0')}`;
  const first = s.items[0]?.n ?? 0;
  const last = s.items[s.items.length - 1]?.n ?? 0;
  const g: ListeningGroup = {
    key,
    group_key: key,
    section: s.section,
    topic: s.topic,
    title: s.title,
    script: { segments: [narrate(`Questions ${first} through ${last} refer to the following ${s.kind}.`), ...s.lines] },
    ...(s.graphic !== undefined ? { graphic: s.graphic } : {}),
  };
  const questions = s.items.map((it): ListeningQuestion => {
    if (it.graphic && s.graphic === undefined) throw new Error(`${key}: câu ${it.n} cần graphic nhưng nhóm không có`);
    return {
      key: questionKey(it.n),
      number: it.n,
      section: s.section,
      group_key: key,
      subskill: it.subskill,
      topic: s.topic,
      difficulty: it.difficulty,
      script: { segments: [narrate(`Number ${it.n}. ${it.stem}`)] },
      content: {
        type: 'mcq_single',
        stem: it.graphic && s.graphic !== undefined ? `${it.stem}\n\n${s.graphic}` : it.stem,
        options: it.options.map((text, i) => ({ key: letterAt(i), text })),
        answer_key: { correct: it.correct },
        media: media(PAUSE_LONG_MS),
        explanation: { vi: it.vi, en: it.en },
        evidence: it.evidence,
        tags: [],
      },
    };
  });
  return { group: g, questions };
}

const GRAPHIC_STEM = 'Look at the graphic.';
const meanStem = (who: 'man' | 'woman' | 'speaker', pronoun: 'he' | 'she', quote: string) =>
  `What does the ${who} mean when ${pronoun} says, "${quote}"?`;

// ===========================================================================
// PART 1 – Photographs (1–6)

const PART1: ListeningQuestion[] = [
  p1({
    n: 1,
    topic: 'office',
    difficulty: 'A2',
    reader: say('W1', 'au'),
    options: [
      'A woman is planting some flowers in a garden.',
      'A woman is opening a window.',
      'A woman is watering some plants.',
      'Some plants are being carried into a room.',
    ],
    correct: 'C',
    vi: '(C) mô tả đúng hành động: người phụ nữ đang tưới cây bằng bình tưới. Bẫy: (A) sai động tác và địa điểm (trồng hoa ngoài vườn); (B) có cửa sổ trong ảnh nhưng không ai mở; (D) các chậu cây nằm yên trên kệ, không ai bê.',
    en: '(C) matches the action: the woman is watering the plants with a watering can. Traps: (A) wrong action and place; (B) a window is visible but no one is opening it; (D) the plants are sitting on a cabinet, not being carried.',
    alt_vi:
      'Người phụ nữ đứng cạnh tủ gỗ dưới cửa sổ, cầm bình tưới nghiêng về phía ba chậu cây xanh, nước đang chảy xuống.',
    alt_en: 'A woman stands beside a wooden cabinet under a window, tilting a watering can over three potted plants.',
    svg: svg(
      '<rect width="800" height="600" fill="#EEF1F3"/><rect y="470" width="800" height="130" fill="#D8CBB9"/><rect x="420" y="50" width="300" height="220" fill="#C4DCE8" stroke="#FFF" stroke-width="14"/><path d="M570 50v220M420 160h300" stroke="#FFF" stroke-width="10"/><rect x="400" y="378" width="340" height="92" fill="#A47551"/><rect x="390" y="366" width="360" height="16" rx="4" fill="#8A5F40"/><path d="M570 395v60" stroke="#8A5F40" stroke-width="4"/><defs><g id="l01i1p"><ellipse cx="30" cy="-36" rx="15" ry="36" fill="#5E8C61"/><ellipse cx="10" cy="-24" rx="10" ry="26" fill="#7FAF7A" transform="rotate(-30 10 -24)"/><ellipse cx="50" cy="-24" rx="10" ry="26" fill="#7FAF7A" transform="rotate(30 50 -24)"/><path d="M0 0h60l-8 50h-44z" fill="#C97B5A"/></g></defs><use href="#l01i1p" x="470" y="316"/><use href="#l01i1p" x="560" y="316"/><use href="#l01i1p" x="650" y="316"/><circle cx="222" cy="142" r="38" fill="#2E2420"/><ellipse cx="188" cy="172" rx="15" ry="26" fill="#2E2420"/><circle cx="236" cy="150" r="31" fill="#C68B5E"/><rect x="228" y="176" width="16" height="20" fill="#C68B5E"/><path d="M214 396v70M260 396v70" stroke="#C68B5E" stroke-width="16"/><path d="M204 472h24M250 472h26" stroke="#2B2B2B" stroke-width="12" stroke-linecap="round"/><path d="M198 300h80l16 96H182z" fill="#3E4A5C"/><rect x="200" y="190" width="76" height="124" rx="26" fill="#7A9E7E"/><path d="M212 214l-14 86" stroke="#7A9E7E" stroke-width="20" stroke-linecap="round"/><path d="M262 212l44 10" stroke="#7A9E7E" stroke-width="20" stroke-linecap="round"/><path d="M306 222l44-20" stroke="#C68B5E" stroke-width="13" stroke-linecap="round"/><g transform="rotate(16 392 214)"><path d="M352 196c0-30 52-30 56 0" stroke="#3F5F8F" stroke-width="8" fill="none"/><rect x="350" y="194" width="80" height="54" rx="12" fill="#5B7DB1"/><path d="M428 210l62-28" stroke="#5B7DB1" stroke-width="10" stroke-linecap="round"/></g><g fill="#6FA8D6"><ellipse cx="503" cy="232" rx="3" ry="7"/><ellipse cx="496" cy="250" rx="3" ry="7"/><ellipse cx="508" cy="258" rx="3" ry="7"/><ellipse cx="500" cy="272" rx="3" ry="7"/></g>',
    ),
  }),
  p1({
    n: 2,
    topic: 'office',
    difficulty: 'B1',
    reader: say('M1', 'uk'),
    options: [
      'Some chairs have been arranged around a table.',
      'Some people are sitting at a table.',
      'Some chairs are stacked against a wall.',
      'A table is being wiped.',
    ],
    correct: 'A',
    vi: 'Ảnh không có người; ghế đã được xếp quanh bàn họp → (A) với bị động hoàn thành "have been arranged". Bẫy: (B) nhắc tới người ngồi trong khi phòng trống; (C) sai vị trí (ghế chồng sát tường); (D) "is being wiped" cần có người đang lau.',
    en: 'No one is in the room and the chairs have been placed around the table, so (A) with the present perfect passive is correct. Traps: (B) mentions people; (C) wrong position; (D) "is being wiped" needs someone doing the action.',
    alt_vi:
      'Phòng họp trống: bàn dài ở giữa, các ghế đặt quanh bàn (ba ghế phía sau, ba ghế phía trước, mỗi đầu bàn một ghế), màn hình tắt trên tường.',
    alt_en: 'An empty meeting room: chairs are placed around a long table, with a blank screen on the wall.',
    svg: svg(
      '<rect width="800" height="600" fill="#EEEAE4"/><rect y="380" width="800" height="220" fill="#CDBFAE"/><rect x="290" y="60" width="220" height="130" rx="6" fill="#3C4654" stroke="#9AA5B1" stroke-width="8"/><defs><g id="l01i2b"><rect width="74" height="78" rx="16" fill="#5B7DB1"/><rect x="8" y="10" width="58" height="56" rx="10" fill="#6E8FC2"/></g><g id="l01i2f"><rect width="84" height="96" rx="18" fill="#4D6C9E"/><path d="M14 96v52M70 96v52" stroke="#3A3F45" stroke-width="8"/></g></defs><use href="#l01i2b" x="230" y="286"/><use href="#l01i2b" x="363" y="286"/><use href="#l01i2b" x="496" y="286"/><path d="M76 300h26v120h-26zM60 390h60v14H60z" fill="#5B7DB1"/><path d="M698 300h26v120h-26zM680 390h60v14h-60z" fill="#5B7DB1"/><path d="M90 404v60M110 404v60M690 404v60M710 404v60" stroke="#3A3F45" stroke-width="6"/><path d="M190 360h420l70 90H120z" fill="#A47551"/><rect x="120" y="450" width="560" height="18" fill="#8A5F40"/><path d="M150 468v90M650 468v90" stroke="#8A5F40" stroke-width="14"/><use href="#l01i2f" x="180" y="430"/><use href="#l01i2f" x="358" y="430"/><use href="#l01i2f" x="536" y="430"/>',
    ),
  }),
  p1({
    n: 3,
    topic: 'office',
    difficulty: 'A2',
    reader: say('W1', 'ca'),
    options: [
      'A man is climbing a tree.',
      'A man is painting the ceiling.',
      'A ladder is lying on the floor.',
      'A man is standing on a ladder.',
    ],
    correct: 'D',
    vi: '(D) đúng: người đàn ông đứng trên thang để lắp bóng đèn. Bẫy: (A) sai vật (cái cây); (B) sai động tác (anh ấy cầm bóng đèn, không cầm cọ sơn); (C) sai vị trí, thang đang dựng đứng.',
    en: '(D) is correct: the man is standing on a ladder to fit a light bulb. Traps: (A) wrong object; (B) wrong action, he is holding a bulb, not a brush; (C) wrong position, the ladder is upright.',
    alt_vi: 'Người đàn ông mặc đồ bảo hộ, đội mũ, đứng trên thang, giơ tay đưa bóng đèn lên chiếc đèn trần.',
    alt_en: 'A man in work clothes and a cap stands on a ladder, holding a light bulb up to a ceiling lamp.',
    svg: svg(
      '<rect width="800" height="600" fill="#F0ECE6"/><rect width="800" height="34" fill="#DDE2E6"/><rect y="520" width="800" height="80" fill="#CDBFAE"/><rect x="600" y="150" width="130" height="190" fill="#C4DCE8" stroke="#FFF" stroke-width="10"/><path d="M490 34v36" stroke="#6B7178" stroke-width="4"/><path d="M450 96a40 30 0 0 1 80 0z" fill="#E2B93B"/><rect x="482" y="96" width="16" height="12" fill="#9AA5B1"/><path d="M300 525l40-300M440 525l-40-300" stroke="#9AA5B1" stroke-width="14" stroke-linecap="round"/><path d="M310 470h120M318 410h104M326 350h88M334 290h72" stroke="#9AA5B1" stroke-width="10"/><rect x="328" y="216" width="84" height="16" rx="4" fill="#7E8994"/><path d="M356 288l-6-92M384 288l6-92" stroke="#4F6D8F" stroke-width="24" stroke-linecap="round"/><path d="M342 294h22M378 294h22" stroke="#2B2B2B" stroke-width="12" stroke-linecap="round"/><rect x="334" y="96" width="74" height="112" rx="22" fill="#4F6D8F"/><path d="M344 120l-8 70" stroke="#4F6D8F" stroke-width="20" stroke-linecap="round"/><path d="M398 118l36-26" stroke="#4F6D8F" stroke-width="20" stroke-linecap="round"/><path d="M434 92l34 20" stroke="#8D5B3E" stroke-width="13" stroke-linecap="round"/><circle cx="371" cy="66" r="29" fill="#8D5B3E"/><path d="M342 62a29 29 0 0 1 58 0z" fill="#E2B93B"/><path d="M396 60h18" stroke="#E2B93B" stroke-width="7" stroke-linecap="round"/><circle cx="488" cy="124" r="15" fill="#F6E7A8" stroke="#D8C27A" stroke-width="3"/><rect x="482" y="106" width="12" height="9" fill="#B9B9B9"/>',
    ),
  }),
  p1({
    n: 4,
    topic: 'logistics',
    difficulty: 'A2',
    reader: say('M1', 'us'),
    options: [
      'A worker is lifting a box onto a shelf.',
      'A worker is pushing a cart loaded with boxes.',
      'Some boxes have fallen onto the floor.',
      'A truck is being unloaded.',
    ],
    correct: 'B',
    vi: '(B) đúng: công nhân đang đẩy xe đẩy chất thùng hàng. Bẫy: (A) có kệ hàng nhưng anh ấy không nâng thùng lên kệ; (C) các thùng vẫn nằm gọn trên xe; (D) không có xe tải trong ảnh.',
    en: '(B) is correct: the worker is pushing a cart with boxes on it. Traps: (A) shelves are visible but he is not lifting a box; (C) the boxes are still on the cart; (D) there is no truck.',
    alt_vi:
      'Trong nhà kho có kệ hàng phía sau, một công nhân đội mũ bảo hộ, mặc áo phản quang, đẩy xe đẩy chở các thùng các-tông.',
    alt_en: 'In a warehouse with shelves behind him, a worker in a hard hat pushes a cart carrying cardboard boxes.',
    svg: svg(
      '<rect width="800" height="600" fill="#E6E4DF"/><rect y="430" width="800" height="170" fill="#BDB6AA"/><path d="M40 40v390M400 40v390M760 40v390" stroke="#7A8794" stroke-width="12"/><path d="M40 160h720M40 290h720M40 420h720" stroke="#7A8794" stroke-width="10"/><g fill="#CDA678"><rect x="70" y="90" width="90" height="65"/><rect x="180" y="110" width="70" height="45"/><rect x="430" y="80" width="100" height="75"/><rect x="560" y="105" width="80" height="50"/><rect x="660" y="95" width="70" height="60"/><rect x="80" y="220" width="110" height="65"/><rect x="280" y="235" width="80" height="50"/><rect x="450" y="215" width="90" height="70"/><rect x="620" y="230" width="100" height="55"/></g><rect x="430" y="470" width="270" height="20" rx="4" fill="#5F6B78"/><path d="M438 480l-6-236" stroke="#5F6B78" stroke-width="10"/><path d="M418 244h26" stroke="#2E3338" stroke-width="12" stroke-linecap="round"/><circle cx="465" cy="510" r="20" fill="#2E3338"/><circle cx="665" cy="510" r="20" fill="#2E3338"/><g fill="#C49A6C" stroke="#A87E52" stroke-width="3"><rect x="450" y="370" width="120" height="100"/><rect x="575" y="395" width="110" height="75"/><rect x="470" y="285" width="90" height="85"/></g><path d="M510 370v-85M630 470v-75M510 470v-100" stroke="#A87E52" stroke-width="4"/><path d="M300 400l-50 118M300 400l40 118" stroke="#3E4A5C" stroke-width="24" stroke-linecap="round"/><path d="M236 522h30M330 522h30" stroke="#2B2B2B" stroke-width="12" stroke-linecap="round"/><path d="M300 396l50-150" stroke="#D9894E" stroke-width="54" stroke-linecap="round"/><path d="M352 268l70-22" stroke="#6C7A89" stroke-width="18" stroke-linecap="round"/><circle cx="424" cy="246" r="9" fill="#E0B48F"/><circle cx="372" cy="196" r="27" fill="#E0B48F"/><path d="M344 192a28 28 0 0 1 56 0z" fill="#E2B93B"/>',
    ),
  }),
  p1({
    n: 5,
    topic: 'travel',
    difficulty: 'A2',
    reader: say('W1', 'uk'),
    options: [
      'Some bicycles are parked in a row.',
      'A man is riding a bicycle down the street.',
      'Some bicycles are being repaired.',
      'Some cars are lined up along the road.',
    ],
    correct: 'A',
    vi: '(A) đúng: bốn chiếc xe đạp đỗ thành một hàng trước toà nhà. Bẫy: (B) không có ai đạp xe; (C) "are being repaired" cần có người đang sửa; (D) sai vật (ô tô) dù "lined up" gần nghĩa "in a row".',
    en: '(A) is correct: four bicycles are parked in a row in front of a building. Traps: (B) no one is riding; (C) "are being repaired" needs someone repairing them; (D) wrong object, even though "lined up" is close to "in a row".',
    alt_vi: 'Bốn chiếc xe đạp nhiều màu đỗ thành hàng dọc lan can trên vỉa hè trước một toà nhà; không có người.',
    alt_en:
      'Four bicycles of different colors are parked in a row along a railing on the sidewalk in front of a building; no people.',
    svg: svg(
      '<rect width="800" height="600" fill="#DCE8F0"/><rect y="40" width="800" height="340" fill="#E8DCCB"/><g fill="#9FB7C9"><rect x="60" y="80" width="90" height="110"/><rect x="230" y="80" width="90" height="110"/><rect x="480" y="80" width="90" height="110"/><rect x="650" y="80" width="90" height="110"/><rect x="60" y="230" width="90" height="110"/><rect x="650" y="230" width="90" height="110"/></g><rect x="350" y="220" width="100" height="160" fill="#8A5F40"/><rect y="380" width="800" height="220" fill="#CFC8BD"/><path d="M20 410h760M40 410v110M240 410v110M440 410v110M640 410v110M760 410v110" stroke="#6B7178" stroke-width="8"/><defs><g id="l01i5k" fill="none" stroke-width="6"><circle r="38" stroke="#3A3F45"/><circle cx="124" r="38" stroke="#3A3F45"/><path d="M0 0l54 4-14-68zM54 4l50-68M40-64h64M104-64l20 64" stroke="currentColor" stroke-linejoin="round"/><path d="M28-74h30" stroke="#2B2B2B" stroke-width="10" stroke-linecap="round"/><path d="M104-64l-4-16h20" stroke="#2B2B2B" stroke-linecap="round"/></g></defs><use href="#l01i5k" x="56" y="522" color="#B5654F"/><use href="#l01i5k" x="244" y="522" color="#4F7C6A"/><use href="#l01i5k" x="432" y="522" color="#4F6D8F"/><use href="#l01i5k" x="620" y="522" color="#C08E3E"/>',
    ),
  }),
  p1({
    n: 6,
    topic: 'business',
    difficulty: 'B2',
    reader: say('M1', 'ca'),
    options: [
      'A presenter is drawing a chart on a board.',
      'Some people are leaving a meeting room.',
      'A presenter is handing out some documents.',
      'A presenter is gesturing toward a chart.',
    ],
    correct: 'D',
    vi: '(D) đúng: người thuyết trình đưa tay về phía biểu đồ cột ("gesture toward" = ra hiệu, chỉ về phía). Bẫy: (A) biểu đồ đã có sẵn, cô ấy không vẽ; (B) người nghe đang ngồi, không rời phòng; (C) không có tài liệu nào được phát.',
    en: '(D) is correct: the presenter is gesturing toward the bar chart. Traps: (A) the chart is already there, she is not drawing it; (B) the listeners are seated; (C) no documents are being handed out.',
    alt_vi:
      'Người phụ nữ đứng cạnh bảng có biểu đồ cột, đưa tay chỉ về phía cột cao nhất; hai người ngồi quay lưng lắng nghe.',
    alt_en:
      'A woman stands next to a board showing a bar chart and points toward the tallest bar while two seated people listen.',
    svg: svg(
      '<rect width="800" height="600" fill="#EEF0F3"/><rect y="460" width="800" height="140" fill="#CFC4B6"/><rect x="80" y="60" width="420" height="280" rx="6" fill="#FFF" stroke="#9AA5B1" stroke-width="8"/><path d="M130 100v200h330" stroke="#555D66" stroke-width="5" fill="none"/><g fill="#5B7DB1"><rect x="160" y="220" width="50" height="80"/><rect x="235" y="180" width="50" height="120"/><rect x="310" y="200" width="50" height="100"/><rect x="385" y="110" width="50" height="190"/></g><circle cx="602" cy="160" r="36" fill="#3A2A20"/><circle cx="588" cy="170" r="30" fill="#E0B48F"/><rect x="580" y="194" width="16" height="16" fill="#E0B48F"/><path d="M566 330v138M598 330v138" stroke="#3E4A5C" stroke-width="22"/><path d="M556 474h22M590 474h22" stroke="#2B2B2B" stroke-width="12" stroke-linecap="round"/><rect x="552" y="206" width="76" height="134" rx="24" fill="#C9785D"/><path d="M616 230l8 88" stroke="#C9785D" stroke-width="20" stroke-linecap="round"/><path d="M566 228l-52-38" stroke="#C9785D" stroke-width="20" stroke-linecap="round"/><path d="M514 190l-32-14" stroke="#E0B48F" stroke-width="12" stroke-linecap="round"/><rect x="170" y="520" width="150" height="120" rx="48" fill="#5B7DB1"/><circle cx="245" cy="480" r="38" fill="#2E2420"/><rect x="390" y="530" width="150" height="110" rx="48" fill="#7A9E7E"/><circle cx="465" cy="492" r="36" fill="#6B4A32"/>',
    ),
  }),
];

// ===========================================================================
// PART 2 – Question-Response (7–31)

const PART2: ListeningQuestion[] = [
  p2({
    n: 7,
    topic: 'office',
    subskill: 'wh_question',
    form: 'wh',
    difficulty: 'A2',
    asker: say('W1', 'us'),
    responder: say('M1', 'uk'),
    prompt: 'Where can I find more paper for the printer?',
    responses: ['Yes, I printed the report.', 'In the cabinet next to the copier.', 'About two hundred pages.'],
    correct: 'B',
    vi: '"Where" hỏi địa điểm: (B) "In the cabinet next to the copier" (trong tủ cạnh máy photocopy). Bẫy: (A) trả lời Yes cho câu hỏi Wh- và lặp âm "print"; (C) nói về số lượng.',
    en: '"Where" asks for a location: (B) "In the cabinet next to the copier." Traps: (A) answers "Yes" to a Wh- question and echoes "print"; (C) gives a quantity.',
  }),
  p2({
    n: 8,
    topic: 'travel',
    subskill: 'similar_sound',
    form: 'wh',
    difficulty: 'A2',
    asker: say('M1', 'au'),
    responder: say('W1', 'ca'),
    prompt: 'When does the next train to Port Callan leave?',
    responses: ['From platform four.', "I'll train the new staff.", 'In about fifteen minutes.'],
    correct: 'C',
    vi: '"When" hỏi thời gian: (C) "In about fifteen minutes" (khoảng 15 phút nữa). Bẫy âm giống: ở (B) "train" là động từ "đào tạo"; (A) trả lời địa điểm (Where).',
    en: '"When" asks for a time: (C) "In about fifteen minutes." Sound trap: in (B) "train" is the verb meaning "teach"; (A) answers "Where".',
  }),
  p2({
    n: 9,
    topic: 'business',
    subskill: 'yes_no_question',
    form: 'yes_no',
    difficulty: 'A2',
    asker: say('W1', 'uk'),
    responder: say('M1', 'us'),
    prompt: 'Have you met our new sales director yet?',
    responses: [
      'Yes, she introduced herself this morning.',
      'Sales went up last quarter.',
      "Let's meet at the front entrance.",
    ],
    correct: 'A',
    vi: 'Câu hỏi Yes/No về việc đã gặp giám đốc mới chưa; (A) "Yes" kèm chi tiết hợp lý. Bẫy: (B) lặp từ "sales"; (C) dùng "meet" (gần âm "met") nhưng không trả lời câu hỏi.',
    en: 'A Yes/No question about meeting the new director; (A) says "Yes" and adds a logical detail. Traps: (B) repeats "sales"; (C) reuses "meet" from "met" without answering.',
  }),
  p2({
    n: 10,
    topic: 'office',
    subskill: 'indirect_response',
    form: 'wh',
    difficulty: 'B1',
    asker: say('M1', 'ca'),
    responder: say('W1', 'au'),
    prompt: "Who's in charge of ordering supplies for the break room?",
    responses: ['Ask Ms. Ferreira at the front desk.', 'Coffee, tea, and some snacks.', 'Yes, it was a large order.'],
    correct: 'A',
    vi: 'Trả lời gián tiếp: không nêu tên người phụ trách mà chỉ người có thể biết ("Ask Ms. Ferreira…"). Bẫy: (B) liên tưởng tới đồ dùng phòng nghỉ; (C) trả lời Yes cho câu Wh- và lặp "order".',
    en: 'An indirect answer: instead of naming the person, the speaker refers the listener to someone who knows. Traps: (B) lists break-room items; (C) answers "Yes" to a Wh- question and repeats "order".',
  }),
  p2({
    n: 11,
    topic: 'shopping',
    subskill: 'choice_question',
    form: 'choice',
    difficulty: 'A2',
    asker: say('W1', 'us'),
    responder: say('M1', 'au'),
    prompt: 'Would you like to pay by card or in cash?',
    responses: ["Yes, I'd like that.", 'The cash register is new.', 'By card, please.'],
    correct: 'C',
    vi: 'Câu hỏi lựa chọn "A or B" → chọn một: (C) "By card, please". Bẫy: (A) trả lời Yes cho câu hỏi lựa chọn; (B) lặp từ "cash".',
    en: 'An "A or B" question needs a choice: (C) "By card, please." Traps: (A) gives a yes/no answer to a choice question; (B) repeats "cash".',
  }),
  p2({
    n: 12,
    topic: 'logistics',
    subskill: 'tag_question',
    form: 'tag',
    difficulty: 'B1',
    asker: say('M1', 'uk'),
    responder: say('W1', 'ca'),
    prompt: "The shipment from Marrowfield Logistics arrived this morning, didn't it?",
    responses: ["No, I didn't ship it.", "Yes, it's in the loading area now.", 'A large shipping company.'],
    correct: 'B',
    vi: 'Câu hỏi đuôi xác nhận lô hàng đã đến; (B) "Yes" kèm vị trí hiện tại của lô hàng. Bẫy: (A) và (C) lặp âm "ship/shipping" nhưng không khớp nội dung.',
    en: 'A tag question checking that the shipment arrived; (B) confirms it and says where it is now. Traps: (A) and (C) echo "ship/shipping" without answering.',
  }),
  p2({
    n: 13,
    topic: 'office',
    subskill: 'request_suggestion',
    form: 'request',
    difficulty: 'A2',
    asker: say('W1', 'au'),
    responder: say('M1', 'us'),
    prompt: 'Could you help me move these chairs into the training room?',
    responses: ['The training lasted two hours.', 'We moved here last year.', "Sure, I'll be right there."],
    correct: 'C',
    vi: 'Lời nhờ "Could you…?" → đồng ý giúp: (C) "Sure, I\'ll be right there". Bẫy: (A) lặp "training"; (B) lặp "move/moved" nhưng nói chuyện khác.',
    en: 'A request ("Could you...?") is answered by agreeing to help: (C). Traps: (A) repeats "training"; (B) repeats "move" in a different sense.',
  }),
  p2({
    n: 14,
    topic: 'office',
    subskill: 'indirect_response',
    form: 'wh',
    difficulty: 'B1',
    asker: say('M1', 'ca'),
    responder: say('W1', 'uk'),
    prompt: 'Why is the elevator out of service today?',
    responses: ["There's a notice about it in the lobby.", 'The service was excellent.', 'On the third floor.'],
    correct: 'A',
    vi: 'Trả lời gián tiếp: người nói không giải thích lý do mà chỉ nơi có thông báo về việc đó. Bẫy: (B) lặp "service" với nghĩa "phục vụ"; (C) trả lời địa điểm.',
    en: 'An indirect answer: rather than giving the reason, the speaker points to a notice that explains it. Traps: (B) repeats "service" in another sense; (C) gives a location.',
  }),
  p2({
    n: 15,
    topic: 'technology',
    subskill: 'statement_response',
    form: 'statement',
    difficulty: 'B1',
    asker: say('W1', 'ca'),
    responder: say('M1', 'au'),
    prompt: 'My laptop keeps shutting down during video calls.',
    responses: [
      "Let's call them back later.",
      'The IT team can take a look at it this afternoon.',
      'Down the hall on your left.',
    ],
    correct: 'B',
    vi: 'Câu trần thuật nêu sự cố → phản hồi hợp lý là gợi ý cách xử lý: bộ phận IT kiểm tra (B). Bẫy: (A) lặp "call"; (C) lặp "down" (từ "shutting down") và trả lời chỉ đường.',
    en: 'A statement describing a problem; the natural response offers a solution (B). Traps: (A) repeats "call"; (C) echoes "down" and gives directions.',
  }),
  p2({
    n: 16,
    topic: 'travel',
    subskill: 'wh_question',
    form: 'wh',
    difficulty: 'A2',
    asker: say('M1', 'us'),
    responder: say('W1', 'uk'),
    prompt: 'How long is the flight to Dunhaven?',
    responses: ["It's a long list.", 'Just under two hours.', 'At gate twelve.'],
    correct: 'B',
    vi: '"How long" hỏi khoảng thời gian: (B) "Just under two hours" (chưa tới hai tiếng). Bẫy: (A) lặp "long"; (C) trả lời địa điểm.',
    en: '"How long" asks for a duration: (B) "Just under two hours." Traps: (A) repeats "long"; (C) gives a place.',
  }),
  p2({
    n: 17,
    topic: 'business',
    subskill: 'request_suggestion',
    form: 'request',
    difficulty: 'B1',
    asker: say('W1', 'au'),
    responder: say('M1', 'ca'),
    prompt: "Why don't we hold the product launch at the Glenmere Hotel?",
    responses: [
      'Because it was launched last year.',
      'Please hold the door for me.',
      'Good idea. It has a large ballroom.',
    ],
    correct: 'C',
    vi: '"Why don\'t we…?" là lời đề xuất, không phải hỏi lý do → đồng ý kèm lý do ủng hộ (C). Bẫy: (A) mở đầu bằng "Because" như trả lời câu hỏi Why; (B) lặp "hold".',
    en: '"Why don\'t we...?" is a suggestion, not a request for a reason; (C) agrees and supports it. Traps: (A) starts with "Because" as if answering "Why"; (B) repeats "hold".',
  }),
  p2({
    n: 18,
    topic: 'finance',
    subskill: 'indirect_response',
    form: 'yes_no',
    difficulty: 'B2',
    asker: say('M1', 'uk'),
    responder: say('W1', 'us'),
    prompt: "Hasn't next year's budget been approved yet?",
    responses: [
      'The board meets again on Friday.',
      "There's a budget hotel near the station.",
      'About five percent more.',
    ],
    correct: 'A',
    vi: 'Trả lời gián tiếp: "Hội đồng quản trị họp lại vào thứ Sáu" ngụ ý ngân sách chưa được duyệt. Bẫy: (B) lặp "budget" với nghĩa "giá rẻ"; (C) đưa ra con số, không khớp câu hỏi Yes/No.',
    en: 'An indirect answer: saying the board meets again on Friday implies the budget has not been approved. Traps: (B) repeats "budget" meaning "low-cost"; (C) gives a figure.',
  }),
  p2({
    n: 19,
    topic: 'health',
    subskill: 'wh_question',
    form: 'wh',
    difficulty: 'A2',
    asker: say('W1', 'ca'),
    responder: say('W2', 'us'),
    prompt: 'What time does the clinic open on Saturdays?',
    responses: ["It's a new clinic.", 'Yes, it opened last month.', "At nine o'clock, I believe."],
    correct: 'C',
    vi: '"What time" hỏi giờ: (C) "At nine o\'clock". Bẫy: (A) lặp "clinic"; (B) trả lời Yes và lặp "open/opened".',
    en: '"What time" asks for a time: (C). Traps: (A) repeats "clinic"; (B) answers "Yes" and repeats "open".',
  }),
  p2({
    n: 20,
    topic: 'office',
    subskill: 'request_suggestion',
    form: 'request',
    difficulty: 'A2',
    asker: say('M1', 'au'),
    responder: say('W1', 'uk'),
    prompt: 'Would you like me to make copies of the agenda?',
    responses: ['Some coffee would be nice.', 'Yes, ten copies, please.', 'The agenda was very long.'],
    correct: 'B',
    vi: 'Lời đề nghị giúp "Would you like me to…?" → nhận lời kèm số lượng (B). Bẫy: (A) "coffee" gần âm "copies"; (C) lặp "agenda".',
    en: 'An offer ("Would you like me to...?") is accepted with a detail (B). Traps: (A) "coffee" sounds like "copies"; (C) repeats "agenda".',
  }),
  p2({
    n: 21,
    topic: 'hr',
    subskill: 'indirect_response',
    form: 'statement',
    difficulty: 'B2',
    asker: say('W1', 'us'),
    responder: say('M1', 'ca'),
    prompt: 'I heard the company is opening a new branch in Holloway.',
    responses: [
      'That would explain all the new job postings.',
      'Some branches fell during the storm.',
      "I'll hear back from them on Monday.",
    ],
    correct: 'A',
    vi: 'Phản hồi gián tiếp cho câu trần thuật: người nghe liên hệ tin này với việc công ty đăng nhiều tin tuyển dụng (A). Bẫy: (B) "branches" nghĩa là "cành cây"; (C) "hear" lặp âm "heard".',
    en: 'An indirect response linking the news to the recent job postings (A). Traps: (B) uses "branches" meaning tree limbs; (C) echoes "heard" with "hear".',
  }),
  p2({
    n: 22,
    topic: 'shopping',
    subskill: 'wh_question',
    form: 'wh',
    difficulty: 'B1',
    asker: say('M1', 'uk'),
    responder: say('W1', 'au'),
    prompt: 'Which printer should we order for the new office?',
    responses: ['In the order they arrived.', 'Yes, the office is new.', 'The one we tested last week worked well.'],
    correct: 'C',
    vi: '"Which" hỏi chọn cái nào → (C) "The one we tested last week" (cái đã dùng thử tuần trước). Bẫy: (A) "order" nghĩa "thứ tự"; (B) trả lời Yes và lặp "office".',
    en: '"Which" asks for a choice: (C) points to the printer they tested. Traps: (A) uses "order" meaning sequence; (B) answers "Yes" and repeats "office".',
  }),
  p2({
    n: 23,
    topic: 'travel',
    subskill: 'tag_question',
    form: 'tag',
    difficulty: 'B1',
    asker: say('W1', 'ca'),
    responder: say('M1', 'uk'),
    prompt: "You've booked a hotel for the conference, haven't you?",
    responses: ["It's a very good book.", "Not yet, but I'll do it today.", 'The conference was in May.'],
    correct: 'B',
    vi: 'Câu hỏi đuôi xác nhận đã đặt phòng chưa → (B) "Not yet, but I\'ll do it today". Bẫy: (A) "book" là danh từ "quyển sách"; (C) lặp "conference" và sai thì.',
    en: 'A tag question about the hotel booking; (B) says it has not been done yet. Traps: (A) uses "book" as a noun; (C) repeats "conference" in the wrong tense.',
  }),
  p2({
    n: 24,
    topic: 'logistics',
    subskill: 'indirect_response',
    form: 'wh',
    difficulty: 'B1',
    asker: say('M1', 'us'),
    responder: say('M2', 'au'),
    prompt: 'How much will it cost to repair the delivery van?',
    responses: ['The mechanic is still checking it.', 'They deliver on weekdays.', 'About two kilometers.'],
    correct: 'A',
    vi: 'Trả lời gián tiếp: chưa biết chi phí vì thợ máy vẫn đang kiểm tra xe (A). Bẫy: (B) lặp âm "deliver"; (C) trả lời khoảng cách (How far).',
    en: 'An indirect answer: the cost is not known yet because the mechanic is still checking the van (A). Traps: (B) echoes "deliver"; (C) gives a distance.',
  }),
  p2({
    n: 25,
    topic: 'office',
    subskill: 'choice_question',
    form: 'choice',
    difficulty: 'B1',
    asker: say('W1', 'uk'),
    responder: say('M1', 'ca'),
    prompt: 'Should we send the invitations by e-mail or by post?',
    responses: ['Yes, I sent them yesterday.', 'The post office is on Larch Street.', 'E-mail would be faster.'],
    correct: 'C',
    vi: 'Câu hỏi lựa chọn → chọn "E-mail" kèm lý do (C). Bẫy: (A) trả lời Yes cho câu lựa chọn và lặp "send/sent"; (B) lặp "post".',
    en: 'A choice question answered by choosing e-mail and giving a reason (C). Traps: (A) answers "Yes" and echoes "send"; (B) repeats "post".',
  }),
  p2({
    n: 26,
    topic: 'business',
    subskill: 'indirect_response',
    form: 'yes_no',
    difficulty: 'B2',
    asker: say('M1', 'au'),
    responder: say('W1', 'us'),
    prompt: 'Are you going to the trade fair in Port Callan next week?',
    responses: [
      'The bus fare is twelve dollars.',
      'We signed a trade agreement.',
      "My manager hasn't decided who's going yet.",
    ],
    correct: 'C',
    vi: 'Trả lời gián tiếp: chưa biết vì quản lý chưa quyết định ai sẽ đi (C). Bẫy âm giống: (A) "fare" (giá vé) đồng âm với "fair" (hội chợ); (B) lặp "trade".',
    en: 'An indirect answer: the speaker does not know yet because the manager has not decided (C). Traps: (A) "fare" sounds the same as "fair"; (B) repeats "trade".',
  }),
  p2({
    n: 27,
    topic: 'technology',
    subskill: 'statement_response',
    form: 'statement',
    difficulty: 'B1',
    asker: say('W1', 'au'),
    responder: say('M1', 'uk'),
    prompt: 'The new software update is ready to download.',
    responses: [
      "It's in a downtown location.",
      "Great, I'll install it after lunch.",
      'An update on the sales figures.',
    ],
    correct: 'B',
    vi: 'Câu trần thuật báo bản cập nhật đã sẵn sàng → phản hồi tự nhiên: sẽ cài sau bữa trưa (B). Bẫy: (A) "downtown" gần âm "download"; (C) lặp "update" với nghĩa "thông tin mới".',
    en: 'A statement that an update is available; (B) responds naturally by planning to install it. Traps: (A) "downtown" sounds like "download"; (C) repeats "update" in another sense.',
  }),
  p2({
    n: 28,
    topic: 'office',
    subskill: 'indirect_response',
    form: 'request',
    difficulty: 'B2',
    asker: say('M1', 'ca'),
    responder: say('W1', 'us'),
    prompt: "Can you send me the minutes from yesterday's meeting?",
    responses: ['Kenji is still typing them up.', 'In about five minutes.', 'Yes, it was a long meeting.'],
    correct: 'A',
    vi: 'Trả lời gián tiếp: biên bản chưa xong vì Kenji vẫn đang đánh máy (A). Bẫy: (B) "minutes" nghĩa "phút" (trong câu hỏi là "biên bản họp"); (C) trả lời Yes và lặp "meeting".',
    en: 'An indirect answer: the minutes are not ready because Kenji is still typing them (A). Traps: (B) uses "minutes" as a unit of time; (C) repeats "meeting".',
  }),
  p2({
    n: 29,
    topic: 'logistics',
    subskill: 'similar_sound',
    form: 'wh',
    difficulty: 'A2',
    asker: say('W1', 'uk'),
    responder: say('M1', 'au'),
    prompt: 'Who left these boxes in the hallway?',
    responses: ['Turn left at the corner.', 'Someone from the shipping department.', 'About ten boxes.'],
    correct: 'B',
    vi: '"Who" hỏi người: (B) "Someone from the shipping department". Bẫy âm giống: (A) "left" nghĩa "bên trái" (khác "left" = để lại); (C) trả lời số lượng.',
    en: '"Who" asks for a person: (B). Sound trap: in (A) "left" means the direction, not "placed"; (C) gives a quantity.',
  }),
  p2({
    n: 30,
    topic: 'travel',
    subskill: 'yes_no_question',
    form: 'yes_no',
    difficulty: 'B1',
    asker: say('M1', 'us'),
    responder: say('W1', 'ca'),
    prompt: "Isn't Ms. Varga flying back from Holloway today?",
    responses: [
      'The flyer is on the notice board.',
      'Back in the storage room.',
      'No, her trip was extended until Thursday.',
    ],
    correct: 'C',
    vi: 'Câu hỏi phủ định vẫn trả lời như Yes/No thường: (C) "No, her trip was extended…" (chuyến đi kéo dài tới thứ Năm). Bẫy: (A) "flyer" gần âm "flying"; (B) lặp "back".',
    en: 'A negative question is answered like a normal Yes/No question: (C). Traps: (A) "flyer" sounds like "flying"; (B) repeats "back".',
  }),
  p2({
    n: 31,
    topic: 'business',
    subskill: 'wh_question',
    form: 'wh',
    difficulty: 'B1',
    asker: say('W1', 'au'),
    responder: say('M1', 'uk'),
    prompt: 'How did the client respond to our proposal?',
    responses: ['She asked for a few changes to the price.', 'By express mail.', "The client's office is downtown."],
    correct: 'A',
    vi: '"How did … respond" hỏi phản ứng của khách hàng → (A) khách yêu cầu điều chỉnh giá. Bẫy: (B) hiểu "How" là "bằng cách nào" (phương tiện gửi); (C) lặp "client".',
    en: '"How did ... respond" asks about the reaction: (A) the client asked for price changes. Traps: (B) treats "how" as a method of sending; (C) repeats "client".',
  }),
];

// ===========================================================================
// PART 3 – Conversations (32–70)

const P3_C01 = (() => {
  const w = say('W1', 'us');
  const m = say('M1', 'uk');
  return group({
    section: 'part3',
    index: 1,
    topic: 'technology',
    title: 'Conversation 1',
    kind: 'conversation',
    lines: [
      w(
        "Hi, Daniel. The projector in Meeting Room B won't turn on, and I'm presenting our new packaging designs to the Velmora Textiles team at ten o'clock.",
      ),
      m('Oh no. Did you check the power cable? Sometimes it comes loose from the wall.'),
      w("I did. The cable's fine, but the screen just stays dark. I think the bulb might have burned out."),
      m(
        "That's possible. Unfortunately, the technician won't be in until this afternoon. But Meeting Room D has a large television that you can connect your laptop to.",
      ),
      w('That would work. Is anyone using it this morning?'),
      m("Let me check the booking system. No, it's free until noon. I'll reserve it for you right now."),
    ],
    items: [
      {
        n: 32,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What problem does the woman mention?',
        options: [
          'A meeting has been canceled.',
          'Her laptop has no power.',
          'A client has arrived late.',
          'Some equipment is not working.',
        ],
        correct: 'D',
        vi: 'Người phụ nữ nói máy chiếu ở phòng họp B không bật được → "thiết bị không hoạt động" (D). Bẫy: (B) có nhắc laptop nhưng laptop không hỏng; (A), (C) không được nói tới.',
        en: 'The woman says the projector will not turn on, so a piece of equipment is not working (D). Trap: a laptop is mentioned, but it has no problem.',
        evidence: "The projector in Meeting Room B won't turn on",
      },
      {
        n: 33,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'Why is the technician unable to help right away?',
        options: [
          'He will not arrive until later.',
          'He is repairing another projector.',
          'He is on vacation this week.',
          'He needs to order a new bulb.',
        ],
        correct: 'A',
        vi: '"won\'t be in until this afternoon" = chiều mới tới văn phòng → (A). Bẫy: (D) lặp từ "bulb" trong câu đoán của người phụ nữ.',
        en: '"Won\'t be in until this afternoon" means he will arrive later (A). Trap: (D) reuses "bulb" from the woman\'s guess.',
        evidence: "the technician won't be in until this afternoon",
      },
      {
        n: 34,
        subskill: 'next_action',
        difficulty: 'B1',
        stem: 'What will the man most likely do next?',
        options: ['Check a power cable', 'Contact a client', 'Reserve a room', 'Buy a television'],
        correct: 'C',
        vi: 'Người đàn ông nói sẽ đặt phòng họp D ngay → (C). Bẫy: (A) việc kiểm tra dây điện đã làm rồi; (D) TV đã có sẵn trong phòng D.',
        en: 'He says he will reserve Meeting Room D right now (C). Traps: the cable has already been checked, and the television is already in Room D.',
        evidence: "I'll reserve it for you right now.",
      },
    ],
  });
})();

const P3_C02 = (() => {
  const m = say('M1', 'au');
  const w = say('W1', 'ca');
  return group({
    section: 'part3',
    index: 2,
    topic: 'travel',
    title: 'Conversation 2',
    kind: 'conversation',
    lines: [
      m('Good evening, and welcome to the Tessaline Hotel. How can I help you?'),
      w(
        "Hi, I have a reservation under the name Ines Marlow. I'm in town for a conference at the Port Callan Convention Center.",
      ),
      m('Yes, Ms. Marlow. I have you down for three nights, checking out on Thursday.'),
      w("Actually, the conference has been extended by a day, so I'd like to stay until Friday morning, if possible."),
      m("Let me see. We have a room available for Thursday night, but you'd need to move to a different floor."),
      w("That's fine. Oh, and is there a shuttle to the convention center?"),
      m('Yes, one leaves from the main entrance every thirty minutes, starting at seven A.M.'),
    ],
    items: [
      {
        n: 35,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'Where does the conversation most likely take place?',
        options: ['At a convention center', 'At a hotel', 'At an airport', 'At a travel agency'],
        correct: 'B',
        vi: 'Lời chào "welcome to the Tessaline Hotel" và việc kiểm tra đặt phòng cho thấy hội thoại diễn ra ở khách sạn (B). Bẫy: (A) trung tâm hội nghị chỉ là nơi người phụ nữ sẽ đến.',
        en: 'The greeting and the reservation show the speakers are at a hotel (B). Trap: the convention center is only where the woman is going.',
        evidence: 'welcome to the Tessaline Hotel',
      },
      {
        n: 36,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'Why does the woman want to change her reservation?',
        options: [
          'Her flight was canceled.',
          'She needs a larger room.',
          'A colleague is joining her.',
          'An event will last longer than planned.',
        ],
        correct: 'D',
        vi: '"the conference has been extended by a day" (hội nghị kéo dài thêm một ngày) được diễn đạt lại thành "kéo dài hơn dự kiến" (D). Các lý do còn lại không được nhắc tới.',
        en: '"The conference has been extended by a day" is paraphrased as "last longer than planned" (D). The other reasons are not mentioned.',
        evidence: 'the conference has been extended by a day',
      },
      {
        n: 37,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man say about the shuttle?',
        options: [
          'It runs every half hour.',
          'It must be booked in advance.',
          'It leaves from a side entrance.',
          'It starts running at nine A.M.',
        ],
        correct: 'A',
        vi: '"every thirty minutes" = mỗi nửa tiếng (A). Bẫy: (C) xe đón ở cửa chính, không phải cửa phụ; (D) xe chạy từ 7 giờ, không phải 9 giờ.',
        en: '"Every thirty minutes" means every half hour (A). Traps: it leaves from the main entrance and starts at seven, not nine.',
        evidence: 'one leaves from the main entrance every thirty minutes',
      },
    ],
  });
})();

const P3_C03 = (() => {
  const w1 = say('W1', 'uk');
  const m = say('M1', 'ca');
  const w2 = say('W2', 'us');
  return group({
    section: 'part3',
    index: 3,
    topic: 'hr',
    title: 'Conversation 3',
    kind: 'conversation with three speakers',
    lines: [
      w1(
        'Marcus, Helen, thanks for joining me. We need to finalize the orientation schedule for the twelve new employees who start on Monday.',
      ),
      m("Sure. I've already booked the training room for the whole morning. The welcome talk will begin at nine."),
      w2(
        "And I'll lead a session on our payroll system after that. By the way, have the new employees received their building passes yet?",
      ),
      w1("Not yet. Security told me the passes won't be printed until Tuesday."),
      m('Then someone will have to meet them at the front entrance on Monday and sign them in.'),
      w2("I can do that. My first meeting isn't until ten thirty."),
    ],
    items: [
      {
        n: 38,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What are the speakers mainly discussing?',
        options: [
          'A payroll error',
          'A new security policy',
          'Plans for welcoming new staff',
          'The renovation of a training room',
        ],
        correct: 'C',
        vi: 'Ba người hoàn tất lịch định hướng (orientation) cho nhân viên mới → (C). Bẫy: payroll, security, training room chỉ là chi tiết trong hội thoại.',
        en: 'The speakers are finalizing the orientation schedule for new employees (C). Traps: payroll, security and the training room are only details.',
        evidence: 'We need to finalize the orientation schedule for the twelve new employees who start on Monday.',
      },
      {
        n: 39,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man say he has done?',
        options: ['Printed some passes', 'Hired a trainer', 'Reserved a room', 'Sent out a schedule'],
        correct: 'C',
        vi: '"booked the training room" = đã đặt phòng (C). Bẫy: (A) thẻ ra vào chưa được in; (D) lịch chưa được gửi.',
        en: '"Booked the training room" is paraphrased as "reserved a room" (C). Traps: the passes have not been printed, and no schedule has been sent.',
        evidence: "I've already booked the training room for the whole morning.",
      },
      {
        n: 40,
        subskill: 'listening_inference',
        difficulty: 'B2',
        stem: 'Why will the new employees need to be signed in on Monday?',
        options: [
          'The training room will be locked.',
          'Their passes will not be ready.',
          'The security desk will be closed.',
          'Their names are missing from a list.',
        ],
        correct: 'B',
        vi: 'Thẻ ra vào đến thứ Ba mới in xong, nên thứ Hai nhân viên mới chưa có thẻ và phải có người đón, ký vào giúp → (B). Cần nối hai lượt lời liên tiếp.',
        en: 'The passes will not be printed until Tuesday, so on Monday the new staff must be signed in (B). The answer links two consecutive turns.',
        evidence: "Security told me the passes won't be printed until Tuesday.",
      },
    ],
  });
})();

const P3_C04 = (() => {
  const w = say('W1', 'au');
  const m = say('M1', 'us');
  return group({
    section: 'part3',
    index: 4,
    topic: 'shopping',
    title: 'Conversation 4',
    kind: 'conversation',
    lines: [
      w(
        "Hello, I'm calling about a desk I ordered from your Web site. It was delivered yesterday, but the box didn't include any screws, so I can't put it together.",
      ),
      m("I'm very sorry about that. Could I have your name, please?"),
      w("It's Amira Castell."),
      m(
        'Thank you, Ms. Castell. I see your order here. I can mail you a hardware kit today, and it should arrive by Thursday.',
      ),
      w('Hmm, I was hoping to use the desk this weekend. Is your store on Larch Street open on Sunday?'),
      m("Yes, from ten to five. I'll leave a kit for you at the customer service counter."),
      w("Perfect. I'll stop by on Sunday morning."),
    ],
    items: [
      {
        n: 41,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'Why is the woman calling?',
        options: [
          'Some parts are missing from an order.',
          'A delivery has not arrived.',
          'She was charged the wrong price.',
          'She received the wrong desk.',
        ],
        correct: 'A',
        vi: 'Hộp bàn không có ốc vít → đơn hàng thiếu linh kiện (A). Bẫy: (B) bàn đã được giao hôm qua.',
        en: 'The box came without screws, so parts are missing from the order (A). Trap: the desk was delivered yesterday.',
        evidence: "the box didn't include any screws",
      },
      {
        n: 42,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man first offer to do?',
        options: ['Give a full refund', 'Send a technician', 'Exchange the desk', 'Mail some hardware'],
        correct: 'D',
        vi: 'Đề nghị đầu tiên: gửi qua bưu điện bộ phụ kiện (hardware kit) → (D). Sau đó anh ấy mới đề nghị để sẵn ở quầy.',
        en: 'His first offer is to mail a hardware kit (D); only later does he offer to leave one at the counter.',
        evidence: 'I can mail you a hardware kit today',
      },
      {
        n: 43,
        subskill: 'next_action',
        difficulty: 'B1',
        stem: 'What will the woman most likely do on Sunday?',
        options: ['Assemble a bookshelf', 'Go to a store', 'Return a desk', 'Call the man again'],
        correct: 'B',
        vi: '"stop by" = ghé qua cửa hàng trên phố Larch để lấy bộ phụ kiện → (B). Bẫy: (C) cô ấy không trả bàn; (A) sai đồ vật (bookshelf).',
        en: '"Stop by" means she will visit the store to collect the kit (B). Traps: she is not returning the desk, and no bookshelf is mentioned.',
        evidence: "I'll stop by on Sunday morning.",
      },
    ],
  });
})();

const P3_C05 = (() => {
  const w = say('W1', 'uk');
  const m = say('M1', 'ca');
  return group({
    section: 'part3',
    index: 5,
    topic: 'logistics',
    title: 'Conversation 5',
    kind: 'conversation',
    lines: [
      w(
        "Hi, Viktor, it's Nadia. I'm on my way to the Dunhaven warehouse with the furniture delivery, but the main bridge is closed because of an accident.",
      ),
      m('Oh, I heard about that on the radio. How much longer will it take you to get here?'),
      w('My navigation app is sending me along the coast road, so probably an extra forty minutes.'),
      m('Hmm. The loading crew finishes at four.'),
      w('I know. Is there any way someone could stay a little later?'),
      m(
        "I'll ask Tomas. He doesn't usually mind working overtime. In the meantime, please send me a text when you're about ten minutes away, so we can have the doors open.",
      ),
    ],
    items: [
      {
        n: 44,
        subskill: 'listening_gist',
        difficulty: 'B1',
        stem: 'What problem does the woman report?',
        options: [
          'Her truck has broken down.',
          'Some furniture was damaged.',
          'Her usual route is blocked.',
          'A delivery address is wrong.',
        ],
        correct: 'C',
        vi: 'Cây cầu chính bị đóng do tai nạn → tuyến đường thường đi bị chặn (C). Bẫy: (A) xe không hỏng; (B) "furniture" chỉ là hàng đang chở.',
        en: 'The main bridge is closed, so her usual route is blocked (C). Traps: her truck is fine, and "furniture" is only the cargo.',
        evidence: 'the main bridge is closed because of an accident',
      },
      {
        n: 45,
        subskill: 'speaker_intent',
        difficulty: 'B2',
        stem: meanStem('man', 'he', 'The loading crew finishes at four'),
        options: [
          'He is concerned the delivery will arrive too late.',
          'He wants the woman to come earlier tomorrow.',
          'He plans to leave work early.',
          'He thinks the crew needs more workers.',
        ],
        correct: 'A',
        vi: 'Tài xế sẽ trễ thêm 40 phút; người đàn ông nhắc đội bốc xếp nghỉ lúc 4 giờ → lo hàng đến quá muộn (A). Câu tiếp theo của người phụ nữ ("someone could stay a little later") xác nhận ý này.',
        en: 'She will be forty minutes late, and he points out that the crew finishes at four: he is worried the delivery will be too late (A). Her reply about someone staying later confirms this.',
        evidence: 'The loading crew finishes at four.',
      },
      {
        n: 46,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man ask the woman to do?',
        options: ['Call a coworker', 'Take a different road', 'Unload the furniture herself', 'Send him a message'],
        correct: 'D',
        vi: '"send me a text" = gửi tin nhắn (D). Bẫy: (A) chính người đàn ông sẽ hỏi Tomas; (B) đường ven biển là do ứng dụng chỉ, không phải yêu cầu của anh ấy.',
        en: '"Send me a text" means send him a message (D). Traps: he will ask Tomas himself, and the coast road was suggested by her app.',
        evidence: "please send me a text when you're about ten minutes away",
      },
    ],
  });
})();

const P3_C06 = (() => {
  const m = say('M1', 'au');
  const w = say('W1', 'us');
  return group({
    section: 'part3',
    index: 6,
    topic: 'health',
    title: 'Conversation 6',
    kind: 'conversation',
    lines: [
      m(
        'Hello, this is Rafael Duarte. I have an appointment with Dr. Lindqvist on Wednesday at two, but I need to change it. My manager has just asked me to attend a training session that afternoon.',
      ),
      w(
        'No problem, Mr. Duarte. Dr. Lindqvist has openings on Thursday at eight thirty in the morning or on Friday at four.',
      ),
      m('Thursday morning would be better. My office is only a few minutes from the clinic.'),
      w(
        "All right, you're booked for Thursday at eight thirty. Since it's been more than a year since your last visit, could you come in fifteen minutes early to update your medical history form?",
      ),
      m('Of course. Should I bring anything else?'),
      w('Just your insurance card.'),
    ],
    items: [
      {
        n: 47,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'Why does the man need to change his appointment?',
        options: [
          'He will be out of town.',
          'He has a work commitment.',
          'He is feeling better.',
          'He wants a different doctor.',
        ],
        correct: 'B',
        vi: 'Quản lý yêu cầu anh ấy dự buổi đào tạo chiều hôm đó → bận việc công ty (B). Các lý do khác không được nhắc.',
        en: 'His manager asked him to attend a training session, which is a work commitment (B).',
        evidence: 'My manager has just asked me to attend a training session that afternoon.',
      },
      {
        n: 48,
        subskill: 'listening_inference',
        difficulty: 'B2',
        stem: 'Why does the man prefer the Thursday appointment?',
        options: [
          'He has a meeting on Friday afternoon.',
          'He can easily get to work after it.',
          'The doctor is less busy then.',
          'He wants to see a different doctor.',
        ],
        correct: 'B',
        vi: 'Anh ấy chọn sáng thứ Năm và giải thích văn phòng chỉ cách phòng khám vài phút → khám xong đi làm thuận tiện (B). Bẫy: (A) nghe hợp lý nhưng không được nói.',
        en: 'He chooses Thursday morning and notes that his office is only minutes from the clinic, so he can go to work easily afterward (B). Trap: (A) sounds reasonable but is never said.',
        evidence: 'My office is only a few minutes from the clinic.',
      },
      {
        n: 49,
        subskill: 'listening_detail',
        difficulty: 'A2',
        stem: 'What does the woman ask the man to do?',
        options: ['Arrive early', 'Call the doctor', 'Bring a payment', 'Fill out a form online'],
        correct: 'A',
        vi: '"come in fifteen minutes early" = đến sớm 15 phút (A). Bẫy: (D) có nhắc tới mẫu đơn nhưng điền tại phòng khám, không phải trực tuyến; (C) cô ấy chỉ nhắc mang thẻ bảo hiểm.',
        en: '"Come in fifteen minutes early" means arrive early (A). Traps: the form is updated at the clinic, not online, and only an insurance card is needed.',
        evidence: 'could you come in fifteen minutes early to update your medical history form?',
      },
    ],
  });
})();

const P3_C07 = (() => {
  const w = say('W1', 'ca');
  const m = say('M1', 'uk');
  return group({
    section: 'part3',
    index: 7,
    topic: 'business',
    title: 'Conversation 7',
    kind: 'conversation',
    lines: [
      w(
        "Simon, I've just looked at the results of the online ads we ran for the Nordvale headphones. Only about two hundred people clicked on them last month.",
      ),
      m("That's disappointing. We spent most of our marketing budget on those ads."),
      w(
        'I know. I think we should try something different, like sending free samples to a few popular technology reviewers.',
      ),
      m('Reviewers get hundreds of free products every month.'),
      w('True, but if even one of them posts a positive video, thousands of people could see it.'),
      m(
        "OK, let's present the idea to the director. Could you put together a short list of reviewers we could contact?",
      ),
      w("Sure. I'll have it ready by tomorrow."),
    ],
    items: [
      {
        n: 50,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What are the speakers mainly discussing?',
        options: ['A product design', 'A hiring decision', 'A budget increase', 'An advertising campaign'],
        correct: 'D',
        vi: 'Hai người bàn kết quả quảng cáo trực tuyến và cách quảng bá khác → chiến dịch quảng cáo (D). Bẫy: (C) có nhắc ngân sách nhưng không bàn tăng ngân sách.',
        en: 'They discuss the results of their online ads and a new way to promote the product (D). Trap: the budget is mentioned, but not an increase.',
        evidence: "I've just looked at the results of the online ads we ran for the Nordvale headphones.",
      },
      {
        n: 51,
        subskill: 'speaker_intent',
        difficulty: 'B2',
        stem: meanStem('man', 'he', 'Reviewers get hundreds of free products every month'),
        options: [
          'He thinks the reviewers charge too much.',
          'He would like to become a reviewer.',
          "He doubts the woman's idea will work.",
          'He wants to send more samples.',
        ],
        correct: 'C',
        vi: 'Người đánh giá nhận quá nhiều sản phẩm miễn phí nên mẫu của họ khó được chú ý → người đàn ông nghi ngờ ý tưởng (C). Câu đáp "True, but…" của người phụ nữ cho thấy đây là lời phản biện.',
        en: 'Because reviewers receive so many free products, theirs might be ignored: he doubts the idea (C). Her reply, "True, but...", shows she is answering an objection.',
        evidence: 'Reviewers get hundreds of free products every month.',
      },
      {
        n: 52,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man ask the woman to do?',
        options: ['Prepare a list', 'Contact a director', 'Record a video', 'Reduce some costs'],
        correct: 'A',
        vi: '"put together a short list" = lập một danh sách ngắn (A). Bẫy: (B) cả hai sẽ trình bày với giám đốc, không phải việc anh ấy nhờ; (C) video là việc của người đánh giá.',
        en: '"Put together a short list" means prepare a list (A). Traps: presenting to the director is a joint plan, and the video would be made by a reviewer.',
        evidence: 'Could you put together a short list of reviewers we could contact?',
      },
    ],
  });
})();

const P3_C08 = (() => {
  const w = say('W1', 'au');
  const m1 = say('M1', 'us');
  const m2 = say('M2', 'uk');
  return group({
    section: 'part3',
    index: 8,
    topic: 'finance',
    title: 'Conversation 8',
    kind: 'conversation with three speakers',
    lines: [
      w('Gareth, Paolo, have you started using the new expense reporting app yet?'),
      m1(
        "I have. It's much faster than filling out paper forms. You just take a photo of a receipt, and the amount is entered automatically.",
      ),
      m2("I haven't tried it. I couldn't log in on Monday."),
      w(
        'That happened to a few people. The finance department sent out new passwords yesterday afternoon. Check your inbox.',
      ),
      m2(
        'Oh, I see it now. But I have a lot of receipts from my trip to Holloway last month. Do they all have to go through the app?',
      ),
      w(
        "Paper reports won't be accepted from now on. But receipts dated before June first can still be submitted on paper until the end of this month.",
      ),
      m2("Great, that'll save me some time."),
    ],
    items: [
      {
        n: 53,
        subskill: 'listening_gist',
        difficulty: 'B1',
        stem: 'What are the speakers mainly discussing?',
        options: [
          'A business trip',
          'A new reporting tool',
          'A change to travel rules',
          'A finance department meeting',
        ],
        correct: 'B',
        vi: 'Cả hội thoại xoay quanh ứng dụng báo cáo chi phí mới → công cụ báo cáo mới (B). Bẫy: (A) chuyến đi Holloway chỉ là chi tiết.',
        en: 'The conversation is about the new expense reporting app (B). Trap: the trip to Holloway is only a detail.',
        evidence: 'have you started using the new expense reporting app yet?',
      },
      {
        n: 54,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What problem did one of the men have?',
        options: [
          'He lost some receipts.',
          'His phone camera was broken.',
          'He missed a deadline.',
          'He was unable to sign in.',
        ],
        correct: 'D',
        vi: '"couldn\'t log in" = không đăng nhập được (D). Bẫy: (B) việc chụp ảnh hoá đơn là cách dùng ứng dụng, không phải sự cố.',
        en: '"Couldn\'t log in" is paraphrased as "unable to sign in" (D). Trap: taking photos is how the app works, not a problem.',
        evidence: "I couldn't log in on Monday.",
      },
      {
        n: 55,
        subskill: 'listening_inference',
        difficulty: 'B2',
        stem: 'What will the man who traveled to Holloway most likely do with his receipts?',
        options: ['Take photos of them', 'Give them to a coworker', 'Submit them on paper', 'Ask for more time'],
        correct: 'C',
        vi: 'Chuyến đi Holloway là "last month" (trước ngày 1/6) nên hoá đơn còn được nộp bằng giấy; câu "that\'ll save me some time" cho thấy anh ấy sẽ làm vậy → (C). Bẫy: (A) là cách nộp qua ứng dụng.',
        en: 'His trip was last month, before June first, so those receipts can still go on paper, and he says this will save him time (C). Trap: (A) is how the app works.',
        evidence: 'receipts dated before June first can still be submitted on paper until the end of this month.',
      },
    ],
  });
})();

const P3_C09 = (() => {
  const w = say('W1', 'us');
  const m = say('M1', 'au');
  return group({
    section: 'part3',
    index: 9,
    topic: 'education',
    title: 'Conversation 9',
    kind: 'conversation',
    lines: [
      w(
        "Hi, I'm interested in the evening course on spreadsheet skills at Brayford Community College. Is there still space in it?",
      ),
      m(
        'Let me check. The Tuesday class is full, but there are a few places left in the Thursday class. It starts on September fifth and runs for six weeks.',
      ),
      w('Thursday works for me. How much does the course cost?'),
      m(
        "It's one hundred and twenty dollars. But if your employer is a member of the Dunhaven Business Association, you get fifteen percent off.",
      ),
      w("I think my company is a member. I'll check with our office manager."),
      m("OK. You can register on our Web site. There's a box for the membership number on the payment page."),
    ],
    items: [
      {
        n: 56,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What does the woman want to do?',
        options: ['Take a course', 'Teach a class', 'Change a schedule', 'Buy some software'],
        correct: 'A',
        vi: 'Người phụ nữ quan tâm khoá học buổi tối và hỏi còn chỗ không → muốn tham gia khoá học (A). Bẫy: (D) "spreadsheet" gợi liên tưởng phần mềm.',
        en: 'She is interested in an evening course and asks if there is space, so she wants to take it (A). Trap: "spreadsheet" may suggest software.',
        evidence: "I'm interested in the evening course on spreadsheet skills at Brayford Community College.",
      },
      {
        n: 57,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man say about the Tuesday class?',
        options: ['It has no places left.', 'It has been canceled.', 'It meets in the morning.', 'It costs less.'],
        correct: 'A',
        vi: '"The Tuesday class is full" = lớp thứ Ba đã đầy (A). Bẫy: (B) lớp không bị huỷ; (C) đây là khoá học buổi tối.',
        en: '"The Tuesday class is full" means it has no places left (A). Traps: it has not been canceled, and these are evening classes.',
        evidence: 'The Tuesday class is full',
      },
      {
        n: 58,
        subskill: 'next_action',
        difficulty: 'B1',
        stem: 'What will the woman most likely do next?',
        options: ['Visit the college', 'Pay by phone', 'Call the man back', 'Talk to a colleague'],
        correct: 'D',
        vi: '"check with our office manager" = hỏi quản lý văn phòng (một đồng nghiệp) xem công ty có là hội viên không → (D). Bẫy: (B) việc thanh toán làm trên trang web.',
        en: 'She will check with her office manager, a colleague, about the membership (D). Trap: payment is made on the Web site, not by phone.',
        evidence: "I'll check with our office manager.",
      },
    ],
  });
})();

const P3_C10 = (() => {
  const m = say('M1', 'uk');
  const w = say('W1', 'au');
  return group({
    section: 'part3',
    index: 10,
    topic: 'office',
    title: 'Conversation 10',
    kind: 'conversation',
    lines: [
      m(
        "Hi, this is Owen from Corrigan Catering. I'm calling to confirm the order for Ms. Haldane's retirement party this Friday.",
      ),
      w("Thanks for calling. Yes, we're expecting about forty people in our office lounge from five to seven."),
      m(
        "Great. We'll bring sandwiches, a fruit tray, and the chocolate cake you ordered. Will you need us to provide plates and cups?",
      ),
      w("No, we have plenty here. But could you also bring a vegetarian dish? Several of our staff don't eat meat."),
      m("Certainly. I'll add a vegetable pasta salad. That'll be an extra thirty-five dollars."),
      w(
        "That's fine. And please use the loading entrance at the back of the building. The front entrance is closed for renovations this week.",
      ),
    ],
    items: [
      {
        n: 59,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What event is being planned?',
        options: ['A product launch', 'A client lunch', 'A retirement celebration', 'A training session'],
        correct: 'C',
        vi: '"retirement party" = tiệc nghỉ hưu (C). Các sự kiện khác không được nhắc tới.',
        en: '"Retirement party" is paraphrased as "retirement celebration" (C).',
        evidence: "I'm calling to confirm the order for Ms. Haldane's retirement party this Friday.",
      },
      {
        n: 60,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the woman request?',
        options: [
          'Extra plates and cups',
          'Food for people who do not eat meat',
          'A larger cake',
          'An earlier delivery time',
        ],
        correct: 'B',
        vi: '"a vegetarian dish" = món chay cho người không ăn thịt (B). Bẫy: (A) cô ấy nói đã có đủ đĩa và cốc.',
        en: 'A vegetarian dish is food for people who do not eat meat (B). Trap: she says they already have plates and cups.',
        evidence: 'could you also bring a vegetarian dish?',
      },
      {
        n: 61,
        subskill: 'listening_detail',
        difficulty: 'B2',
        stem: 'Why does the woman ask the man to use the loading entrance?',
        options: [
          'It is closer to the lounge.',
          'It has a parking area.',
          'Its elevator is larger.',
          'The main entrance is temporarily closed.',
        ],
        correct: 'D',
        vi: 'Lối vào phía trước đóng để sửa chữa trong tuần này → "tạm thời đóng cửa" (D). Bẫy: (A) lặp "lounge" nhưng không có thông tin về khoảng cách.',
        en: 'The front entrance is closed for renovations this week, i.e., temporarily closed (D). Trap: (A) reuses "lounge" without support.',
        evidence: 'The front entrance is closed for renovations this week.',
      },
    ],
  });
})();

const P3_C11 = (() => {
  const w = say('W1', 'uk');
  const m = say('M1', 'ca');
  return group({
    section: 'part3',
    index: 11,
    topic: 'travel',
    title: 'Conversation 11',
    kind: 'conversation and train schedule',
    graphic: [
      '**Morning Departures**',
      '',
      '| Destination | Departs | Platform |',
      '| --- | --- | --- |',
      '| Port Callan | 9:15 | 2 |',
      '| Holloway | 9:40 | 4 |',
      '| Dunhaven | 10:05 | 6 |',
      '| Saltmere | 10:30 | 1 |',
    ].join('\n'),
    lines: [
      w(
        "Excuse me. I was supposed to take the nine fifteen train to Port Callan, but I just heard an announcement that it's been canceled.",
      ),
      m(
        "That's right. There's a problem with the signals on that line this morning. The next direct train to Port Callan isn't until eleven.",
      ),
      w('Eleven? I have a meeting with a client there at half past ten.'),
      m(
        'In that case, you can take the train to Holloway and transfer to a bus there. The bus goes straight to the center of Port Callan.',
      ),
      w('Do I need to buy a separate ticket for the bus?'),
      m("No, it's included in your train ticket. Just show it to the driver."),
    ],
    items: [
      {
        n: 62,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: "What is the woman's problem?",
        options: [
          'Her train has been canceled.',
          'She missed an announcement.',
          'She has lost her ticket.',
          'Her client meeting has been moved.',
        ],
        correct: 'A',
        vi: 'Chuyến 9:15 đi Port Callan bị huỷ (A). Bẫy: (B) cô ấy có nghe thông báo; (D) giờ họp được nhắc nhưng không bị dời.',
        en: 'Her 9:15 train has been canceled (A). Traps: she did hear the announcement, and her meeting time has not changed.',
        evidence: "I just heard an announcement that it's been canceled.",
      },
      {
        n: 63,
        subskill: 'graphic_question',
        difficulty: 'B2',
        stem: `${GRAPHIC_STEM} Which platform will the woman most likely go to?`,
        options: ['Platform 1', 'Platform 2', 'Platform 4', 'Platform 6'],
        correct: 'C',
        vi: 'Người đàn ông khuyên đi tàu tới Holloway rồi đổi sang xe buýt; theo bảng, tàu Holloway chạy ở sân ga 4 (C). Bẫy: (B) sân ga 2 là của chuyến Port Callan đã bị huỷ.',
        en: 'She is advised to take the Holloway train, which leaves from Platform 4 (C). Trap: Platform 2 is for the canceled Port Callan train.',
        evidence: 'you can take the train to Holloway and transfer to a bus there.',
        graphic: true,
      },
      {
        n: 64,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the man say about the bus?',
        options: [
          'It leaves every hour.',
          'Its fare is covered by her ticket.',
          'It stops at the airport.',
          'It must be booked online.',
        ],
        correct: 'B',
        vi: '"it\'s included in your train ticket" = vé tàu đã bao gồm vé xe buýt (B). Các chi tiết khác không được nhắc.',
        en: '"It\'s included in your train ticket" means the bus fare is covered (B).',
        evidence: "it's included in your train ticket.",
      },
    ],
  });
})();

const P3_C12 = (() => {
  const m = say('M1', 'us');
  const w = say('W1', 'ca');
  return group({
    section: 'part3',
    index: 12,
    topic: 'business',
    title: 'Conversation 12',
    kind: 'conversation and price list',
    graphic: [
      '**Fenmore Print Shop – Business Cards**',
      '',
      '| Quantity | Price |',
      '| --- | --- |',
      '| 100 cards | $25 |',
      '| 250 cards | $45 |',
      '| 500 cards | $70 |',
      '| 1,000 cards | $110 |',
    ].join('\n'),
    lines: [
      m("Hi, I'd like to order some business cards. I'm opening a bicycle repair shop on Saddler Street next month."),
      w('Congratulations! Do you already have a design, or would you like one of our designers to create one?'),
      m('I have a design on this flash drive. How many cards do people usually order?'),
      w('Most new businesses start with one hundred.'),
      m(
        "I'll be handing them out at a street festival in May, so I'll need more than that. Let's go with the next quantity up.",
      ),
      w("Sure. They'll be ready on Wednesday. Would you like us to deliver them?"),
      m("No, thanks. I'll come by and pick them up."),
    ],
    items: [
      {
        n: 65,
        subskill: 'listening_detail',
        difficulty: 'A2',
        stem: 'What type of business is the man opening?',
        options: ['A print shop', 'A café', 'A clothing store', 'A bicycle repair shop'],
        correct: 'D',
        vi: 'Người đàn ông nói sắp mở tiệm sửa xe đạp (D). Bẫy: (A) tiệm in là nơi anh ấy đang đặt thẻ.',
        en: 'He is opening a bicycle repair shop (D). Trap: the print shop is where he is ordering the cards.',
        evidence: "I'm opening a bicycle repair shop on Saddler Street next month.",
      },
      {
        n: 66,
        subskill: 'graphic_question',
        difficulty: 'B2',
        stem: `${GRAPHIC_STEM} How much will the man most likely pay?`,
        options: ['$25', '$45', '$70', '$110'],
        correct: 'B',
        vi: 'Doanh nghiệp mới thường đặt 100 thẻ; anh ấy cần nhiều hơn và chọn "mức số lượng kế tiếp" = 250 thẻ → $45 (B). Bẫy: (A) giá của 100 thẻ.',
        en: 'Most new businesses order 100; he wants the next quantity up, 250 cards, which costs $45 (B). Trap: $25 is the price for 100 cards.',
        evidence: "Let's go with the next quantity up.",
        graphic: true,
      },
      {
        n: 67,
        subskill: 'listening_detail',
        difficulty: 'B1',
        stem: 'What does the woman say will happen on Wednesday?',
        options: ['A festival will begin.', 'A design will be sent.', 'An order will be ready.', 'A shop will open.'],
        correct: 'C',
        vi: '"They\'ll be ready on Wednesday" – thẻ sẽ xong vào thứ Tư (C). Bẫy: (A) lễ hội diễn ra vào tháng Năm; (D) tiệm mở vào tháng sau.',
        en: 'The cards will be ready on Wednesday (C). Traps: the festival is in May, and the shop opens next month.',
        evidence: "They'll be ready on Wednesday.",
      },
    ],
  });
})();

const P3_C13 = (() => {
  const m = say('M1', 'au');
  const w = say('W1', 'uk');
  return group({
    section: 'part3',
    index: 13,
    topic: 'technology',
    title: 'Conversation 13',
    kind: 'conversation and chart',
    graphic: [
      '**Customer Survey: Most Requested Feature**',
      '',
      '| Feature | Share of votes |',
      '| --- | --- |',
      '| Offline access | ████████ 40% |',
      '| Voice search | █████ 25% |',
      '| Shared lists | ████ 20% |',
      '| Dark mode | ███ 15% |',
    ].join('\n'),
    lines: [
      m('Lucia, have you seen the results of the customer survey for our shopping list app?'),
      w(
        "Yes. I wasn't surprised that offline access came first. People want to see their lists in stores with poor phone reception.",
      ),
      m(
        "Right, but our engineers say it'll take at least six months to build. I suggest we start with the second most popular feature. It would only take a few weeks.",
      ),
      w('That makes sense. Users would see an improvement quickly.'),
      m("I'll bring it up at the product meeting on Monday."),
      w("Good. And let's mention it in the next newsletter, so customers know we're listening."),
    ],
    items: [
      {
        n: 68,
        subskill: 'listening_gist',
        difficulty: 'A2',
        stem: 'What product are the speakers discussing?',
        options: ['A mobile application', 'A grocery store', 'A survey company', 'A newsletter service'],
        correct: 'A',
        vi: '"our shopping list app" – ứng dụng danh sách mua sắm → ứng dụng di động (A). Bẫy: (B) "shopping"/"stores" gợi cửa hàng; (C) khảo sát chỉ là nguồn dữ liệu.',
        en: 'They are discussing their shopping list app (A). Traps: "shopping" and "stores" suggest a store; the survey is only the data source.',
        evidence: 'the customer survey for our shopping list app',
      },
      {
        n: 69,
        subskill: 'graphic_question',
        difficulty: 'B2',
        stem: `${GRAPHIC_STEM} Which feature does the man suggest developing first?`,
        options: ['Offline access', 'Shared lists', 'Dark mode', 'Voice search'],
        correct: 'D',
        vi: 'Anh ấy đề xuất làm tính năng phổ biến thứ hai; theo biểu đồ đó là Voice search 25% (D). Bẫy: (A) Offline access đứng đầu nhưng mất ít nhất sáu tháng.',
        en: 'He suggests the second most popular feature, which the chart shows is voice search (D). Trap: offline access is first but would take six months.',
        evidence: 'I suggest we start with the second most popular feature.',
        graphic: true,
      },
      {
        n: 70,
        subskill: 'next_action',
        difficulty: 'B1',
        stem: 'What does the man say he will do on Monday?',
        options: [
          'Meet with some engineers',
          'Send out a newsletter',
          'Discuss a plan at a meeting',
          'Conduct another survey',
        ],
        correct: 'C',
        vi: '"bring it up at the product meeting" = nêu ý tưởng tại cuộc họp sản phẩm (C). Bẫy: (B) bản tin là gợi ý của người phụ nữ; (A) kỹ sư chỉ được nhắc tới.',
        en: '"Bring it up at the product meeting" means discuss the plan at a meeting (C). Traps: the newsletter is the woman\'s idea, and the engineers are only mentioned.',
        evidence: "I'll bring it up at the product meeting on Monday.",
      },
    ],
  });
})();

// ===========================================================================
// PART 4 – Talks (71–100)

const P4_T01 = group({
  section: 'part4',
  index: 1,
  topic: 'business',
  title: 'Talk 1 – Telephone message',
  kind: 'telephone message',
  lines: [
    say(
      'W1',
      'uk',
    )(
      "Hello, Mr. Abara. This is Fiona from Glenmere Print Studio, returning your call about the brochures for your travel agency. I'm sorry to hear that some of the copies we delivered on Monday were printed with the wrong phone number. We've checked our files, and the mistake was ours, so we'll reprint all five hundred copies at no charge. However, our main printer is being serviced this week, so the new brochures won't be ready until Friday. If you need some sooner, we can print a small batch of fifty today on another machine. Please call me back before three o'clock and let me know if you'd like us to do that. Again, I apologize for the inconvenience.",
    ),
  ],
  items: [
    {
      n: 71,
      subskill: 'listening_gist',
      difficulty: 'B1',
      stem: 'Why is the speaker calling?',
      options: [
        'To confirm a delivery date',
        'To respond to a complaint',
        'To advertise a new service',
        'To request a payment',
      ],
      correct: 'B',
      vi: 'Người nói gọi lại về việc tờ rơi in sai số điện thoại và xin lỗi → phản hồi khiếu nại (B). Bẫy: (A) có nhắc ngày giao nhưng không phải mục đích chính.',
      en: 'She is returning a call about brochures printed with the wrong number and apologizes, i.e., responding to a complaint (B).',
      evidence:
        "I'm sorry to hear that some of the copies we delivered on Monday were printed with the wrong phone number.",
    },
    {
      n: 72,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'Why will the new brochures be delayed?',
      options: [
        'Some paper is out of stock.',
        'A design must be approved.',
        'Some employees are on vacation.',
        'A machine is being repaired.',
      ],
      correct: 'D',
      vi: '"our main printer is being serviced" = máy in chính đang được bảo dưỡng → (D). Các lý do khác không được nhắc.',
      en: '"Our main printer is being serviced" is paraphrased as "a machine is being repaired" (D).',
      evidence: 'our main printer is being serviced this week',
    },
    {
      n: 73,
      subskill: 'listening_detail',
      difficulty: 'A2',
      stem: 'What does the speaker ask the listener to do?',
      options: ['Return her call', 'Visit the studio', 'Send a new phone number', 'Pay for an extra batch'],
      correct: 'A',
      vi: '"Please call me back" = gọi lại cho cô ấy (A). Bẫy: (D) việc in lại là miễn phí; (C) lặp "phone number".',
      en: '"Please call me back" means return her call (A). Traps: the reprint is free, and (C) repeats "phone number".',
      evidence: "Please call me back before three o'clock",
    },
  ],
});

const P4_T02 = group({
  section: 'part4',
  index: 2,
  topic: 'travel',
  title: 'Talk 2 – Announcement',
  kind: 'announcement',
  lines: [
    say(
      'M1',
      'us',
    )(
      "Good afternoon, passengers. This is an announcement for Larkspur Air flight two-oh-eight to Dunhaven. Because of strong winds this morning, our aircraft arrived late from Port Callan, so departure has been moved from two fifteen to three o'clock. We've also had to change gates. Flight two-oh-eight will now depart from Gate 14, which is at the end of the east hallway, past the food court. We apologize for the delay. To thank you for your patience, passengers on this flight may pick up a ten-dollar meal voucher at the customer service counter next to Gate 9. Please have your boarding pass ready when you collect your voucher. Boarding will begin at two forty.",
    ),
  ],
  items: [
    {
      n: 74,
      subskill: 'listening_detail',
      difficulty: 'A2',
      stem: 'What has caused the delay?',
      options: ['A mechanical problem', 'A shortage of crew', 'Bad weather', 'A security check'],
      correct: 'C',
      vi: '"strong winds" (gió mạnh) → thời tiết xấu (C). Các nguyên nhân khác không được nhắc.',
      en: '"Strong winds" is paraphrased as "bad weather" (C).',
      evidence: 'Because of strong winds this morning, our aircraft arrived late from Port Callan',
    },
    {
      n: 75,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'Where is Gate 14 located?',
      options: [
        'Next to the customer service counter',
        'Beyond a dining area',
        'Near the main entrance',
        'In the west hallway',
      ],
      correct: 'B',
      vi: '"past the food court" = đi qua khu ẩm thực → phía sau một khu ăn uống (B). Bẫy: (A) quầy dịch vụ nằm cạnh cổng 9; (D) sai hướng (east, không phải west).',
      en: '"Past the food court" is paraphrased as "beyond a dining area" (B). Traps: the service counter is next to Gate 9, and it is the east hallway.',
      evidence: 'which is at the end of the east hallway, past the food court.',
    },
    {
      n: 76,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What should listeners show at the customer service counter?',
      options: ['A meal voucher', 'A passport', 'A receipt', 'A boarding pass'],
      correct: 'D',
      vi: 'Hành khách cần chuẩn bị thẻ lên máy bay khi nhận phiếu ăn (D). Bẫy: (A) phiếu ăn là thứ họ nhận, không phải thứ phải xuất trình.',
      en: 'Passengers must have their boarding pass ready (D). Trap: the meal voucher is what they receive, not what they show.',
      evidence: 'Please have your boarding pass ready when you collect your voucher.',
    },
  ],
});

const P4_T03 = group({
  section: 'part4',
  index: 3,
  topic: 'health',
  title: 'Talk 3 – Advertisement',
  kind: 'advertisement',
  lines: [
    say(
      'W1',
      'au',
    )(
      "Looking for a convenient way to stay fit? Ridgeway Fitness is opening its newest center on the second floor of the Harbor Point Shopping Mall on March first. Our new location features a heated indoor pool, a climbing wall, and more than thirty group classes a week, from yoga to indoor cycling. And unlike most gyms, we're open twenty-four hours a day, so you can exercise whenever it suits you. During our opening month, new members pay no joining fee, and anyone who signs up for a full year will receive three free sessions with a personal trainer. Want to see the center before you decide? Visit our Web site to book a free tour. Ridgeway Fitness: your workout, your schedule.",
    ),
  ],
  items: [
    {
      n: 77,
      subskill: 'listening_gist',
      difficulty: 'A2',
      stem: 'What is being advertised?',
      options: ['A fitness center', 'A shopping mall', 'A sports store', 'A swimming competition'],
      correct: 'A',
      vi: 'Quảng cáo cho phòng tập Ridgeway Fitness mới khai trương (A). Bẫy: (B) trung tâm mua sắm chỉ là địa điểm; (D) hồ bơi chỉ là một tiện ích.',
      en: 'The ad is for a new Ridgeway Fitness center (A). Traps: the mall is only its location, and the pool is one feature.',
      evidence: 'Ridgeway Fitness is opening its newest center',
    },
    {
      n: 78,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'According to the speaker, what makes the business different from most others?',
      options: ['Its low prices', 'Its swimming pool', 'Its opening hours', 'Its location'],
      correct: 'C',
      vi: '"unlike most gyms, we\'re open twenty-four hours a day" → khác biệt ở giờ mở cửa (C). Bẫy: (B) hồ bơi được nhắc nhưng không được so sánh với nơi khác.',
      en: '"Unlike most gyms, we\'re open twenty-four hours a day" points to its opening hours (C). Trap: the pool is mentioned but not compared.',
      evidence: "unlike most gyms, we're open twenty-four hours a day",
    },
    {
      n: 79,
      subskill: 'listening_detail',
      difficulty: 'B2',
      stem: 'How can listeners receive free sessions with a trainer?',
      options: [
        'By joining during the first month',
        'By booking a tour online',
        'By signing up for a year',
        'By attending a group class',
      ],
      correct: 'C',
      vi: 'Ai đăng ký trọn một năm được ba buổi tập miễn phí với huấn luyện viên (C). Bẫy chính (A): đăng ký trong tháng khai trương chỉ được miễn phí gia nhập; (B) đặt lịch tham quan miễn phí, không phải buổi tập.',
      en: 'A full-year membership comes with three free trainer sessions (C). Main trap: joining in the opening month only waives the joining fee; the free tour is not a training session.',
      evidence: 'anyone who signs up for a full year will receive three free sessions with a personal trainer.',
    },
  ],
});

const P4_T04 = group({
  section: 'part4',
  index: 4,
  topic: 'business',
  title: 'Talk 4 – News report',
  kind: 'news report',
  lines: [
    say(
      'M1',
      'ca',
    )(
      'In business news, Velmora Textiles announced today that it will build a new factory just outside Port Callan. The company, which makes fabric for furniture and car seats, says the factory will create about three hundred jobs when it opens in two years. Velmora chose the site because it is close to the port, which will make it easier to ship products overseas. Construction is expected to begin in October, once the city council gives its final approval. However, not everyone is pleased with the plan. Some residents of nearby Fernhill are worried about increased truck traffic on local roads. The company will hold a public meeting at the Port Callan Community Center next Tuesday evening to answer questions about the project.',
    ),
  ],
  items: [
    {
      n: 80,
      subskill: 'listening_gist',
      difficulty: 'A2',
      stem: 'What is the news report mainly about?',
      options: ['A company merger', 'A new port', 'A road construction project', 'A planned factory'],
      correct: 'D',
      vi: 'Bản tin về kế hoạch xây nhà máy mới của Velmora Textiles (D). Bẫy: (B) cảng đã có sẵn; (C) đường sá chỉ được nhắc khi nói về giao thông xe tải.',
      en: "The report is about Velmora Textiles' planned factory (D). Traps: the port already exists, and roads come up only regarding truck traffic.",
      evidence: 'Velmora Textiles announced today that it will build a new factory just outside Port Callan.',
    },
    {
      n: 81,
      subskill: 'listening_detail',
      difficulty: 'B2',
      stem: 'Why did the company choose the location?',
      options: [
        'Land there is inexpensive.',
        'It is convenient for exporting goods.',
        'Many skilled workers live nearby.',
        'The city offered tax benefits.',
      ],
      correct: 'B',
      vi: 'Gần cảng giúp "ship products overseas" (vận chuyển hàng ra nước ngoài) = thuận tiện xuất khẩu (B). Các lý do còn lại nghe hợp lý nhưng không được nói.',
      en: 'Being near the port makes it easier to ship products overseas, i.e., to export goods (B). The other reasons are plausible but not stated.',
      evidence: 'which will make it easier to ship products overseas.',
    },
    {
      n: 82,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What will happen next Tuesday?',
      options: [
        'A public meeting will be held.',
        'Construction will start.',
        'The city council will vote.',
        'A road will be closed.',
      ],
      correct: 'A',
      vi: 'Công ty tổ chức họp công khai tối thứ Ba tới (A). Bẫy: (B) khởi công vào tháng Mười; (C) hội đồng thành phố chưa có lịch biểu quyết cụ thể.',
      en: 'The company will hold a public meeting next Tuesday (A). Traps: construction starts in October, and no council vote date is given.',
      evidence: 'The company will hold a public meeting at the Port Callan Community Center next Tuesday evening',
    },
  ],
});

const P4_T05 = group({
  section: 'part4',
  index: 5,
  topic: 'travel',
  title: 'Talk 5 – Tour',
  kind: 'talk',
  lines: [
    say(
      'W1',
      'us',
    )(
      "Welcome to the Dunhaven Maritime Museum. My name is Grace, and I'll be your guide this morning. Our tour will take about an hour. We'll start here in the main hall with the model ships, and then we'll go upstairs to see our collection of old maps and navigation tools. The tour ends in the lighthouse gallery, where you can climb to the top for a wonderful view of the harbor. Please note that photography is allowed everywhere except in the map room, because camera flashes can damage the paper. Also, the museum café is closed today for repairs, but there's a water fountain beside the gift shop. All right, if everyone's ready, please follow me.",
    ),
  ],
  items: [
    {
      n: 83,
      subskill: 'listening_gist',
      difficulty: 'A2',
      stem: 'Where most likely are the listeners?',
      options: ['At a harbor', 'At a library', 'At a lighthouse', 'At a museum'],
      correct: 'D',
      vi: 'Lời chào "Welcome to the Dunhaven Maritime Museum" → người nghe đang ở bảo tàng (D). Bẫy: (A), (C) cảng và ngọn hải đăng chỉ là nội dung trưng bày/điểm ngắm cảnh.',
      en: 'The greeting shows they are at a museum (D). Traps: the harbor and lighthouse are only exhibits or views.',
      evidence: 'Welcome to the Dunhaven Maritime Museum.',
    },
    {
      n: 84,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'Why are visitors not allowed to take photographs in the map room?',
      options: [
        'To protect the items on display',
        'Because the room is too dark',
        'To prevent crowding',
        'Because the maps are for sale',
      ],
      correct: 'A',
      vi: 'Đèn flash có thể làm hỏng giấy → để bảo vệ hiện vật (A). Các lý do khác không được nhắc.',
      en: 'Camera flashes can damage the paper, so the rule protects the items on display (A).',
      evidence: 'because camera flashes can damage the paper.',
    },
    {
      n: 85,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What does the speaker say about the café?',
      options: [
        'It is next to the gift shop.',
        'It is not open today.',
        'It has a view of the harbor.',
        'It offers free drinks.',
      ],
      correct: 'B',
      vi: '"closed today for repairs" = hôm nay đóng cửa sửa chữa (B). Bẫy: (A) cạnh cửa hàng lưu niệm là vòi nước uống; (C) cảnh cảng nhìn từ ngọn hải đăng.',
      en: '"Closed today for repairs" means it is not open today (B). Traps: the water fountain is next to the gift shop, and the harbor view is from the lighthouse.',
      evidence: 'the museum café is closed today for repairs',
    },
  ],
});

const P4_T06 = group({
  section: 'part4',
  index: 6,
  topic: 'office',
  title: 'Talk 6 – Meeting excerpt',
  kind: 'excerpt from a meeting',
  lines: [
    say(
      'M1',
      'uk',
    )(
      "Before we finish, I have an update about the office move. As you know, we're relocating to the Halden Building on River Street at the end of the month. The movers will pack up the furniture and computers, but each of you is responsible for packing your own desk items. Boxes will be delivered to the supply room on Thursday. Now, I know some of you were worried about parking at the new site. Well, the Halden Building has an underground garage with two hundred spaces. We have only sixty employees. Finally, the IT team will set up the new network over the weekend, so please save all your files to the shared drive by Friday afternoon.",
    ),
  ],
  items: [
    {
      n: 86,
      subskill: 'listening_gist',
      difficulty: 'A2',
      stem: 'What is the main topic of the talk?',
      options: ['A new parking fee', 'A computer upgrade', 'An office relocation', 'A furniture sale'],
      correct: 'C',
      vi: '"an update about the office move" – thông tin về việc chuyển văn phòng (C). Bẫy: bãi đỗ xe, máy tính, đồ đạc chỉ là chi tiết.',
      en: 'The talk is an update about the office move (C). Traps: parking, computers and furniture are details.',
      evidence: 'I have an update about the office move.',
    },
    {
      n: 87,
      subskill: 'speaker_intent',
      difficulty: 'B2',
      stem: meanStem('speaker', 'he', 'We have only sixty employees'),
      options: [
        'The company needs to hire more staff.',
        'The new office is too small.',
        'Some employees will work from home.',
        'There will be enough parking for everyone.',
      ],
      correct: 'D',
      vi: 'Đặt cạnh lo lắng về chỗ đỗ xe và con số 200 chỗ, câu "chỉ có 60 nhân viên" ngụ ý ai cũng có chỗ đỗ (D). Bẫy: (A), (B) hiểu "only" theo nghĩa thiếu người/thiếu chỗ.',
      en: 'After mentioning parking worries and a 200-space garage, "only sixty employees" implies there is plenty of parking (D). Traps: (A) and (B) misread "only".',
      evidence: 'We have only sixty employees.',
    },
    {
      n: 88,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What are listeners asked to do by Friday afternoon?',
      options: [
        'Pack their computers',
        'Save their files to a shared location',
        'Collect boxes from the supply room',
        'Register their cars',
      ],
      correct: 'B',
      vi: '"save all your files to the shared drive" = lưu tệp vào ổ dùng chung (B). Bẫy: (A) máy tính do bên chuyển nhà đóng gói; (C) thùng được giao vào thứ Năm.',
      en: 'They must save their files to the shared drive (B). Traps: the movers pack the computers, and the boxes arrive on Thursday.',
      evidence: 'please save all your files to the shared drive by Friday afternoon.',
    },
  ],
});

const P4_T07 = group({
  section: 'part4',
  index: 7,
  topic: 'hr',
  title: 'Talk 7 – Introduction',
  kind: 'introduction',
  lines: [
    say(
      'W1',
      'ca',
    )(
      "Good evening, everyone, and thank you for coming to the Marrowfield Logistics annual awards dinner. It's my pleasure to present this year's Employee of the Year award to Haruto Bellamy from our Dunhaven warehouse. Haruto joined the company eight years ago as a delivery driver. Three years ago, he was promoted to warehouse supervisor, and since then, his team has had the lowest number of shipping errors in the company. Last spring, Haruto also designed a new training program for drivers, which has now been adopted at all of our locations. Outside of work, he coaches a youth football team. Haruto, please come up to the stage to accept your award. After that, dessert will be served.",
    ),
  ],
  items: [
    {
      n: 89,
      subskill: 'listening_gist',
      difficulty: 'A2',
      stem: 'What is the purpose of the event?',
      options: [
        "To recognize employees' achievements",
        'To welcome new staff',
        'To celebrate a retirement',
        'To open a new warehouse',
      ],
      correct: 'A',
      vi: '"annual awards dinner" – tiệc trao giải thường niên → ghi nhận thành tích nhân viên (A). Bẫy: (D) nhà kho Dunhaven là nơi anh Bellamy làm việc.',
      en: "An annual awards dinner recognizes employees' achievements (A). Trap: the Dunhaven warehouse is only where he works.",
      evidence: 'thank you for coming to the Marrowfield Logistics annual awards dinner.',
    },
    {
      n: 90,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: "What was Mr. Bellamy's first position at the company?",
      options: ['Warehouse supervisor', 'Football coach', 'Delivery driver', 'Training manager'],
      correct: 'C',
      vi: 'Anh ấy vào công ty tám năm trước với vị trí tài xế giao hàng (C). Bẫy: (A) là vị trí sau khi được thăng chức; (B) huấn luyện bóng đá là việc ngoài giờ.',
      en: 'He joined as a delivery driver (C). Traps: supervisor was his later promotion, and coaching is outside work.',
      evidence: 'Haruto joined the company eight years ago as a delivery driver.',
    },
    {
      n: 91,
      subskill: 'listening_inference',
      difficulty: 'B2',
      stem: 'What is suggested about the training program?',
      options: [
        'It was created eight years ago.',
        'It is only for supervisors.',
        'It will be tested next spring.',
        'It has been successful.',
      ],
      correct: 'D',
      vi: 'Chương trình đã được áp dụng ở tất cả các chi nhánh → có thể suy ra nó thành công (D). Bẫy: (A) "eight years ago" là lúc anh ấy vào công ty; (C) chương trình được thiết kế "last spring".',
      en: 'It has been adopted at every location, which suggests it has been successful (D). Traps: eight years ago is when he joined, and it was designed last spring.',
      evidence: 'which has now been adopted at all of our locations.',
    },
  ],
});

const P4_T08 = group({
  section: 'part4',
  index: 8,
  topic: 'travel',
  title: 'Talk 8 – Broadcast',
  kind: 'broadcast',
  lines: [
    say(
      'M1',
      'au',
    )(
      "This is Radio Dunhaven with your morning traffic update. If you're driving into the city on Highway 9, expect long delays. Road crews are repaving two lanes near the Fenwick exit, and traffic is moving very slowly. The work is scheduled to continue until Friday, so you might want to take the train this week. The North Line runs every ten minutes during rush hour, and parking at Fenwick Station is free until the end of the month. Meanwhile, the Old Town ring road is clear right now, but remember that the Harvest Market opens there on Saturday, and you know what that means. Stay tuned for the weather forecast with Meredith Okoro after this short break.",
    ),
  ],
  items: [
    {
      n: 92,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What is causing delays on Highway 9?',
      options: ['An accident', 'Road repairs', 'A festival', 'Bad weather'],
      correct: 'B',
      vi: '"Road crews are repaving two lanes" – đội công nhân đang trải lại mặt đường → sửa đường (B). Bẫy: (C) chợ phiên ở khu Old Town, không phải trên Highway 9.',
      en: 'Crews are repaving two lanes, i.e., road repairs (B). Trap: the market is in Old Town, not on Highway 9.',
      evidence: 'Road crews are repaving two lanes near the Fenwick exit',
    },
    {
      n: 93,
      subskill: 'speaker_intent',
      difficulty: 'B2',
      stem: meanStem('speaker', 'he', 'you know what that means'),
      options: [
        'Traffic near the market will likely be heavy.',
        'The market will close early.',
        'Parking will be free on Saturday.',
        'The ring road will be repaired.',
      ],
      correct: 'A',
      vi: 'Đường vành đai đang thông thoáng "nhưng" chợ phiên khai mạc thứ Bảy → ngụ ý đường quanh chợ sẽ đông xe (A). Bẫy: (C) miễn phí đỗ xe là ở ga Fenwick.',
      en: 'The ring road is clear "but" the market opens on Saturday, implying heavy traffic there (A). Trap: free parking is at Fenwick Station.',
      evidence: 'remember that the Harvest Market opens there on Saturday, and you know what that means',
    },
    {
      n: 94,
      subskill: 'next_action',
      difficulty: 'B1',
      stem: 'What will listeners most likely hear after the break?',
      options: ['A traffic update', 'An interview', 'A weather report', 'A news summary'],
      correct: 'C',
      vi: '"Stay tuned for the weather forecast… after this short break" → sau quảng cáo là bản tin thời tiết (C). Bẫy: (A) bản tin giao thông vừa kết thúc.',
      en: 'The weather forecast comes after the break (C). Trap: the traffic update has just been given.',
      evidence: 'Stay tuned for the weather forecast with Meredith Okoro after this short break.',
    },
  ],
});

const P4_T09 = group({
  section: 'part4',
  index: 9,
  topic: 'education',
  title: 'Talk 9 – Announcement and schedule',
  kind: 'announcement and schedule',
  graphic: [
    '**Brayford Library – Saturday Workshops**',
    '',
    '| Time | Workshop | Room |',
    '| --- | --- | --- |',
    '| 10:00 | Starting a Blog | Room A |',
    '| 11:30 | Photo Editing Basics | Room B |',
    '| 1:00 | Online Safety | Room A |',
    '| 2:30 | Writing a Résumé | Room C |',
  ].join('\n'),
  lines: [
    say(
      'W1',
      'uk',
    )(
      "Good morning, and welcome to Saturday Workshops at Brayford Library. Before we begin, I have a few changes to today's schedule. Unfortunately, the instructor for the eleven thirty session called this morning to say she's sick, so that workshop will be moved to next month. Everyone who registered for it will receive an e-mail with the new date. Also, the room for the afternoon résumé workshop has changed. Because so many people signed up, it'll be held in the main reading room on the ground floor instead. Finally, if you'd like a copy of the slides from any of today's workshops, please write your e-mail address on the sign-up sheet at the front desk.",
    ),
  ],
  items: [
    {
      n: 95,
      subskill: 'graphic_question',
      difficulty: 'B1',
      stem: `${GRAPHIC_STEM} Which workshop will not take place today?`,
      options: ['Starting a Blog', 'Online Safety', 'Writing a Résumé', 'Photo Editing Basics'],
      correct: 'D',
      vi: 'Buổi 11:30 bị dời sang tháng sau; theo lịch, 11:30 là "Photo Editing Basics" (D). Bẫy: (C) buổi viết hồ sơ chỉ đổi phòng, vẫn diễn ra.',
      en: 'The 11:30 session is moved to next month; the schedule shows it is Photo Editing Basics (D). Trap: the résumé workshop only changes rooms.',
      evidence: "the instructor for the eleven thirty session called this morning to say she's sick",
      graphic: true,
    },
    {
      n: 96,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'Why has a room been changed?',
      options: [
        'A workshop is very popular.',
        'A room is being cleaned.',
        'An instructor requested it.',
        'Some equipment is not working.',
      ],
      correct: 'A',
      vi: '"so many people signed up" – rất nhiều người đăng ký → buổi học rất được quan tâm (A). Các lý do khác không được nhắc.',
      en: 'So many people signed up that a bigger room is needed, i.e., the workshop is popular (A).',
      evidence: "Because so many people signed up, it'll be held in the main reading room on the ground floor instead.",
    },
    {
      n: 97,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'How can listeners get copies of the slides?',
      options: [
        "By visiting the library's Web site",
        'By leaving their e-mail address',
        'By asking an instructor',
        'By registering for next month',
      ],
      correct: 'B',
      vi: 'Ghi địa chỉ email vào tờ đăng ký ở quầy lễ tân để nhận slide (B). Bẫy: (D) "next month" là thời điểm buổi học bị dời.',
      en: 'They write their e-mail address on the sign-up sheet (B). Trap: next month is when the postponed workshop will be held.',
      evidence: 'please write your e-mail address on the sign-up sheet at the front desk.',
    },
  ],
});

const P4_T10 = group({
  section: 'part4',
  index: 10,
  topic: 'business',
  title: 'Talk 10 – Telephone message and forecast',
  kind: 'telephone message and weather forecast',
  graphic: [
    '**Port Callan – Five-Day Forecast**',
    '',
    '| Day | Forecast | High |',
    '| --- | --- | --- |',
    '| Wednesday | Sunny | 24°C |',
    '| Thursday | Heavy rain | 18°C |',
    '| Friday | Cloudy | 21°C |',
    '| Saturday | Sunny | 26°C |',
    '| Sunday | Light rain | 19°C |',
  ].join('\n'),
  lines: [
    say(
      'M1',
      'us',
    )(
      "Hi, Danielle, it's Kofi from Lakeview Events. I'm calling about your company's staff picnic at Harbor Park. As you know, it's scheduled for Thursday, but the forecast shows heavy rain that day. The park will let us change the date at no extra cost, as long as we tell them by noon tomorrow. The picnic area isn't available on weekends, so I suggest moving the picnic to the first dry day after Thursday. The caterer has already confirmed that they can deliver on that day, too. I'll also need to know whether your number of guests has changed since last week, because the caterer needs a final count. Please call me back this afternoon.",
    ),
  ],
  items: [
    {
      n: 98,
      subskill: 'listening_inference',
      difficulty: 'B1',
      stem: 'Who most likely is the speaker?',
      options: ['A park ranger', 'A weather reporter', 'An event planner', 'A restaurant chef'],
      correct: 'C',
      vi: 'Người nói làm ở "Lakeview Events" và đang sắp xếp buổi dã ngoại, liên hệ công viên và bên phục vụ ăn uống → người tổ chức sự kiện (C). Bẫy: (A), (B), (D) là những bên được nhắc tới.',
      en: 'He works for Lakeview Events and is arranging the picnic with the park and the caterer, so he is an event planner (C).',
      evidence: "it's Kofi from Lakeview Events",
    },
    {
      n: 99,
      subskill: 'graphic_question',
      difficulty: 'B2',
      stem: `${GRAPHIC_STEM} On which day will the picnic most likely be held?`,
      options: ['Wednesday', 'Friday', 'Saturday', 'Sunday'],
      correct: 'B',
      vi: 'Ngày khô ráo đầu tiên sau thứ Năm và không rơi vào cuối tuần → thứ Sáu (trời nhiều mây, không mưa) (B). Bẫy: (C) thứ Bảy nắng đẹp nhưng khu dã ngoại không mở cuối tuần; (A) thứ Tư là trước thứ Năm.',
      en: 'The first dry day after Thursday that is not on a weekend is Friday (B). Traps: Saturday is sunny but unavailable, and Wednesday is before Thursday.',
      evidence: 'I suggest moving the picnic to the first dry day after Thursday.',
      graphic: true,
    },
    {
      n: 100,
      subskill: 'listening_detail',
      difficulty: 'B1',
      stem: 'What information does the speaker request?',
      options: ['The number of guests', 'The address of the park', 'A menu choice', 'A payment method'],
      correct: 'A',
      vi: 'Người nói cần biết số khách có thay đổi không để báo bên phục vụ (A). Bẫy: (C) có nhắc bên phục vụ ăn uống nhưng không hỏi thực đơn.',
      en: 'He needs to know whether the number of guests has changed (A). Trap: the caterer is mentioned, but no menu choice is requested.',
      evidence: "I'll also need to know whether your number of guests has changed since last week",
    },
  ],
});

// ===========================================================================
// Đề hoàn chỉnh + bộ luyện theo Part

const GROUPS: readonly Group[] = [
  P3_C01,
  P3_C02,
  P3_C03,
  P3_C04,
  P3_C05,
  P3_C06,
  P3_C07,
  P3_C08,
  P3_C09,
  P3_C10,
  P3_C11,
  P3_C12,
  P3_C13,
  P4_T01,
  P4_T02,
  P4_T03,
  P4_T04,
  P4_T05,
  P4_T06,
  P4_T07,
  P4_T08,
  P4_T09,
  P4_T10,
];

export const LISTENING_FULL_01: {
  code: 'toeic-listening-full-01';
  title: { vi: string; en: string };
  groups: ListeningGroup[];
  questions: ListeningQuestion[];
} = {
  code: 'toeic-listening-full-01',
  title: {
    vi: 'Đề luyện TOEIC Listening đầy đủ 01 (Part 1–4, 100 câu)',
    en: 'TOEIC Listening Full Practice Test 01 (Parts 1–4, 100 questions)',
  },
  groups: GROUPS.map((g) => g.group),
  questions: [...PART1, ...PART2, ...GROUPS.flatMap((g) => g.questions)].sort((a, b) => a.number - b.number),
};

const keysOf = (section: ListeningQuestion['section'], from: number, to: number): string[] =>
  LISTENING_FULL_01.questions
    .filter((q) => q.section === section && q.number >= from && q.number <= to)
    .map((q) => q.key);

/** 4 bộ luyện theo Part – chỉ tham chiếu key câu trong LISTENING_FULL_01 */
export const LISTENING_DRILLS: Array<{
  code: string;
  title: { vi: string; en: string };
  section: 'part1' | 'part2' | 'part3' | 'part4';
  question_keys: string[];
}> = [
  {
    code: 'toeic-listening-01-drill-part1',
    title: { vi: 'Luyện Part 1 – 6 câu mô tả tranh (Đề 01)', en: 'Part 1 Drill – 6 photographs (Test 01)' },
    section: 'part1',
    question_keys: keysOf('part1', 1, 6),
  },
  {
    code: 'toeic-listening-01-drill-part2',
    title: { vi: 'Luyện Part 2 – 12 câu hỏi đáp (Đề 01)', en: 'Part 2 Drill – 12 questions (Test 01)' },
    section: 'part2',
    question_keys: keysOf('part2', 7, 18),
  },
  {
    code: 'toeic-listening-01-drill-part3',
    title: { vi: 'Luyện Part 3 – 4 hội thoại (Đề 01)', en: 'Part 3 Drill – 4 conversations (Test 01)' },
    section: 'part3',
    question_keys: keysOf('part3', 32, 43),
  },
  {
    code: 'toeic-listening-01-drill-part4',
    title: { vi: 'Luyện Part 4 – 4 bài nói (Đề 01)', en: 'Part 4 Drill – 4 talks (Test 01)' },
    section: 'part4',
    question_keys: keysOf('part4', 71, 82),
  },
];
