import type { QuestionContent } from '@allingo/schemas';

/**
 * Đề TOEIC Reading đầy đủ số 01 – 100 câu (101–200), cấu trúc Part 5 (30) / Part 6 (16) / Part 7 (54).
 *
 * Nội dung TỰ BIÊN SOẠN hoàn toàn (khi seed: source = 'human'), không sao chép hay diễn lại đề ETS hoặc sách luyện thi.
 * Mọi công ty, sản phẩm, con người, địa danh (Holloway, Port Callan, Dunhaven…) đều hư cấu; tên miền email/web dùng
 * `.example` (RFC 2606) để không trùng địa chỉ thật. Phong cách bám định dạng TOEIC L&R Reading.
 *
 * Quy ước dữ liệu:
 * - Câu hỏi: key `r01-q<số câu>`; Part 6/7 có `passage_key` (đoạn đầu của nhóm) + `group_key`.
 * - Đoạn đơn: `group_key` = key của đoạn. Nhóm đa đoạn: các đoạn `<group_key>-a|b|c` cùng `group_key`.
 * - Part 6 đánh dấu chỗ trống `[131]`…`[146]` trong body; Part 7 câu chèn câu dùng `[1]`–`[4]`.
 * - Câu từ vựng Part 7 ("paragraph N, line 1"): từ được hỏi luôn nằm ở đầu đoạn văn để "line 1" đúng ở mọi độ rộng màn hình.
 * - `catalog.questions.passage_id` chỉ trỏ được một đoạn: dùng `mergeGroupPassages()` để gộp nhóm đa đoạn thành một
 *   bản ghi `catalog.passages` khi seed (xem cuối tệp); từ B5/S24 từng văn bản còn được ghi vào `catalog.passage_parts`.
 */

export interface ReadingPassage {
  key: string;
  kind: 'reading_passage';
  title: string;
  body: string;
  /** nhóm đa đoạn: các đoạn cùng group_key */
  group_key: string;
  section: 'part6' | 'part7';
  topic: string;
}

export interface ReadingQuestion {
  key: string;
  number: number;
  section: 'part5' | 'part6' | 'part7';
  passage_key?: string;
  group_key?: string;
  subskill?: string;
  topic?: string;
  difficulty: 'A2' | 'B1' | 'B2';
  content: QuestionContent;
}

/** Mã topic khớp catalog.topics (seed core) */
export const READING_TOPICS = [
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
export type ReadingTopic = (typeof READING_TOPICS)[number];

/** Mã subskill TOEIC Reading khớp catalog.subskills (seed core) */
export const READING_SUBSKILLS = [
  'verb_tense',
  'word_form',
  'preposition',
  'conjunction',
  'pronoun',
  'vocabulary_context',
  'relative_clause',
  'detail',
  'inference',
  'paraphrase_recognition',
] as const;
export type ReadingSubskill = (typeof READING_SUBSKILLS)[number];

// ---------------------------------------------------------------------------
// Tiện ích dựng dữ liệu

type Letter = 'A' | 'B' | 'C' | 'D';
type Level = ReadingQuestion['difficulty'];
type Options4 = readonly [string, string, string, string];

interface ItemSpec {
  n: number;
  subskill: ReadingSubskill;
  difficulty: Level;
  stem: string;
  options: Options4;
  correct: Letter;
  vi: string;
  en: string;
  /** Trích nguyên văn từ body của một đoạn trong nhóm (Part 6/7) */
  evidence?: string;
}

interface DocSpec {
  title: string;
  lines: readonly string[];
}

interface Group {
  passages: ReadingPassage[];
  questions: ReadingQuestion[];
}

export const questionKey = (n: number): string => `r01-q${n}`;

function toContent(s: ItemSpec): QuestionContent {
  return {
    type: 'mcq_single',
    stem: s.stem,
    options: [
      { key: 'A', text: s.options[0] },
      { key: 'B', text: s.options[1] },
      { key: 'C', text: s.options[2] },
      { key: 'D', text: s.options[3] },
    ],
    answer_key: { correct: s.correct },
    explanation: { vi: s.vi, en: s.en },
    ...(s.evidence !== undefined ? { evidence: s.evidence } : {}),
    tags: [],
  };
}

const p5 = (s: ItemSpec & { topic: ReadingTopic }): ReadingQuestion => ({
  key: questionKey(s.n),
  number: s.n,
  section: 'part5',
  subskill: s.subskill,
  topic: s.topic,
  difficulty: s.difficulty,
  content: toContent(s),
});

function group(
  section: 'part6' | 'part7',
  groupKey: string,
  topic: ReadingTopic,
  docs: readonly DocSpec[],
  items: readonly ItemSpec[],
): Group {
  const passages: ReadingPassage[] = docs.map((d, i) => ({
    key: docs.length === 1 ? groupKey : `${groupKey}-${String.fromCharCode(97 + i)}`,
    kind: 'reading_passage',
    title: d.title,
    body: d.lines.join('\n'),
    group_key: groupKey,
    section,
    topic,
  }));
  const first = passages[0];
  if (!first) throw new Error(`Nhóm ${groupKey} không có đoạn văn`);
  const questions: ReadingQuestion[] = items.map((s) => ({
    key: questionKey(s.n),
    number: s.n,
    section,
    passage_key: first.key,
    group_key: groupKey,
    subskill: s.subskill,
    topic,
    difficulty: s.difficulty,
    content: toContent(s),
  }));
  return { passages, questions };
}

const blankStem = (n: number) => `Question ${n}: Choose the word or phrase that best completes blank [${n}].`;
const sentenceStem = (n: number) => `Question ${n}: Choose the sentence that best completes blank [${n}].`;
const insertStem = (sentence: string) =>
  `In which of the positions marked [1], [2], [3], and [4] does the following sentence best belong?\n"${sentence}"`;
const meanStem = (time: string, person: string, pronoun: 'she' | 'he', quote: string) =>
  `At ${time}, what does ${person} most likely mean when ${pronoun} writes, "${quote}"?`;
const wordStem = (word: string, paragraph: number, doc?: string) =>
  `${doc ? `In the ${doc}, the` : 'The'} word "${word}" in paragraph ${paragraph}, line 1, is closest in meaning to`;
const POSITIONS: Options4 = ['[1]', '[2]', '[3]', '[4]'];

// ===========================================================================
// PART 5 – Incomplete Sentences (101–130)

const PART5: ReadingQuestion[] = [
  p5({
    n: 101,
    topic: 'shopping',
    subskill: 'word_form',
    difficulty: 'A2',
    stem: 'Customers will find ______ instructions for assembling the bookshelf inside the box.',
    options: ['detail', 'detailed', 'detailing', 'details'],
    correct: 'B',
    vi: 'Trước danh từ "instructions" cần tính từ: "detailed instructions" (hướng dẫn chi tiết). Bẫy: "details" là danh từ, không bổ nghĩa cho danh từ khác.',
    en: 'An adjective is needed before the noun "instructions": "detailed instructions". Trap: "details" is a noun and cannot modify another noun.',
  }),
  p5({
    n: 102,
    topic: 'shopping',
    subskill: 'preposition',
    difficulty: 'A2',
    stem: 'Dorrance Bakery on Larch Street is open every day ______ 7:00 A.M. to 6:00 P.M.',
    options: ['at', 'by', 'until', 'from'],
    correct: 'D',
    vi: 'Cặp cố định "from … to …" chỉ một khoảng thời gian. Bẫy: "until" chỉ mốc kết thúc, không đi cùng "to".',
    en: 'The fixed pair "from ... to ..." expresses a time span. Trap: "until" marks only an end point and does not combine with "to".',
  }),
  p5({
    n: 103,
    topic: 'logistics',
    subskill: 'verb_tense',
    difficulty: 'B1',
    stem: 'Since last spring, Marrowfield Logistics ______ three new warehouses in the northern region.',
    options: ['has opened', 'opens', 'will open', 'is opening'],
    correct: 'A',
    vi: '"Since + mốc quá khứ" đi với thì hiện tại hoàn thành: "has opened". Bẫy: hiện tại đơn hay tương lai không diễn tả việc kéo dài đến hiện tại.',
    en: '"Since + a past point" requires the present perfect: "has opened". The simple present or future cannot describe an action continuing up to now.',
  }),
  p5({
    n: 104,
    topic: 'shopping',
    subskill: 'vocabulary_context',
    difficulty: 'B1',
    stem: 'Please keep your receipt, as it will be required for any ______ or exchange.',
    options: ['purchase', 'delivery', 'refund', 'discount'],
    correct: 'C',
    vi: '"refund or exchange" (hoàn tiền hoặc đổi hàng) là cặp tự nhiên khi nói về việc giữ hoá đơn. Các lựa chọn khác không cần hoá đơn sau khi đã mua.',
    en: '"Refund or exchange" is the natural pairing when talking about keeping a receipt. The other options do not require a receipt after a sale.',
  }),
  p5({
    n: 105,
    topic: 'hr',
    subskill: 'pronoun',
    difficulty: 'A2',
    stem: 'Ms. Okafor asked the interns to submit ______ timesheets before leaving on Friday.',
    options: ['their', 'them', 'theirs', 'themselves'],
    correct: 'A',
    vi: 'Trước danh từ "timesheets" cần tính từ sở hữu "their". Bẫy: "theirs" là đại từ sở hữu, đứng một mình, không đi kèm danh từ.',
    en: 'A possessive adjective is needed before the noun "timesheets". Trap: "theirs" is a possessive pronoun and cannot precede a noun.',
  }),
  p5({
    n: 106,
    topic: 'office',
    subskill: 'conjunction',
    difficulty: 'B1',
    stem: "______ the conference room is being repainted, this week's staff meeting will be held in the cafeteria.",
    options: ['Despite', 'Because', 'Unless', 'So that'],
    correct: 'B',
    vi: 'Cần liên từ nối mệnh đề chỉ lý do: "Because" (vì phòng họp đang được sơn lại). Bẫy: "Despite" là giới từ, không đi với mệnh đề.',
    en: 'A conjunction giving a reason is needed: "Because". Trap: "Despite" is a preposition and cannot introduce a clause.',
  }),
  p5({
    n: 107,
    topic: 'hr',
    subskill: 'relative_clause',
    difficulty: 'B1',
    stem: 'Employees ______ wish to attend the safety workshop should register with Mr. Delgado by Thursday.',
    options: ['whose', 'which', 'whom', 'who'],
    correct: 'D',
    vi: 'Cần đại từ quan hệ làm chủ ngữ chỉ người, theo sau là động từ "wish": "who". Bẫy: "whom" là tân ngữ, "which" dùng cho vật.',
    en: 'A subject relative pronoun for people is needed before the verb "wish": "who". "Whom" is an object form and "which" refers to things.',
  }),
  p5({
    n: 108,
    topic: 'technology',
    subskill: 'word_form',
    difficulty: 'B1',
    stem: 'The new scheduling software makes it much easier for managers to assign shifts ______.',
    options: ['fair', 'fairer', 'fairly', 'fairness'],
    correct: 'C',
    vi: 'Cần trạng từ bổ nghĩa cho động từ "assign": "fairly" (một cách công bằng). Bẫy: "fair" là tính từ.',
    en: 'An adverb is needed to modify the verb "assign": "fairly". Trap: "fair" is an adjective.',
  }),
  p5({
    n: 109,
    topic: 'logistics',
    subskill: 'verb_tense',
    difficulty: 'A2',
    stem: 'The shipment of printer cartridges ______ yesterday afternoon, two days earlier than expected.',
    options: ['arrives', 'arrived', 'has arrived', 'will arrive'],
    correct: 'B',
    vi: '"yesterday afternoon" là thời điểm xác định trong quá khứ nên dùng quá khứ đơn "arrived". Bẫy: hiện tại hoàn thành không đi với mốc quá khứ cụ thể.',
    en: '"Yesterday afternoon" is a finished past time, so the simple past is required. Trap: the present perfect cannot be used with a specific past time.',
  }),
  p5({
    n: 110,
    topic: 'business',
    subskill: 'vocabulary_context',
    difficulty: 'B2',
    stem: 'After months of negotiation, Velmora Textiles reached an agreement that will ______ its supply of organic cotton for the next five years.',
    options: ['secure', 'attend', 'consist', 'remain'],
    correct: 'A',
    vi: '"secure its supply" = bảo đảm nguồn cung. Bẫy: "consist" và "remain" là nội động từ, không nhận tân ngữ trực tiếp.',
    en: '"Secure its supply" means to guarantee it. Trap: "consist" and "remain" are intransitive and cannot take a direct object.',
  }),
  p5({
    n: 111,
    topic: 'health',
    subskill: 'preposition',
    difficulty: 'B1',
    stem: "All visitors must sign in at the reception desk ______ entering the clinic's laboratory.",
    options: ['during', 'between', 'before', 'among'],
    correct: 'C',
    vi: '"before + V-ing" chỉ trình tự: ký tên trước khi vào phòng xét nghiệm. Bẫy: "during" đi với danh từ chỉ khoảng thời gian, không hợp nghĩa.',
    en: '"Before + -ing" shows the sequence: sign in, then enter. Trap: "during" needs a noun for a period of time and does not fit the meaning.',
  }),
  p5({
    n: 112,
    topic: 'finance',
    subskill: 'pronoun',
    difficulty: 'B1',
    stem: 'Mr. Haldane prefers to review the budget proposals ______ rather than delegate the task to an assistant.',
    options: ['he', 'his', 'him', 'himself'],
    correct: 'D',
    vi: 'Đại từ phản thân "himself" nhấn mạnh ông tự mình làm, đối lập với "delegate". Bẫy: "him" là tân ngữ thường, không mang nghĩa "tự mình".',
    en: 'The reflexive "himself" stresses that he does the work personally, in contrast with "delegate". Trap: "him" lacks this emphatic meaning.',
  }),
  p5({
    n: 113,
    topic: 'travel',
    subskill: 'word_form',
    difficulty: 'A2',
    stem: "The hotel's rooftop restaurant offers a ______ view of the harbor.",
    options: ['beauty', 'beautiful', 'beautifully', 'beautify'],
    correct: 'B',
    vi: 'Giữa mạo từ "a" và danh từ "view" cần tính từ "beautiful". Bẫy: "beautifully" là trạng từ.',
    en: 'Between the article "a" and the noun "view", an adjective is required. Trap: "beautifully" is an adverb.',
  }),
  p5({
    n: 114,
    topic: 'hr',
    subskill: 'conjunction',
    difficulty: 'B1',
    stem: 'Applicants for the position must have ______ a degree in marketing or at least two years of sales experience.',
    options: ['either', 'both', 'neither', 'whether'],
    correct: 'A',
    vi: 'Cặp liên từ "either … or" = hoặc … hoặc. Bẫy: "both" đi với "and", "neither" đi với "nor".',
    en: 'The paired conjunction "either ... or" is required. Trap: "both" pairs with "and", and "neither" pairs with "nor".',
  }),
  p5({
    n: 115,
    topic: 'technology',
    subskill: 'relative_clause',
    difficulty: 'B2',
    stem: 'The award was presented to Dr. Ilse Varga, ______ research on water filtration has benefited communities across the region.',
    options: ['who', 'whom', 'which', 'whose'],
    correct: 'D',
    vi: '"whose research" = nghiên cứu của bà ấy; "whose" chỉ sở hữu và theo sau là danh từ. Bẫy: "who" cần động từ đứng ngay sau.',
    en: '"Whose" shows possession and is followed by a noun: "whose research". Trap: "who" would need to be followed directly by a verb.',
  }),
  p5({
    n: 116,
    topic: 'hr',
    subskill: 'vocabulary_context',
    difficulty: 'B1',
    stem: 'Ms. Ferreira was ______ to regional manager after leading the most profitable branch for three consecutive years.',
    options: ['employed', 'appointed', 'promoted', 'assigned'],
    correct: 'C',
    vi: '"be promoted to + chức vụ" = được thăng chức, hợp với ngữ cảnh ba năm liền dẫn đầu. Bẫy: "appointed" thường dùng "appointed (as) + chức vụ", không đi với "to" ở đây.',
    en: '"Be promoted to + position" fits a reward for strong performance. Trap: "appointed" is normally used as "appointed (as) regional manager", not with "to".',
  }),
  p5({
    n: 117,
    topic: 'office',
    subskill: 'verb_tense',
    difficulty: 'B1',
    stem: 'Mr. Lindqvist ______ a client in Osaka when the fire alarm test began, so he did not hear the announcement.',
    options: ['was calling', 'calls', 'has called', 'will call'],
    correct: 'A',
    vi: 'Hành động đang diễn ra trong quá khứ thì có hành động khác xen vào ("when … began") nên dùng quá khứ tiếp diễn "was calling".',
    en: 'An action in progress in the past that is interrupted by another ("when ... began") requires the past continuous.',
  }),
  p5({
    n: 118,
    topic: 'business',
    subskill: 'word_form',
    difficulty: 'B2',
    stem: 'The board was impressed by the ______ of the proposal, which addressed every concern raised by shareholders.',
    options: ['thorough', 'thoroughness', 'thoroughly', 'more thorough'],
    correct: 'B',
    vi: 'Sau "the" và trước "of" cần danh từ: "thoroughness" (sự kỹ lưỡng). Bẫy: "thorough" là tính từ.',
    en: 'A noun is required between "the" and "of": "thoroughness". Trap: "thorough" is an adjective.',
  }),
  p5({
    n: 119,
    topic: 'travel',
    subskill: 'preposition',
    difficulty: 'A2',
    stem: 'The lost-and-found office is located ______ the second floor of the terminal.',
    options: ['in', 'at', 'up', 'on'],
    correct: 'D',
    vi: 'Với tầng của toà nhà dùng "on": "on the second floor". Bẫy: "in" và "at" không dùng với số tầng.',
    en: 'Floors of a building take "on": "on the second floor". Trap: "in" and "at" are not used with floor numbers.',
  }),
  p5({
    n: 120,
    topic: 'office',
    subskill: 'conjunction',
    difficulty: 'A2',
    stem: 'The printer on the third floor is old, ______ it still produces high-quality copies.',
    options: ['so', 'or', 'but', 'because'],
    correct: 'C',
    vi: 'Hai ý trái ngược (máy cũ nhưng vẫn in đẹp) nên dùng "but". Bẫy: "so" chỉ kết quả.',
    en: 'The two clauses contrast (old, yet good copies), so "but" is needed. Trap: "so" signals a result.',
  }),
  p5({
    n: 121,
    topic: 'technology',
    subskill: 'pronoun',
    difficulty: 'B1',
    stem: 'The new laptops arrived this morning, but the IT staff have not had time to set ______ up yet.',
    options: ['them', 'their', 'they', 'theirs'],
    correct: 'A',
    vi: 'Cụm động từ "set something up": đại từ tân ngữ "them" (= the laptops) đứng giữa. Bẫy: "they" là chủ ngữ.',
    en: 'In the phrasal verb "set ... up", the object pronoun "them" (the laptops) goes in the middle. Trap: "they" is a subject form.',
  }),
  p5({
    n: 122,
    topic: 'shopping',
    subskill: 'vocabulary_context',
    difficulty: 'B1',
    stem: 'To reduce waste, the café now ______ a discount to customers who bring their own cups.',
    options: ['charges', 'spends', 'offers', 'costs'],
    correct: 'C',
    vi: '"offer a discount to someone" = giảm giá cho ai. Bẫy: "charges" nghĩa là tính phí, ngược ý.',
    en: '"Offer a discount to someone" is the correct collocation. Trap: "charges" means to ask for payment, the opposite idea.',
  }),
  p5({
    n: 123,
    topic: 'logistics',
    subskill: 'relative_clause',
    difficulty: 'A2',
    stem: 'The package ______ arrived this morning contains the brochures for the trade show.',
    options: ['who', 'whose', 'where', 'that'],
    correct: 'D',
    vi: '"that" thay cho vật ("package") và làm chủ ngữ của "arrived". Bẫy: "who" chỉ dùng cho người, "where" chỉ nơi chốn.',
    en: '"That" refers to a thing ("package") and acts as the subject of "arrived". Trap: "who" is for people and "where" for places.',
  }),
  p5({
    n: 124,
    topic: 'technology',
    subskill: 'word_form',
    difficulty: 'B1',
    stem: 'Kestrin Software is known for its ______ approach to product design.',
    options: ['innovate', 'innovative', 'innovation', 'innovatively'],
    correct: 'B',
    vi: 'Giữa "its" và danh từ "approach" cần tính từ "innovative". Bẫy: "innovation" là danh từ.',
    en: 'An adjective is needed between "its" and the noun "approach": "innovative". Trap: "innovation" is a noun.',
  }),
  p5({
    n: 125,
    topic: 'travel',
    subskill: 'verb_tense',
    difficulty: 'B2',
    stem: 'By the time the renovation is complete in June, the museum ______ closed for nearly a year.',
    options: ['has been', 'will have been', 'was', 'had been'],
    correct: 'B',
    vi: '"By the time + hiện tại đơn" chỉ mốc tương lai nên dùng tương lai hoàn thành "will have been". Bẫy: "had been" là quá khứ hoàn thành, dùng cho mốc quá khứ.',
    en: '"By the time + simple present" refers to a future point, so the future perfect is required. Trap: "had been" is used for a past reference point.',
  }),
  p5({
    n: 126,
    topic: 'finance',
    subskill: 'conjunction',
    difficulty: 'B2',
    stem: '______ the budget is approved by Friday, the design team will not be able to begin work on the new campaign.',
    options: ['Unless', 'Whereas', 'Although', 'Provided'],
    correct: 'A',
    vi: '"Unless" = nếu không: nếu ngân sách không được duyệt thì không thể bắt đầu. Bẫy: "Provided" (miễn là) mâu thuẫn với "will not be able".',
    en: '"Unless" means "if ... not", which matches the negative result. Trap: "Provided" would contradict "will not be able".',
  }),
  p5({
    n: 127,
    topic: 'finance',
    subskill: 'pronoun',
    difficulty: 'A2',
    stem: 'If you have any questions about the reimbursement form, please contact ______ in the accounting office.',
    options: ['we', 'our', 'us', 'ours'],
    correct: 'C',
    vi: 'Sau động từ "contact" cần đại từ tân ngữ "us". Bẫy: "we" là chủ ngữ.',
    en: 'An object pronoun is needed after the verb "contact": "us". Trap: "we" is a subject form.',
  }),
  p5({
    n: 128,
    topic: 'shopping',
    subskill: 'vocabulary_context',
    difficulty: 'B2',
    stem: 'Because the instructions were ______, several customers assembled the desk incorrectly.',
    options: ['durable', 'punctual', 'generous', 'ambiguous'],
    correct: 'D',
    vi: '"ambiguous" (mơ hồ) giải thích vì sao khách lắp sai. Bẫy: "durable" (bền) dùng cho đồ vật, không hợp với hướng dẫn.',
    en: '"Ambiguous" (unclear) explains why customers made mistakes. Trap: "durable" describes objects, not instructions.',
  }),
  p5({
    n: 129,
    topic: 'business',
    subskill: 'preposition',
    difficulty: 'B1',
    stem: 'The marketing director will be traveling ______ the next two weeks and can be reached by e-mail.',
    options: ['for', 'since', 'along', 'toward'],
    correct: 'A',
    vi: '"for + khoảng thời gian" (trong hai tuần tới). Bẫy: "since" cần mốc thời gian và đi với thì hoàn thành.',
    en: '"For + a period of time" fits "the next two weeks". Trap: "since" needs a starting point and a perfect tense.',
  }),
  p5({
    n: 130,
    topic: 'logistics',
    subskill: 'word_form',
    difficulty: 'B1',
    stem: 'Please read the safety guidelines ______ before operating the new packaging machine.',
    options: ['care', 'careful', 'caring', 'carefully'],
    correct: 'D',
    vi: 'Cần trạng từ bổ nghĩa cho động từ "read": "carefully". Bẫy: "careful" là tính từ.',
    en: 'An adverb is needed to modify the verb "read": "carefully". Trap: "careful" is an adjective.',
  }),
];

// ===========================================================================
// PART 6 – Text Completion (131–146)

const P6_01 = group(
  'part6',
  'r01-p6-01',
  'hr',
  [
    {
      title: 'E-mail',
      lines: [
        'To: All new employees',
        'From: Priya Raman, Human Resources',
        'Date: August 4',
        'Subject: Orientation week',
        '',
        'Welcome to Osterlund Engineering! We are delighted that you [131] our team. Your orientation week begins on Monday, August 11, at 9:00 A.M. in the Training Center on the ground floor.',
        '',
        'During the first two days, you will meet representatives from each department and learn about our safety procedures. You will also receive your identification badge and a company laptop. [132], please bring a valid photo ID and your signed employment contract on Monday.',
        '',
        'On Wednesday, each of you will be paired with a mentor from your own department. [133] Mentors will meet with you weekly during your first three months to answer questions and help you settle in.',
        '',
        'If you have any questions before your start date, please do not hesitate to contact me. I look forward to [134] you next week.',
        '',
        'Priya Raman',
      ],
    },
  ],
  [
    {
      n: 131,
      subskill: 'verb_tense',
      difficulty: 'B1',
      stem: blankStem(131),
      options: ['join', 'have joined', 'joining', 'will have joined'],
      correct: 'B',
      vi: 'Việc gia nhập vừa xảy ra và kết quả còn ở hiện tại nên dùng hiện tại hoàn thành "have joined". Bẫy: "will have joined" là tương lai hoàn thành, không hợp với "We are delighted".',
      en: 'The joining has just happened and its result is present, so the present perfect fits. Trap: "will have joined" is future perfect and does not match "We are delighted".',
      evidence: 'We are delighted that you [131] our team.',
    },
    {
      n: 132,
      subskill: 'conjunction',
      difficulty: 'B1',
      stem: blankStem(132),
      options: ['However', 'Nevertheless', 'For this reason', 'In contrast'],
      correct: 'C',
      vi: 'Câu trước nói sẽ cấp thẻ nhân viên và laptop; vì vậy cần mang giấy tờ tuỳ thân, nên dùng "For this reason". Bẫy: "However/Nevertheless" chỉ sự đối lập.',
      en: 'Badges and laptops will be issued, so new employees must bring ID; "For this reason" shows that link. Trap: "However" and "Nevertheless" signal contrast.',
      evidence: '[132], please bring a valid photo ID and your signed employment contract on Monday.',
    },
    {
      n: 133,
      subskill: 'inference',
      difficulty: 'B1',
      stem: sentenceStem(133),
      options: [
        'Your mentor will also give you a tour of the work area where you will be based.',
        'The cafeteria serves lunch from 11:30 A.M. to 2:00 P.M. every weekday.',
        'Please return your laptop to the IT department if you leave the company.',
        'Our safety record is one of the best in the engineering industry.',
      ],
      correct: 'A',
      vi: 'Câu trước và câu sau chỗ trống đều nói về người hướng dẫn (mentor), nên câu về việc mentor dẫn đi xem khu làm việc là liền mạch nhất. Các câu còn lại lạc chủ đề của đoạn.',
      en: 'The sentences before and after the blank both concern mentors, so the sentence about the mentor giving a tour fits best. The others break the topic of the paragraph.',
      evidence:
        'On Wednesday, each of you will be paired with a mentor from your own department. [133] Mentors will meet with you weekly',
    },
    {
      n: 134,
      subskill: 'word_form',
      difficulty: 'B1',
      stem: blankStem(134),
      options: ['meet', 'met', 'meets', 'meeting'],
      correct: 'D',
      vi: 'Trong "look forward to", "to" là giới từ nên theo sau là V-ing: "meeting". Bẫy: tưởng "to" là to-infinitive rồi chọn "meet".',
      en: 'In "look forward to", "to" is a preposition, so it takes an -ing form: "meeting". Trap: treating "to" as part of an infinitive.',
      evidence: 'I look forward to [134] you next week.',
    },
  ],
);

const P6_02 = group(
  'part6',
  'r01-p6-02',
  'office',
  [
    {
      title: 'Notice',
      lines: [
        'NOTICE TO ALL TENANTS',
        'Fenmore Plaza Property Management',
        '',
        'Please be advised that the east elevators will be out of service from Monday, October 6, through Friday, October 10, while technicians [135] new control systems. During this period, the west elevators and the freight elevator will remain available.',
        '',
        'We understand that this work may cause some [136]. To reduce waiting times, we ask that tenants avoid using the elevators for trips of only one or two floors whenever possible. [137]',
        '',
        'Deliveries scheduled for that week should be directed to the loading dock on Pell Avenue, [138] staff will assist couriers with the freight elevator.',
        '',
        'Thank you for your patience and cooperation.',
      ],
    },
  ],
  [
    {
      n: 135,
      subskill: 'verb_tense',
      difficulty: 'B2',
      stem: blankStem(135),
      options: ['installed', 'had installed', 'install', 'will be installed'],
      correct: 'C',
      vi: 'Mệnh đề thời gian ("while …") nói về tương lai dùng hiện tại đơn: "install". Bẫy: "will be installed" vừa sai thì trong mệnh đề thời gian vừa là bị động, không hợp chủ ngữ "technicians".',
      en: 'Time clauses with "while" use the simple present for future events: "install". Trap: "will be installed" is both future and passive, which does not fit the subject "technicians".',
      evidence: 'while technicians [135] new control systems',
    },
    {
      n: 136,
      subskill: 'vocabulary_context',
      difficulty: 'B1',
      stem: blankStem(136),
      options: ['savings', 'inconvenience', 'approval', 'attendance'],
      correct: 'B',
      vi: 'Thang máy ngừng hoạt động gây "inconvenience" (bất tiện); câu sau đưa ra cách giảm thời gian chờ. Các danh từ khác không hợp nghĩa.',
      en: 'Elevator closures cause "inconvenience", and the next sentence offers a way to reduce it. The other nouns do not fit the meaning.',
      evidence: 'We understand that this work may cause some [136].',
    },
    {
      n: 137,
      subskill: 'inference',
      difficulty: 'B1',
      stem: sentenceStem(137),
      options: [
        'Our office is closed on national holidays.',
        'The west elevators were replaced last year at a cost of $2 million.',
        'Rent payments are due on the first day of each month.',
        'The stairwells on both sides of the building will remain open at all times.',
      ],
      correct: 'D',
      vi: 'Câu trước khuyên không dùng thang máy cho quãng 1–2 tầng; câu cho biết cầu thang bộ luôn mở là lựa chọn thay thế hợp lý. Câu về thang máy phía tây không nối tiếp lời khuyên đó.',
      en: 'The previous sentence asks tenants to avoid the elevators for short trips, and the sentence about open stairwells offers the alternative. The sentence about the west elevators does not follow from the request.',
      evidence:
        'we ask that tenants avoid using the elevators for trips of only one or two floors whenever possible. [137]',
    },
    {
      n: 138,
      subskill: 'relative_clause',
      difficulty: 'B1',
      stem: blankStem(138),
      options: ['where', 'which', 'what', 'whose'],
      correct: 'A',
      vi: '"where" thay cho nơi chốn "the loading dock" và mở đầu mệnh đề đầy đủ "staff will assist…". Bẫy: "which" đòi hỏi mệnh đề sau thiếu chủ ngữ hoặc tân ngữ.',
      en: '"Where" refers to the place ("the loading dock") and introduces a complete clause. Trap: "which" would require a missing subject or object in the clause.',
      evidence:
        'Deliveries scheduled for that week should be directed to the loading dock on Pell Avenue, [138] staff will assist couriers with the freight elevator.',
    },
  ],
);

const P6_03 = group(
  'part6',
  'r01-p6-03',
  'shopping',
  [
    {
      title: 'Advertisement',
      lines: [
        'Quillbrook Home Office Furniture: Grand Reopening',
        '',
        "After three months of renovation, Quillbrook's showroom on Daventry Road is open again, and it is bigger than ever. Our expanded floor space now [139] more than 200 desks, chairs, and storage units, all available for you to try before you buy.",
        '',
        'To celebrate, we are offering 20 percent off every ergonomic chair through the end of May. [140] who sign up for our free membership card will also receive free delivery on any purchase over $150. [141]',
        '',
        'Not sure which chair is right for you? Our trained staff can measure your desk height and recommend a model that suits your body and working style. Appointments are not required, but they are [142] recommended on weekends, when the showroom is at its busiest.',
      ],
    },
  ],
  [
    {
      n: 139,
      subskill: 'verb_tense',
      difficulty: 'B1',
      stem: blankStem(139),
      options: ['displaying', 'was displayed', 'displays', 'have displayed'],
      correct: 'C',
      vi: 'Chủ ngữ số ít "Our expanded floor space" cùng "now" cần hiện tại đơn "displays". Bẫy: "have displayed" sai hoà hợp chủ–vị; "was displayed" là bị động quá khứ.',
      en: 'The singular subject "floor space" with "now" requires the simple present "displays". Trap: "have displayed" does not agree with the subject, and "was displayed" is a past passive.',
      evidence: 'Our expanded floor space now [139] more than 200 desks, chairs, and storage units',
    },
    {
      n: 140,
      subskill: 'pronoun',
      difficulty: 'B2',
      stem: blankStem(140),
      options: ['Anyone', 'Those', 'Whoever', 'Them'],
      correct: 'B',
      vi: '"Those who + động từ số nhiều" = những ai; "sign" là động từ số nhiều nên chọn "Those". Bẫy: "Anyone who" cần "signs"; "Them" không làm chủ ngữ.',
      en: '"Those who" takes a plural verb, matching "sign". Trap: "Anyone who" would need "signs", and "Them" cannot be a subject.',
      evidence:
        '[140] who sign up for our free membership card will also receive free delivery on any purchase over $150.',
    },
    {
      n: 141,
      subskill: 'inference',
      difficulty: 'B1',
      stem: sentenceStem(141),
      options: [
        'Our original store opened in 1987 in a small garage.',
        'Unfortunately, the sale does not apply to office chairs.',
        'Delivery trucks must use the rear entrance on Market Lane.',
        'Membership cards can be requested at any checkout counter in less than five minutes.',
      ],
      correct: 'D',
      vi: 'Câu trước giới thiệu thẻ thành viên miễn phí; câu hướng dẫn cách nhận thẻ nối mạch tự nhiên. Câu "the sale does not apply to office chairs" mâu thuẫn với ưu đãi giảm 20% cho ghế.',
      en: 'The previous sentence introduces the free membership card, and the sentence explaining how to get one follows naturally. The sentence saying the sale excludes chairs contradicts the 20 percent chair discount.',
      evidence:
        'who sign up for our free membership card will also receive free delivery on any purchase over $150. [141]',
    },
    {
      n: 142,
      subskill: 'word_form',
      difficulty: 'A2',
      stem: blankStem(142),
      options: ['strongly', 'strong', 'strength', 'stronger'],
      correct: 'A',
      vi: 'Cần trạng từ bổ nghĩa cho phân từ "recommended": "strongly recommended" (rất nên). Bẫy: "strong" là tính từ.',
      en: 'An adverb is needed to modify the participle "recommended": "strongly recommended". Trap: "strong" is an adjective.',
      evidence: 'Appointments are not required, but they are [142] recommended on weekends',
    },
  ],
);

const P6_04 = group(
  'part6',
  'r01-p6-04',
  'finance',
  [
    {
      title: 'Memo',
      lines: [
        'MEMO',
        'To: All Staff',
        'From: Tomasz Wierzbicki, Finance Director',
        'Date: February 2',
        'Re: New expense reporting system',
        '',
        'Beginning March 1, all travel and business expenses must be submitted through Tallywise, our new online reporting system. Paper forms will no longer be [143] after that date.',
        '',
        '[144] Employees simply photograph their receipts with a mobile phone, and the amounts are entered automatically. Managers then receive a notification to review and approve each report.',
        '',
        'To help everyone become familiar with the system, the finance team will hold short training sessions every Tuesday and Thursday in February. Each session lasts about 30 minutes. [145], staff members who are unable to attend in person can watch a recorded version on the company intranet.',
        '',
        'Please direct any questions to Ms. Adebayo in the finance office, [146] is managing the transition.',
      ],
    },
  ],
  [
    {
      n: 143,
      subskill: 'vocabulary_context',
      difficulty: 'B1',
      stem: blankStem(143),
      options: ['spent', 'accepted', 'refused', 'delayed'],
      correct: 'B',
      vi: 'Từ 1/3 chi phí phải nộp qua hệ thống mới, nên mẫu giấy "will no longer be accepted" (không còn được nhận). Bẫy: "refused" đi với "no longer" cho nghĩa ngược lại.',
      en: 'Since expenses must go through the new system, paper forms will no longer be "accepted". Trap: "refused" gives the opposite meaning with "no longer".',
      evidence: 'Paper forms will no longer be [143] after that date.',
    },
    {
      n: 144,
      subskill: 'inference',
      difficulty: 'B1',
      stem: sentenceStem(144),
      options: [
        'Travel to our overseas offices has increased in recent years.',
        'The finance office will be closed for renovations in March.',
        'The new system is designed to make reporting faster and easier.',
        'Employees should keep their paper receipts for at least seven years.',
      ],
      correct: 'C',
      vi: 'Các câu sau mô tả hệ thống đơn giản ra sao (chụp hoá đơn, tự nhập số tiền), nên câu giới thiệu lợi ích "faster and easier" là phù hợp nhất. Câu về lưu hoá đơn giấy nhắc tới hoá đơn nhưng không dẫn vào phần mô tả.',
      en: 'The following sentences show how simple the system is, so the sentence introducing that benefit fits best. The sentence about keeping paper receipts mentions receipts but does not lead into the description.',
      evidence:
        '[144] Employees simply photograph their receipts with a mobile phone, and the amounts are entered automatically.',
    },
    {
      n: 145,
      subskill: 'conjunction',
      difficulty: 'B2',
      stem: blankStem(145),
      options: ['Additionally', 'Otherwise', 'Consequently', 'Nonetheless'],
      correct: 'A',
      vi: 'Câu sau bổ sung thêm một lựa chọn (xem bản ghi hình) bên cạnh các buổi đào tạo nên dùng "Additionally". Bẫy: "Consequently" chỉ kết quả, không có quan hệ nhân quả ở đây.',
      en: 'The sentence adds another option (a recording) to the training sessions, so "Additionally" fits. Trap: "Consequently" signals a result, which is not the relationship here.',
      evidence:
        '[145], staff members who are unable to attend in person can watch a recorded version on the company intranet.',
    },
    {
      n: 146,
      subskill: 'relative_clause',
      difficulty: 'A2',
      stem: blankStem(146),
      options: ['whom', 'which', 'whose', 'who'],
      correct: 'D',
      vi: 'Cần đại từ quan hệ làm chủ ngữ chỉ người (Ms. Adebayo), theo sau là động từ "is managing": "who". Bẫy: "whom" là tân ngữ.',
      en: 'A subject relative pronoun for a person (Ms. Adebayo) is needed before the verb "is managing": "who". Trap: "whom" is an object form.',
      evidence: 'Please direct any questions to Ms. Adebayo in the finance office, [146] is managing the transition.',
    },
  ],
);

// ===========================================================================
// PART 7 – Reading Comprehension, đoạn đơn (147–175)

const P7_S01 = group(
  'part7',
  'r01-p7-s01',
  'logistics',
  [
    {
      title: 'Text-message chain',
      lines: [
        'Hana Moreau (9:42 A.M.)',
        'Hi Dev, the truck with the display shelves just pulled into the loading area, but the driver says he can only stay for twenty minutes.',
        '',
        'Devraj Pillai (9:44 A.M.)',
        "I'm stuck in a client meeting until ten. Can Felix help him unload?",
        '',
        'Hana Moreau (9:45 A.M.)',
        'Felix called in sick today.',
        '',
        'Devraj Pillai (9:46 A.M.)',
        "Then ask the driver to leave everything by the back door. I'll move it inside myself after the meeting.",
        '',
        'Hana Moreau (9:47 A.M.)',
        "Will do. I'll keep an eye on the shelves until you get here.",
      ],
    },
  ],
  [
    {
      n: 147,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'Why does Ms. Moreau contact Mr. Pillai?',
      options: [
        'To ask him to reschedule a client meeting',
        'To let him know that a delivery has arrived',
        'To complain about a damaged shipment',
        'To ask for directions to a warehouse',
      ],
      correct: 'B',
      vi: '"the truck … just pulled into the loading area" = xe giao hàng vừa đến; đáp án diễn đạt lại ý này. Không có chi tiết nào về hàng hỏng hay hỏi đường.',
      en: '"The truck ... just pulled into the loading area" is paraphrased as "a delivery has arrived". Nothing is said about damage or directions.',
      evidence: 'the truck with the display shelves just pulled into the loading area',
    },
    {
      n: 148,
      subskill: 'inference',
      difficulty: 'B1',
      stem: meanStem('9:45 A.M.', 'Ms. Moreau', 'she', 'Felix called in sick today'),
      options: [
        'She will have to cancel a meeting.',
        'She wants Mr. Pillai to call a doctor.',
        'Felix cannot help the driver unload.',
        'Felix has already unloaded the truck.',
      ],
      correct: 'C',
      vi: 'Đây là câu trả lời cho "Can Felix help him unload?": Felix nghỉ ốm nên không thể giúp tài xế dỡ hàng. Bẫy: hiểu "sick" theo nghĩa đen rồi chọn phương án gọi bác sĩ.',
      en: 'She is answering "Can Felix help him unload?": Felix is off sick, so he cannot help. Trap: taking "sick" literally and choosing the doctor option.',
      evidence: 'Felix called in sick today.',
    },
  ],
);

const P7_S02 = group(
  'part7',
  'r01-p7-s02',
  'travel',
  [
    {
      title: 'Notice',
      lines: [
        'Westbridge Central Station: Notice to Passengers',
        '',
        'From Saturday, June 14, the ticket office on Platform 1 will close permanently. Tickets for all routes can be purchased from the self-service machines in the main hall or through the Westbridge Rail mobile app.',
        '',
        'Passengers who need help with tickets, refunds, or travel planning can visit the new Customer Help Point next to the north entrance. The Help Point is staffed from 6:00 A.M. to 10:00 P.M. daily.',
        '',
        'Season ticket holders do not need to take any action; existing season tickets remain valid until their printed expiry date.',
      ],
    },
  ],
  [
    {
      n: 149,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is the purpose of the notice?',
      options: [
        'To announce changes to train timetables',
        'To explain how to apply for a refund',
        'To advertise a new mobile application',
        'To inform passengers that a ticket counter is closing',
      ],
      correct: 'D',
      vi: 'Thông báo mở đầu bằng việc phòng vé ở sân ga 1 đóng cửa vĩnh viễn; đáp án diễn đạt lại thành "a ticket counter is closing". Ứng dụng và hoàn tiền chỉ là chi tiết phụ.',
      en: 'The notice opens by announcing that the ticket office will close permanently, which the answer paraphrases. The app and refunds are only supporting details.',
      evidence: 'the ticket office on Platform 1 will close permanently',
    },
    {
      n: 150,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'What is indicated about season tickets?',
      options: [
        'They can still be used as usual.',
        'They must be exchanged at the Help Point.',
        'They will be sold only through the mobile app.',
        'They will become more expensive in June.',
      ],
      correct: 'A',
      vi: '"do not need to take any action" và "remain valid" nghĩa là vé tháng vẫn dùng bình thường. Bẫy: Help Point được nhắc tới nhưng không bắt buộc với vé tháng.',
      en: '"Do not need to take any action" and "remain valid" mean the tickets can still be used as usual. Trap: the Help Point is mentioned but not required for season tickets.',
      evidence: 'existing season tickets remain valid until their printed expiry date',
    },
  ],
);

const P7_S03 = group(
  'part7',
  'r01-p7-s03',
  'education',
  [
    {
      title: 'Advertisement',
      lines: [
        'Speak with Confidence',
        'Corriden Community College: Evening Courses',
        '',
        'Do you freeze when asked to speak in a meeting? Our eight-week Public Speaking for Professionals course helps you plan clear presentations, manage nerves, and respond to difficult questions.',
        '',
        '- Classes meet every Wednesday from 6:30 to 8:30 P.M.',
        '- Groups are limited to twelve participants so that everyone receives personal feedback.',
        '- Each session is recorded, so you can review your progress at home.',
        '',
        'The course fee is $280. Employees of companies that belong to the Riverton Business Association receive a 15 percent discount. Enroll at the Admissions Office or call 555-0148.',
      ],
    },
  ],
  [
    {
      n: 151,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'What is NOT mentioned as a feature of the course?',
      options: ['Small class sizes', 'Recorded sessions', 'A certificate of completion', 'Individual feedback'],
      correct: 'C',
      vi: 'Quảng cáo nêu lớp tối đa 12 người, phản hồi cá nhân và ghi hình buổi học, nhưng không nhắc tới chứng chỉ. Với câu NOT, đối chiếu lần lượt từng phương án.',
      en: 'The ad mentions groups of twelve, personal feedback, and recorded sessions, but no certificate. For NOT questions, check each option against the text.',
      evidence: 'Groups are limited to twelve participants so that everyone receives personal feedback.',
    },
    {
      n: 152,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'How can some participants pay less for the course?',
      options: [
        'By enrolling online before a deadline',
        'By working for a member of a business group',
        'By attending classes on weekends',
        'By registering together with a colleague',
      ],
      correct: 'B',
      vi: 'Nhân viên của công ty thuộc Riverton Business Association được giảm 15%; đáp án diễn đạt lại thành "a member of a business group". Không có ưu đãi đăng ký sớm hay theo nhóm.',
      en: 'Employees of companies in the Riverton Business Association get 15 percent off, which the answer paraphrases. No early or group discount is mentioned.',
      evidence:
        'Employees of companies that belong to the Riverton Business Association receive a 15 percent discount.',
    },
  ],
);

const P7_S04 = group(
  'part7',
  'r01-p7-s04',
  'shopping',
  [
    {
      title: 'Invoice',
      lines: [
        'Tamsin Garden Supplies',
        '48 Orchard Lane, Holloway',
        '',
        'INVOICE No. 20417',
        'Date: April 22',
        'Bill to: Corrigan Café, 9 Mill Street, Holloway',
        '',
        'Large terracotta planter: 6 x $34.00 = $204.00',
        'Herb seedlings (tray of 12): 4 x $18.50 = $74.00',
        'Potting soil, 20 kg bag: 5 x $12.00 = $60.00',
        'Delivery and setup: 1 x $45.00 = $45.00',
        '',
        'Subtotal: $383.00',
        'Returning-customer discount (10%): -$38.30',
        'Amount due: $344.70',
        '',
        'Payment is due within 30 days. Please note that live plants cannot be returned once they have been delivered.',
      ],
    },
  ],
  [
    {
      n: 153,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What is suggested about Corrigan Café?',
      options: [
        'It sells gardening products to its customers.',
        'It has already paid the invoice.',
        'It ordered more soil than it needed.',
        'It has bought from Tamsin Garden Supplies before.',
      ],
      correct: 'D',
      vi: 'Hoá đơn có "Returning-customer discount" (giảm giá khách quen) nên quán đã từng mua trước đây. Bẫy: "Amount due" cho thấy hoá đơn vẫn chưa được thanh toán.',
      en: 'The "returning-customer discount" implies the café has bought from the shop before. Trap: "Amount due" shows the invoice has not been paid yet.',
      evidence: 'Returning-customer discount (10%): -$38.30',
    },
    {
      n: 154,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'Which items on the invoice cannot be returned?',
      options: ['The herb seedlings', 'The terracotta planters', 'The potting soil', 'The delivery service'],
      correct: 'A',
      vi: '"live plants" (cây sống) chính là "herb seedlings" (cây giống rau thơm); cần nhận ra cách diễn đạt khác. Chậu và đất không phải cây sống.',
      en: '"Live plants" refers to the herb seedlings; recognizing this paraphrase is the key. Planters and soil are not living plants.',
      evidence: 'live plants cannot be returned once they have been delivered',
    },
  ],
);

const P7_S05 = group(
  'part7',
  'r01-p7-s05',
  'hr',
  [
    {
      title: 'E-mail',
      lines: [
        'From: Corinne Abellard <c.abellard@ferrowaydesign.example>',
        'To: Samuel Okonjo <s.okonjo@ferrowaydesign.example>',
        'Date: November 3',
        'Subject: Your transfer request',
        '',
        'Dear Samuel,',
        '',
        'Thank you for submitting your request to transfer from our Lyon studio to the new office in Port Callan. I have discussed it with Ms. Haverty, who will lead the Port Callan team. [1]',
        '',
        'In particular, she was impressed by the packaging designs you produced for the Orla Tea campaign, and she agrees that your experience with food and beverage clients would be valuable there. However, the new office will not be fully equipped until mid-January, so your transfer cannot take effect before February 1. [2]',
        '',
        'The company will cover the cost of moving your belongings and will provide temporary housing for your first month. [3] Please let me know by November 14 whether the February start date works for you. [4]',
        '',
        'Best regards,',
        'Corinne Abellard',
        'Human Resources Manager',
      ],
    },
  ],
  [
    {
      n: 155,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'Why did Ms. Abellard write the e-mail?',
      options: [
        'To offer Mr. Okonjo a promotion',
        'To respond to a request Mr. Okonjo made',
        'To invite Mr. Okonjo to a design competition',
        'To ask Mr. Okonjo to train new employees',
      ],
      correct: 'B',
      vi: 'Email mở đầu bằng lời cảm ơn yêu cầu chuyển công tác và sau đó trả lời yêu cầu đó. Không có thông tin nào về thăng chức.',
      en: 'The e-mail thanks him for his transfer request and then responds to it. Nothing indicates a promotion.',
      evidence:
        'Thank you for submitting your request to transfer from our Lyon studio to the new office in Port Callan.',
    },
    {
      n: 156,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What is indicated about the Port Callan office?',
      options: [
        'It focuses on clients in the tea industry.',
        'It is managed by Ms. Abellard.',
        'It is not yet ready for full operation.',
        'It is smaller than the Lyon studio.',
      ],
      correct: 'C',
      vi: '"will not be fully equipped until mid-January" = chưa sẵn sàng hoạt động đầy đủ. Bẫy: người phụ trách văn phòng là Ms. Haverty, không phải Ms. Abellard.',
      en: '"Will not be fully equipped until mid-January" means it is not ready yet. Trap: Ms. Haverty, not Ms. Abellard, will lead the team.',
      evidence: 'the new office will not be fully equipped until mid-January',
    },
    {
      n: 157,
      subskill: 'inference',
      difficulty: 'B2',
      stem: insertStem('She was very enthusiastic about the idea.'),
      options: POSITIONS,
      correct: 'A',
      vi: 'Câu chèn cho biết Ms. Haverty rất ủng hộ; đặt ở [1] ngay sau câu nhắc tới bà và trước "In particular, she was impressed…". Ở [2] câu này mâu thuẫn với hạn chế vừa nêu ("However … cannot take effect").',
      en: `The sentence reports Ms. Haverty's positive reaction, so it belongs at [1], right after she is mentioned and before "In particular, she was impressed...". At [2] it would clash with the restriction just described.`,
      evidence: 'In particular, she was impressed by the packaging designs you produced for the Orla Tea campaign',
    },
  ],
);

const P7_S06 = group(
  'part7',
  'r01-p7-s06',
  'travel',
  [
    {
      title: 'Itinerary',
      lines: [
        'Travel Itinerary: Ms. Renata Solís, Regional Sales Director',
        'Prepared by: Aldermoor Corporate Travel Desk',
        '',
        'Monday, May 12',
        '7:10 A.M. | Depart Harlow Airport, Flight AT 318',
        '9:25 A.M. | Arrive in Kestwick; car service to the Glenmere Hotel',
        '1:00 P.M. | Lunch meeting with Pavel Novak, Novak Interiors (hotel restaurant)',
        '4:00 P.M. | Store visit, Kestwick Retail Park',
        '',
        'Tuesday, May 13',
        '9:00 A.M. | Regional sales review, Kestwick branch office, Room 4B',
        '12:30 P.M. | Lunch with branch managers (arranged by the branch office)',
        '5:45 P.M. | Depart Kestwick, Flight AT 327',
        '7:55 P.M. | Arrive at Harlow Airport',
        '',
        'Notes: The hotel reservation is for one night and includes breakfast. Your driver will meet you at Arrivals with a sign showing your name. Please keep all receipts for meals not included in this itinerary.',
      ],
    },
  ],
  [
    {
      n: 158,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'Where will Ms. Solís meet with Mr. Novak?',
      options: [
        'At Harlow Airport',
        'At the Kestwick branch office',
        'At Kestwick Retail Park',
        'At the place where she is staying',
      ],
      correct: 'D',
      vi: 'Bữa trưa với Mr. Novak ở "hotel restaurant", tức khách sạn Glenmere nơi bà lưu trú. Bẫy: văn phòng chi nhánh là nơi họp ngày thứ Ba.',
      en: `The lunch with Mr. Novak is at the "hotel restaurant", that is, where she is staying. Trap: the branch office is the location of Tuesday's meeting.`,
      evidence: 'Lunch meeting with Pavel Novak, Novak Interiors (hotel restaurant)',
    },
    {
      n: 159,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What is indicated about the lunch on May 13?',
      options: [
        'It will take place at the Glenmere Hotel.',
        'It was organized by someone other than the travel desk.',
        'Ms. Solís must pay for it herself.',
        'Mr. Novak will attend it.',
      ],
      correct: 'B',
      vi: '"arranged by the branch office" cho thấy bữa trưa do văn phòng chi nhánh sắp xếp, không phải bộ phận lập lịch trình. Bẫy: Mr. Novak thuộc bữa trưa ngày thứ Hai.',
      en: `"Arranged by the branch office" shows that someone other than the travel desk organized it. Trap: Mr. Novak belongs to Monday's lunch.`,
      evidence: 'Lunch with branch managers (arranged by the branch office)',
    },
    {
      n: 160,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is Ms. Solís asked to do?',
      options: [
        'Confirm her flight times',
        'Call the driver when she lands',
        'Book a second night at the hotel',
        'Save records of certain expenses',
      ],
      correct: 'D',
      vi: '"keep all receipts for meals not included" = giữ hoá đơn của một số khoản chi; đáp án diễn đạt lại thành "records of certain expenses".',
      en: '"Keep all receipts for meals not included" is paraphrased as saving records of certain expenses.',
      evidence: 'Please keep all receipts for meals not included in this itinerary.',
    },
  ],
);

const P7_S07 = group(
  'part7',
  'r01-p7-s07',
  'health',
  [
    {
      title: 'Web page',
      lines: [
        'www.ashgrovedental.example/new-patients',
        '',
        'Ashgrove Family Dental: Information for New Patients',
        '',
        'We are pleased to welcome new patients of all ages. To make your first visit as smooth as possible, please complete the patient registration form online at least 48 hours before your appointment. Patients who arrive without a completed form may be asked to reschedule.',
        '',
        'Your first appointment will last about one hour and includes a full examination, X-rays, and a cleaning. If you have dental records from a previous clinic, please ask that clinic to send them directly to us by e-mail.',
        '',
        'We are open Monday to Friday from 8:00 A.M. to 6:00 P.M. and on Saturday mornings by appointment only. Free parking is available behind the building, and the clinic is a five-minute walk from the Ashgrove Road bus stop.',
      ],
    },
  ],
  [
    {
      n: 161,
      subskill: 'detail',
      difficulty: 'A2',
      stem: 'What are new patients asked to do before their first visit?',
      options: ['Fill out a form', 'Pay a deposit', 'Have X-rays taken', 'Call the clinic to confirm'],
      correct: 'A',
      vi: '"complete the patient registration form" = điền mẫu đăng ký. Bẫy: chụp X-quang là một phần của buổi khám đầu, không phải việc làm trước đó.',
      en: '"Complete the patient registration form" means fill out a form. Trap: X-rays are part of the first visit, not something done before it.',
      evidence: 'please complete the patient registration form online at least 48 hours before your appointment',
    },
    {
      n: 162,
      subskill: 'inference',
      difficulty: 'B1',
      stem: "What is suggested about patients' previous dental records?",
      options: [
        'They must be brought to the first appointment.',
        'They are needed only for children.',
        "They can be uploaded on the clinic's Web site.",
        "They should be sent by a patient's former clinic.",
      ],
      correct: 'D',
      vi: 'Phòng khám đề nghị bệnh nhân nhờ phòng khám cũ gửi hồ sơ trực tiếp qua email. Bẫy: không có yêu cầu tự mang hồ sơ đến buổi khám.',
      en: 'Patients should ask their previous clinic to e-mail the records directly. Trap: patients are not asked to bring the records themselves.',
      evidence: 'please ask that clinic to send them directly to us by e-mail',
    },
    {
      n: 163,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'What is NOT stated about Ashgrove Family Dental?',
      options: [
        'It offers parking to patients.',
        'It is close to public transportation.',
        'It accepts walk-in patients on Saturdays.',
        'It treats patients of all ages.',
      ],
      correct: 'C',
      vi: 'Thứ Bảy chỉ khám theo lịch hẹn ("by appointment only"), nên không nhận khách vãng lai. Ba phương án còn lại đều có trong trang.',
      en: 'Saturday visits are "by appointment only", so walk-ins are not accepted. The other three options are all stated.',
      evidence: 'on Saturday mornings by appointment only',
    },
  ],
);

const P7_S08 = group(
  'part7',
  'r01-p7-s08',
  'technology',
  [
    {
      title: 'Online chat discussion',
      lines: [
        'Marta Lindgren [10:02 A.M.]',
        'Morning, everyone. The client now wants to see the updated version of the booking app on Thursday instead of Friday. Can we make that work?',
        '',
        'Jae-won Seo [10:04 A.M.]',
        "The payment screen is finished. The only thing left on my side is the map feature, and that's mostly testing now.",
        '',
        'Tobias Reinholt [10:06 A.M.]',
        "The design changes they asked for last week are done, but I haven't heard back from them about the new color scheme.",
        '',
        'Marta Lindgren [10:07 A.M.]',
        "I'll take care of that. I have a call with their marketing manager at noon.",
        '',
        'Priscilla Vance [10:09 A.M.]',
        'My concern is the testing schedule. We usually need two full days to check the app on different phones.',
        '',
        'Jae-won Seo [10:11 A.M.]',
        'I could start the phone tests tomorrow morning instead of Wednesday if Tobias sends me the final screens tonight.',
        '',
        'Tobias Reinholt [10:12 A.M.]',
        "That's not a problem.",
        '',
        'Marta Lindgren [10:14 A.M.]',
        "Great. Then let's plan on Thursday. Priscilla, could you book the large meeting room for the presentation?",
      ],
    },
  ],
  [
    {
      n: 164,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What is the discussion mainly about?',
      options: [
        'Hiring a new designer',
        'Meeting an earlier deadline',
        'Choosing a meeting room',
        'Fixing a problem with a payment screen',
      ],
      correct: 'B',
      vi: 'Khách muốn xem bản cập nhật vào thứ Năm thay vì thứ Sáu, nên cả nhóm bàn cách kịp hạn sớm hơn. Bẫy: đặt phòng họp chỉ là chi tiết cuối cuộc trao đổi.',
      en: 'The client moved the review from Friday to Thursday, and the team discusses how to meet the earlier date. Trap: booking a room is only a final detail.',
      evidence: 'The client now wants to see the updated version of the booking app on Thursday instead of Friday.',
    },
    {
      n: 165,
      subskill: 'inference',
      difficulty: 'B2',
      stem: meanStem('10:07 A.M.', 'Ms. Lindgren', 'she', "I'll take care of that"),
      options: [
        'She will finish the design changes herself.',
        'She will test the map feature.',
        'She will ask the client about the color scheme.',
        'She will reserve a room for the presentation.',
      ],
      correct: 'C',
      vi: '"that" chỉ việc Mr. Reinholt chưa nhận phản hồi về bảng màu; câu sau cho biết bà sẽ gọi cho trưởng phòng marketing của khách, tức là bà sẽ hỏi khách. Bẫy: đặt phòng là việc giao cho Priscilla.',
      en: `"That" refers to the missing feedback on the color scheme, and her call with the client's marketing manager shows she will ask them. Trap: booking the room is Priscilla's task.`,
      evidence: "I'll take care of that. I have a call with their marketing manager at noon.",
    },
    {
      n: 166,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What does Mr. Seo offer to do?',
      options: [
        'Start testing earlier than planned',
        'Redesign the payment screen',
        'Work over the weekend',
        'Present the app to the client',
      ],
      correct: 'A',
      vi: '"start the phone tests tomorrow morning instead of Wednesday" = bắt đầu kiểm thử sớm hơn kế hoạch.',
      en: '"Start the phone tests tomorrow morning instead of Wednesday" means testing earlier than planned.',
      evidence: 'I could start the phone tests tomorrow morning instead of Wednesday',
    },
    {
      n: 167,
      subskill: 'inference',
      difficulty: 'B1',
      stem: meanStem('10:12 A.M.', 'Mr. Reinholt', 'he', "That's not a problem"),
      options: [
        'He does not mind changing the color scheme.',
        'He is able to attend the presentation on Thursday.',
        'He has already reserved the meeting room.',
        'He can send the final screens this evening.',
      ],
      correct: 'D',
      vi: 'Mr. Reinholt trả lời điều kiện của Mr. Seo là cần nhận màn hình hoàn chỉnh "tonight", nên ý ông là có thể gửi trong tối nay.',
      en: `He is replying to Mr. Seo's condition that the final screens be sent tonight, so he means he can send them this evening.`,
      evidence: 'if Tobias sends me the final screens tonight',
    },
  ],
);

const P7_S09 = group(
  'part7',
  'r01-p7-s09',
  'business',
  [
    {
      title: 'Article',
      lines: [
        'Local Bakery Expands Beyond Its Neighborhood',
        'By Lucinda Farrow',
        '',
        "HOLLOWAY (March 8) — Pellwick Bakery, which has served the Eastgate neighborhood for more than thirty years, will open a second location in the city's downtown business district next month. [1]",
        '',
        'Owner Gareth Pellwick says the decision came after years of requests from office workers who used to live in Eastgate but now commute downtown. "Our regular customers kept telling us they missed our bread at lunchtime," he said. [2]',
        '',
        'The new shop, on Carver Street, will be larger than the original and will include seating for forty customers. Unlike the Eastgate shop, which closes at 3:00 P.M., the downtown location will remain open until 7:00 P.M. to serve people leaving work. [3]',
        '',
        'To staff the new location, Pellwick Bakery plans to hire twelve employees, including two experienced pastry chefs. Mr. Pellwick added that all bread will continue to be baked at the Eastgate shop each morning and transported downtown by van. [4] "That way, we can guarantee the same quality at both locations," he explained.',
      ],
    },
  ],
  [
    {
      n: 168,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What is the article mainly about?',
      options: [
        'A bakery that is moving to a new neighborhood',
        'A business that is opening an additional shop',
        'A new rule affecting downtown businesses',
        'A baking competition held in Holloway',
      ],
      correct: 'B',
      vi: '"will open a second location" = mở thêm một cửa hàng. Bẫy: tiệm cũ ở Eastgate vẫn hoạt động nên không phải "chuyển địa điểm".',
      en: '"Will open a second location" is paraphrased as "opening an additional shop". Trap: the Eastgate shop stays open, so the bakery is not moving.',
      evidence: "will open a second location in the city's downtown business district next month",
    },
    {
      n: 169,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'Why did Mr. Pellwick decide to open the new shop?',
      options: [
        'Former local residents asked for it.',
        'Rent in Eastgate has increased.',
        'The original shop has too few seats.',
        'A competitor closed its downtown shop.',
      ],
      correct: 'A',
      vi: 'Quyết định xuất phát từ yêu cầu của những nhân viên văn phòng "used to live in Eastgate", tức cựu cư dân khu này.',
      en: 'The decision followed requests from office workers who "used to live in Eastgate", that is, former local residents.',
      evidence:
        'the decision came after years of requests from office workers who used to live in Eastgate but now commute downtown',
    },
    {
      n: 170,
      subskill: 'vocabulary_context',
      difficulty: 'B2',
      stem: wordStem('staff', 4),
      options: ['manage', 'decorate', 'provide workers for', 'supply goods to'],
      correct: 'C',
      vi: 'Ở đây "staff" là động từ: cung cấp nhân sự cho cửa hàng mới, khớp với việc tuyển 12 nhân viên. Bẫy: "manage" có liên quan nhưng không cùng nghĩa.',
      en: 'Here "staff" is a verb meaning to provide workers for a place, as the plan to hire twelve employees shows. Trap: "manage" is related but not the same.',
      evidence: 'To staff the new location, Pellwick Bakery plans to hire twelve employees',
    },
    {
      n: 171,
      subskill: 'inference',
      difficulty: 'B2',
      stem: insertStem('The trip takes less than twenty minutes, so the bread is still warm when it arrives.'),
      options: POSITIONS,
      correct: 'D',
      vi: '"The trip" chỉ chuyến chở bánh bằng xe van ở câu ngay trước [4], và câu sau "That way, we can guarantee the same quality" nối tiếp tự nhiên.',
      en: '"The trip" refers to the van transport mentioned just before [4], and "That way, we can guarantee the same quality" follows naturally.',
      evidence: 'all bread will continue to be baked at the Eastgate shop each morning and transported downtown by van',
    },
  ],
);

const P7_S10 = group(
  'part7',
  'r01-p7-s10',
  'finance',
  [
    {
      title: 'Letter',
      lines: [
        'Harbourside Public Library Foundation',
        '22 Quay Road, Port Callan',
        '',
        'October 2',
        '',
        'Mr. Anselm Kirchner',
        '71 Linden Avenue',
        'Port Callan',
        '',
        'Dear Mr. Kirchner,',
        '',
        'On behalf of the Harbourside Public Library Foundation, thank you for your generous donation of $500 to our Reading Rooms for All campaign. Thanks to supporters like you, we have now raised $86,000 of our $120,000 goal.',
        '',
        "The campaign will fund the conversion of the library's unused basement into three quiet study rooms and a children's reading area. Construction is scheduled to begin in January, and we expect the new spaces to open in time for the summer reading program.",
        '',
        'As a token of our appreciation, your name will appear on the donor wall at the library entrance. You are also invited to a special preview of the new rooms before they open to the public. Details of the event will be sent to you in the spring.',
        '',
        'Please keep this letter as your official receipt for tax purposes.',
        '',
        'Sincerely,',
        'Edith Marlowe',
        'Director of Development',
      ],
    },
  ],
  [
    {
      n: 172,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'Why did Ms. Marlowe write to Mr. Kirchner?',
      options: [
        'To ask him to volunteer at the library',
        'To thank him for a contribution',
        "To invite him to join the foundation's board",
        'To inform him of new library hours',
      ],
      correct: 'B',
      vi: '"thank you for your generous donation" = cảm ơn khoản đóng góp; "donation" được diễn đạt lại thành "contribution".',
      en: '"Thank you for your generous donation" is paraphrased as "to thank him for a contribution".',
      evidence: 'thank you for your generous donation of $500',
    },
    {
      n: 173,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What is indicated about the Reading Rooms for All campaign?',
      options: [
        'It has not yet reached its goal.',
        'It was started by Mr. Kirchner.',
        'It will pay for a new library building.',
        'It ended in October.',
      ],
      correct: 'A',
      vi: 'Mới quyên được $86,000 trên mục tiêu $120,000 nên chưa đạt mục tiêu. Bẫy: tiền dùng để cải tạo tầng hầm, không xây toà nhà mới.',
      en: 'Only $86,000 of the $120,000 goal has been raised, so the goal has not been reached. Trap: the money converts a basement; it does not pay for a new building.',
      evidence: 'we have now raised $86,000 of our $120,000 goal',
    },
    {
      n: 174,
      subskill: 'vocabulary_context',
      difficulty: 'B2',
      stem: wordStem('token', 3),
      options: ['coin', 'ticket', 'symbol', 'payment'],
      correct: 'C',
      vi: '"a token of our appreciation" = biểu hiện của lòng biết ơn, gần nghĩa "symbol". Bẫy: "coin" và "ticket" là nghĩa đen của "token" nhưng không hợp ngữ cảnh.',
      en: '"A token of our appreciation" means a sign or symbol of gratitude. Trap: "coin" and "ticket" are literal meanings of "token" that do not fit here.',
      evidence: 'As a token of our appreciation, your name will appear on the donor wall at the library entrance.',
    },
    {
      n: 175,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What will Mr. Kirchner most likely receive in the spring?',
      options: [
        'A tax refund',
        'A library membership card',
        'A list of other donors',
        'Information about a preview event',
      ],
      correct: 'D',
      vi: '"Details of the event will be sent to you in the spring", và "the event" là buổi xem trước các phòng mới. Bẫy: phương án hoàn thuế mượn từ "tax" ở đoạn cuối.',
      en: '"Details of the event will be sent to you in the spring", and the event is the preview of the new rooms. Trap: the tax refund option borrows the word "tax" from the last paragraph.',
      evidence: 'Details of the event will be sent to you in the spring.',
    },
  ],
);

// ===========================================================================
// PART 7 – Reading Comprehension, đa đoạn (176–200)

const P7_M01 = group(
  'part7',
  'r01-p7-m01',
  'travel',
  [
    {
      title: 'E-mail',
      lines: [
        'From: Leona Fairweather <events@tessalinehotels.example>',
        'To: Ruben Achterberg <r.achterberg@marlowsurveying.example>',
        'Date: July 9',
        'Subject: Your booking for the September workshop',
        'Attachment: Booking summary',
        '',
        'Dear Mr. Achterberg,',
        '',
        "Thank you for choosing the Tessaline Hotel Riverside for your company's two-day workshop. As requested, we have reserved the Willow Room, which seats up to 40 people, for September 18 and 19. A summary of your booking is attached.",
        '',
        'Please review the summary carefully and confirm the final number of participants by August 29. Meals are charged per person, so the total may change once we receive your final figures. Changes to the room setup can be made at no extra charge until one week before the event.',
        '',
        'Workshop guests are entitled to a 15 percent discount on overnight rooms at the hotel. To receive this rate, they should mention your booking code when making a reservation.',
        '',
        'Kind regards,',
        'Leona Fairweather',
        'Events Coordinator, Tessaline Hotel Riverside',
      ],
    },
    {
      title: 'Booking summary',
      lines: [
        'Tessaline Hotel Riverside: Event Booking Summary',
        '',
        'Client: Marlow Surveying Ltd.',
        'Contact: Ruben Achterberg',
        'Booking code: WR0918',
        'Room: Willow Room (classroom setup)',
        'Dates: September 18-19',
        'Estimated number of participants: 32',
        '',
        'Services (per day)',
        '- Projector and screen: included',
        '- Morning coffee and pastries: $9 per person',
        '- Buffet lunch: $24 per person',
        '- Afternoon tea: $6 per person',
        '',
        'Estimated total for two days: $2,496.00',
        'Deposit received: $500.00',
      ],
    },
  ],
  [
    {
      n: 176,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is the main purpose of the e-mail?',
      options: [
        'To confirm the details of a reservation',
        "To promote a hotel's new meeting room",
        'To request payment of an overdue bill',
        'To apologize for a booking error',
      ],
      correct: 'A',
      vi: 'Email xác nhận đã đặt phòng Willow theo yêu cầu và gửi kèm bản tóm tắt, tức là xác nhận chi tiết đặt chỗ.',
      en: 'The e-mail confirms that the Willow Room has been reserved as requested and attaches a summary of the booking.',
      evidence: 'As requested, we have reserved the Willow Room, which seats up to 40 people, for September 18 and 19.',
    },
    {
      n: 177,
      subskill: 'detail',
      difficulty: 'A2',
      stem: 'By what date should Mr. Achterberg confirm the number of participants?',
      options: ['July 9', 'August 18', 'August 29', 'September 11'],
      correct: 'C',
      vi: 'Email ghi rõ "confirm the final number of participants by August 29". Bẫy: 11/9 là hạn đổi cách bố trí phòng (một tuần trước sự kiện).',
      en: 'The e-mail asks him to confirm the final number "by August 29". Trap: September 11 is the last day for setup changes (one week before the event).',
      evidence: 'confirm the final number of participants by August 29',
    },
    {
      n: 178,
      subskill: 'vocabulary_context',
      difficulty: 'B1',
      stem: wordStem('entitled', 3, 'e-mail'),
      options: ['named', 'eligible', 'required', 'invited'],
      correct: 'B',
      vi: '"be entitled to a discount" = có quyền được giảm giá, gần nghĩa "eligible". Bẫy: "named" là nghĩa của "entitled" khi nói về tên sách hay tác phẩm.',
      en: '"Be entitled to a discount" means to be eligible for it. Trap: "named" is the meaning used for titles of books or works.',
      evidence: 'Workshop guests are entitled to a 15 percent discount on overnight rooms at the hotel.',
    },
    {
      n: 179,
      subskill: 'inference',
      difficulty: 'B2',
      stem: 'What will most likely happen if Marlow Surveying confirms 40 participants?',
      options: [
        'A larger room will be needed.',
        'The deposit will be refunded.',
        'The projector will cost extra.',
        'The estimated total will increase.',
      ],
      correct: 'D',
      vi: 'Bản tóm tắt tính cho 32 người, còn email nói bữa ăn tính theo đầu người, nên với 40 người tổng chi phí sẽ tăng. Bẫy: phòng Willow chứa tối đa 40 người nên không cần phòng lớn hơn.',
      en: 'The summary is based on 32 people and meals are charged per person, so 40 participants would raise the total. Trap: the Willow Room seats up to 40, so no larger room is needed.',
      evidence: 'Meals are charged per person, so the total may change once we receive your final figures.',
    },
    {
      n: 180,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'What should workshop guests mention to receive a discount on an overnight room?',
      options: [
        'The name Marlow Surveying Ltd.',
        'The code WR0918',
        'The dates of the workshop',
        'The amount of the deposit',
      ],
      correct: 'B',
      vi: 'Email yêu cầu nêu "your booking code"; bản tóm tắt cho biết mã đặt chỗ là WR0918, nên phải kết hợp hai văn bản.',
      en: 'The e-mail says guests must mention the booking code, and the summary shows that the code is WR0918, so both documents are needed.',
      evidence: 'Booking code: WR0918',
    },
  ],
);

const P7_M02 = group(
  'part7',
  'r01-p7-m02',
  'shopping',
  [
    {
      title: 'Advertisement',
      lines: [
        'Nordvale Electronics',
        'Spring Sale on Home Office Equipment: March 1-31',
        '',
        'Upgrade your workspace and save!',
        '- 27-inch HD monitors: $219 (regular price $269)',
        '- Wireless keyboards: $39 (regular price $55)',
        '- Noise-canceling headsets: $89 (regular price $120)',
        '',
        'Free delivery on all orders over $100 within city limits. Online orders placed before 2:00 P.M. are delivered the next business day.',
        '',
        'All sale items come with our standard one-year warranty. Members of the Nordvale Rewards program earn double points on every purchase made in March.',
      ],
    },
    {
      title: 'E-mail',
      lines: [
        'From: Imogen Caldwell <i.caldwell@caldwellstudio.example>',
        'To: Customer Service <service@nordvale.example>',
        'Date: March 19',
        'Subject: Order 55821',
        '',
        'Hello,',
        '',
        'I placed an online order (No. 55821) at 11:30 A.M. on Monday, March 17, for two 27-inch monitors and one wireless keyboard. The confirmation e-mail said the items would arrive the next day, but nothing was delivered until this morning.',
        '',
        'In addition, one of the monitors has a crack in the corner of the screen. I have attached a photograph. I would like a replacement monitor sent as soon as possible rather than a refund, since I need it for a new employee who starts on Monday.',
        '',
        'I am also a Nordvale Rewards member, but my account shows only regular points for this purchase. Could you please look into this?',
        '',
        'Thank you,',
        'Imogen Caldwell',
      ],
    },
  ],
  [
    {
      n: 181,
      subskill: 'detail',
      difficulty: 'A2',
      stem: 'What is indicated about the sale?',
      options: [
        'It applies only to online orders.',
        'It lasts for two weeks.',
        'It includes reduced prices on keyboards.',
        'It is open only to Rewards members.',
      ],
      correct: 'C',
      vi: 'Bàn phím không dây giảm từ $55 xuống $39. Bẫy: đợt giảm giá kéo dài cả tháng 3, không phải hai tuần.',
      en: 'Wireless keyboards are reduced from $55 to $39. Trap: the sale runs for all of March, not two weeks.',
      evidence: 'Wireless keyboards: $39 (regular price $55)',
    },
    {
      n: 182,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'Why did Ms. Caldwell write the e-mail?',
      options: [
        'To report problems with an order',
        'To cancel a recent purchase',
        'To ask about a job opening',
        'To request a product catalog',
      ],
      correct: 'A',
      vi: 'Bà phản ánh giao hàng trễ, màn hình bị nứt và thiếu điểm thưởng, tức là báo các vấn đề của một đơn hàng. Bẫy: phương án tuyển dụng mượn chi tiết "new employee".',
      en: 'She reports a late delivery, a cracked screen, and missing points, all problems with an order. Trap: the job option misuses the detail about a new employee.',
      evidence: 'nothing was delivered until this morning',
    },
    {
      n: 183,
      subskill: 'inference',
      difficulty: 'B2',
      stem: "What is suggested about Ms. Caldwell's order?",
      options: [
        'It was placed after the sale ended.',
        'It did not qualify for free delivery.',
        'It included a headset.',
        'It arrived later than the store promised.',
      ],
      correct: 'D',
      vi: 'Đơn đặt online lúc 11:30 sáng thứ Hai 17/3 (trước 2 giờ chiều) nên theo quảng cáo phải giao ngày 18/3, nhưng đến 19/3 mới tới. Bẫy: đơn khoảng $477, vượt mức $100 nên vẫn được miễn phí giao hàng.',
      en: 'An online order placed at 11:30 A.M. (before 2:00 P.M.) should arrive the next business day, but it came on March 19. Trap: the order is about $477, well over $100, so delivery was free.',
      evidence: 'I placed an online order (No. 55821) at 11:30 A.M. on Monday, March 17',
    },
    {
      n: 184,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What does Ms. Caldwell ask the store to do?',
      options: [
        'Give her a full refund',
        'Send her another monitor',
        'Offer a discount on her next order',
        'Repair the damaged monitor',
      ],
      correct: 'B',
      vi: '"I would like a replacement monitor … rather than a refund" = muốn được gửi màn hình khác. Bẫy: hoàn tiền chính là điều bà nói không muốn.',
      en: '"A replacement monitor ... rather than a refund" means she wants another monitor. Trap: a refund is exactly what she says she does not want.',
      evidence: 'I would like a replacement monitor sent as soon as possible rather than a refund',
    },
    {
      n: 185,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What problem does Ms. Caldwell mention about her Rewards account?',
      options: [
        'She did not receive the extra points offered in March.',
        'She cannot log in to her account.',
        'Her membership has expired.',
        'Her points were used without permission.',
      ],
      correct: 'A',
      vi: 'Quảng cáo hứa thành viên được nhân đôi điểm trong tháng 3, nhưng tài khoản chỉ ghi điểm thường, nên bà bị thiếu điểm thưởng. Cần đối chiếu cả hai văn bản.',
      en: 'The ad promises double points in March, but her account shows only regular points, so she is missing the bonus. Both texts are needed.',
      evidence: 'my account shows only regular points for this purchase',
    },
  ],
);

const P7_M03 = group(
  'part7',
  'r01-p7-m03',
  'education',
  [
    {
      title: 'Web page',
      lines: [
        'www.fenwicklearninghub.example/summer-workshops',
        '',
        'Fenwick Learning Hub: Summer Workshops for Small Business Owners',
        'All workshops take place at our Kingsmere campus, 14 Albury Street.',
        '',
        'Bookkeeping Basics | Saturday, June 7 | Instructor: Nadia Kowalczyk | $95',
        'Social Media Marketing | Saturday, June 14 | Instructor: Oren Shapiro | $110',
        'Pricing Your Products | Saturday, June 21 | Instructor: Nadia Kowalczyk | $95',
        'Hiring Your First Employee | Saturday, June 28 | Instructor: Helena Brandt | $120',
        '',
        'Each workshop runs from 9:30 A.M. to 3:30 P.M. and includes lunch. Register for any three workshops and receive the fourth free. Registration closes five days before each workshop.',
      ],
    },
    {
      title: 'E-mail',
      lines: [
        'From: Dominic Ferrante <d.ferrante@ferrantegelato.example>',
        'To: Registration <registration@fenwicklearninghub.example>',
        'Date: June 3',
        'Subject: Registration question',
        '',
        'Hello,',
        '',
        'I run a small gelato shop and have already registered for the bookkeeping and pricing workshops. I would also like to attend the social media workshop, but I will be at a food fair in Ashby on that date. Will that workshop be offered again later this year?',
        '',
        'In addition, a friend of mine, Ms. Ayana Brooks, recently opened a flower shop and would like to join me at the June 21 workshop. Could you tell me whether there are still places available?',
        '',
        'Best regards,',
        'Dominic Ferrante',
      ],
    },
    {
      title: 'Feedback form',
      lines: [
        'Fenwick Learning Hub: Participant Feedback',
        '',
        'Name: Ayana Brooks',
        'Workshop attended: Pricing Your Products',
        'Date: June 21',
        'Overall rating: 4 out of 5',
        '',
        'Comments: The instructor explained how to calculate costs in a way that was easy to follow, and the examples from real shops were very useful. I especially liked the exercise in which we set prices for our own products. My only suggestion is to share the slides in advance so that we can take notes on them. I am now planning to attend the hiring workshop next week, since I hope to take on a part-time assistant this autumn.',
      ],
    },
  ],
  [
    {
      n: 186,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is true about all of the workshops?',
      options: [
        'They are taught by the same instructor.',
        'They are held on weekday evenings.',
        'They include a meal.',
        'They have the same fee.',
      ],
      correct: 'C',
      vi: '"Each workshop … includes lunch" nên mọi buổi đều có bữa ăn. Bẫy: học phí và giảng viên khác nhau giữa các buổi.',
      en: '"Each workshop ... includes lunch", so every workshop includes a meal. Trap: fees and instructors vary.',
      evidence: 'Each workshop runs from 9:30 A.M. to 3:30 P.M. and includes lunch.',
    },
    {
      n: 187,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'On what date will Mr. Ferrante most likely be at a food fair?',
      options: ['June 7', 'June 14', 'June 21', 'June 28'],
      correct: 'B',
      vi: 'Email nói hội chợ trùng ngày khoá Social Media Marketing; trang web cho biết khoá này vào 14/6, nên phải kết hợp hai văn bản.',
      en: 'The e-mail says the food fair falls on the day of the social media workshop, and the Web page dates that workshop June 14.',
      evidence:
        'I would also like to attend the social media workshop, but I will be at a food fair in Ashby on that date.',
    },
    {
      n: 188,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What does Mr. Ferrante ask about in his e-mail?',
      options: [
        'Whether he can get a refund',
        'How to become an instructor',
        'Where the workshops are held',
        'Whether someone else can join a workshop',
      ],
      correct: 'D',
      vi: 'Ông hỏi còn chỗ cho bạn mình (Ms. Brooks) dự buổi 21/6 không. Ông cũng hỏi buổi social media có mở lại không, nhưng không hỏi về hoàn tiền.',
      en: 'He asks whether there are places for his friend, Ms. Brooks, at the June 21 workshop. He does not ask about refunds.',
      evidence: 'Could you tell me whether there are still places available?',
    },
    {
      n: 189,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'Who most likely taught the workshop that Ms. Brooks attended?',
      options: ['Dominic Ferrante', 'Oren Shapiro', 'Nadia Kowalczyk', 'Helena Brandt'],
      correct: 'C',
      vi: 'Phiếu phản hồi cho biết Ms. Brooks dự "Pricing Your Products"; trang web ghi khoá này do Nadia Kowalczyk dạy.',
      en: 'The feedback form shows she attended "Pricing Your Products", and the Web page lists Nadia Kowalczyk as its instructor.',
      evidence: 'Workshop attended: Pricing Your Products',
    },
    {
      n: 190,
      subskill: 'inference',
      difficulty: 'B1',
      stem: 'What is suggested about Ms. Brooks?',
      options: [
        'She intends to hire someone for her business.',
        'She received one workshop free of charge.',
        'She would like to teach a workshop in the autumn.',
        'She attended a workshop on June 14.',
      ],
      correct: 'A',
      vi: '"take on a part-time assistant" = tuyển một trợ lý bán thời gian, nên bà định thuê người cho cửa hàng hoa. Bẫy: "take on" ở đây là "tuyển", không phải "đảm nhận".',
      en: '"Take on a part-time assistant" means to hire one, so she plans to employ someone. Trap: "take on" here means "hire", not "accept a task".',
      evidence: 'since I hope to take on a part-time assistant this autumn',
    },
  ],
);

const P7_M04 = group(
  'part7',
  'r01-p7-m04',
  'hr',
  [
    {
      title: 'Memo',
      lines: [
        'MEMO',
        'To: All Rennick Analytics employees',
        'From: Gloria Tanaka-Wells, Community Relations',
        'Date: April 2',
        'Subject: Community Service Day, May 16',
        '',
        'Once again this year, Rennick Analytics will close its offices on Friday, May 16, so that staff can volunteer with local organizations. Employees will receive their regular pay for the day.',
        '',
        'This year, we are partnering with four organizations (see the attached schedule). Places for each activity are limited, so please sign up on the staff portal by April 25. Employees who have not chosen an activity by that date will be assigned to one.',
        '',
        'Transportation will be provided from our main office to all activities except those within walking distance. Please wear comfortable clothing and bring a water bottle.',
      ],
    },
    {
      title: 'Schedule',
      lines: [
        'Community Service Day: Activity Schedule (Friday, May 16)',
        '',
        'Tree planting | Greenway Parks Trust | Halden Riverside Park | 8:30 A.M.-12:30 P.M. | 30 places',
        'Reading with children | Little Lanterns Literacy Project | Elm Road Primary School | 9:00 A.M.-12:00 P.M. | 12 places',
        'Meal preparation | Westside Community Kitchen | 5 Foundry Lane (next door to our main office) | 10:00 A.M.-2:00 P.M. | 20 places',
        'Computer skills for seniors | Silver Circle Center | Brayford Library | 1:00 P.M.-4:00 P.M. | 15 places',
      ],
    },
    {
      title: 'E-mail',
      lines: [
        'From: Kwame Asante <k.asante@rennickanalytics.example>',
        'To: Gloria Tanaka-Wells <g.tanakawells@rennickanalytics.example>',
        'Date: April 28',
        'Subject: Community Service Day',
        '',
        'Hi Gloria,',
        '',
        "I'm sorry I missed the deadline to sign up. I was traveling for a client project last week and didn't see the reminder until yesterday. I noticed that I've been assigned to the tree-planting activity, but I hurt my back recently and shouldn't do any heavy lifting.",
        '',
        "Since I work with spreadsheets all day, I think I'd be more useful teaching basic computer skills. I see that the afternoon activity still has a few places left. Would it be possible for me to switch?",
        '',
        'Thanks,',
        'Kwame',
      ],
    },
  ],
  [
    {
      n: 191,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is the purpose of the memo?',
      options: [
        'To announce new office hours',
        'To give details about a company event',
        'To ask employees to donate money',
        'To introduce a new staff portal',
      ],
      correct: 'B',
      vi: 'Bản ghi nhớ giới thiệu Ngày Phục vụ Cộng đồng (ngày tổ chức, đăng ký, đưa đón), tức là thông tin về một sự kiện của công ty.',
      en: 'The memo explains Community Service Day (date, sign-up, transportation), so it gives details about a company event.',
      evidence:
        'Rennick Analytics will close its offices on Friday, May 16, so that staff can volunteer with local organizations.',
    },
    {
      n: 192,
      subskill: 'inference',
      difficulty: 'B2',
      stem: 'For which activity will transportation most likely NOT be provided?',
      options: ['Tree planting', 'Reading with children', 'Computer skills for seniors', 'Meal preparation'],
      correct: 'D',
      vi: 'Memo nói không đưa đón tới hoạt động trong khoảng cách đi bộ; lịch cho thấy nấu ăn ở 5 Foundry Lane, ngay cạnh văn phòng chính. Cần kết hợp hai văn bản.',
      en: 'The memo excludes activities within walking distance, and the schedule places meal preparation next door to the main office.',
      evidence: '5 Foundry Lane (next door to our main office)',
    },
    {
      n: 193,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'Why was Mr. Asante assigned to an activity?',
      options: [
        'He asked to plant trees.',
        'He was chosen to lead a group.',
        'He did not sign up by April 25.',
        'He lives near Halden Riverside Park.',
      ],
      correct: 'C',
      vi: 'Ông lỡ hạn đăng ký, và memo nói ai chưa chọn trước 25/4 sẽ được xếp hoạt động; cần kết hợp email với memo.',
      en: 'He missed the sign-up deadline, and the memo says those who had not chosen by April 25 would be assigned.',
      evidence: "I'm sorry I missed the deadline to sign up.",
    },
    {
      n: 194,
      subskill: 'detail',
      difficulty: 'B1',
      stem: 'Where would Mr. Asante prefer to volunteer?',
      options: ['At Brayford Library', 'At Elm Road Primary School', 'At Halden Riverside Park', 'At 5 Foundry Lane'],
      correct: 'A',
      vi: 'Ông muốn dạy kỹ năng máy tính (hoạt động buổi chiều), và lịch cho biết hoạt động này ở Brayford Library. Bẫy: Halden Riverside Park là nơi ông đang được xếp.',
      en: 'He wants to teach computer skills, the afternoon activity, which takes place at Brayford Library. Trap: Halden Riverside Park is where he is currently assigned.',
      evidence: "I think I'd be more useful teaching basic computer skills",
    },
    {
      n: 195,
      subskill: 'paraphrase_recognition',
      difficulty: 'B1',
      stem: 'What is indicated about Mr. Asante?',
      options: [
        'He organizes Community Service Day.',
        'He recently joined Rennick Analytics.',
        'He was away on business in April.',
        'He volunteers at a library every week.',
      ],
      correct: 'C',
      vi: 'Email ngày 28/4 viết "I was traveling for a client project last week", tức là ông đi công tác trong tháng 4.',
      en: 'In his April 28 e-mail he says he was traveling for a client project the previous week, so he was away on business in April.',
      evidence: 'I was traveling for a client project last week',
    },
  ],
);

const P7_M05 = group(
  'part7',
  'r01-p7-m05',
  'logistics',
  [
    {
      title: 'Article',
      lines: [
        'Marrowfield Logistics Tests Cargo Bikes Downtown',
        'By Theo Brannigan',
        '',
        'DUNHAVEN (August 4) — Marrowfield Logistics has begun using electric cargo bikes to deliver small parcels in the center of Dunhaven. The six-month trial, which started on August 1, covers the area inside the Old Town ring road, where narrow streets and limited parking often slow down delivery vans.',
        '',
        'Each bike can handle loads of up to 120 kilograms. Parcels heavier than that, or larger than one meter on any side, will still be delivered by van. According to operations manager Rosa Itzel, the bikes are expected to cut delivery times in the Old Town by about a quarter.',
        '',
        'Businesses inside the trial zone can also request a new same-day delivery service for an additional fee. If the trial is successful, Marrowfield plans to introduce cargo bikes in two other cities next year.',
      ],
    },
    {
      title: 'E-mail',
      lines: [
        'From: Felicity Oduro <f.oduro@oduroprint.example>',
        'To: Rosa Itzel <r.itzel@marrowfield.example>',
        'Date: August 12',
        'Subject: Same-day deliveries',
        '',
        'Dear Ms. Itzel,',
        '',
        'I read about your cargo bike trial in the Dunhaven Courier. My print shop is on Saddler Street, just inside the Old Town ring road, and many of my customers need business cards and flyers delivered on the day they are printed.',
        '',
        'I would like to use your same-day service three or four times a week. Most of my parcels weigh less than 5 kilograms, but once a month I deliver a large order of posters packed in tubes that are 1.2 meters long. Could you send me information about your rates?',
        '',
        'Sincerely,',
        'Felicity Oduro',
        'Oduro Print & Copy',
      ],
    },
    {
      title: 'Rate sheet',
      lines: [
        'Marrowfield Logistics: Old Town Same-Day Service (Trial Rates)',
        '',
        'Parcel weight | Price per delivery',
        'Up to 5 kg | $6.50',
        '5.1 kg to 20 kg | $9.00',
        '20.1 kg to 50 kg | $14.00',
        '',
        '- Bookings must be made by 12:00 noon for delivery by 6:00 P.M. the same day.',
        '- Customers who book 10 or more deliveries per month receive a 10 percent discount.',
        '- Items that exceed cargo bike size limits are delivered by van at standard rates.',
      ],
    },
  ],
  [
    {
      n: 196,
      subskill: 'paraphrase_recognition',
      difficulty: 'A2',
      stem: 'What is the article mainly about?',
      options: [
        'The opening of a new parking area',
        'A trial of a new way to deliver parcels',
        'The closure of several Old Town streets',
        "A company's move to another city",
      ],
      correct: 'B',
      vi: 'Bài báo nói về thử nghiệm giao hàng bằng xe đạp chở hàng chạy điện. Bẫy: các phương án về bãi đỗ xe hay đường phố chỉ mượn lại từ "parking", "streets".',
      en: 'The article reports a trial of electric cargo bikes for deliveries. Trap: the parking and street options only reuse the words "parking" and "streets".',
      evidence:
        'Marrowfield Logistics has begun using electric cargo bikes to deliver small parcels in the center of Dunhaven.',
    },
    {
      n: 197,
      subskill: 'vocabulary_context',
      difficulty: 'B1',
      stem: wordStem('handle', 2, 'article'),
      options: ['carry', 'touch', 'control', 'discuss'],
      correct: 'A',
      vi: '"handle loads of up to 120 kilograms" = chở được tải tới 120 kg, gần nghĩa "carry". Bẫy: "touch" và "control" là các nghĩa khác của "handle".',
      en: '"Handle loads of up to 120 kilograms" means carry them. Trap: "touch" and "control" are other meanings of "handle".',
      evidence: 'Each bike can handle loads of up to 120 kilograms.',
    },
    {
      n: 198,
      subskill: 'inference',
      difficulty: 'B1',
      stem: "What is suggested about Ms. Oduro's business?",
      options: [
        'It recently moved to Saddler Street.',
        'It prints posters for Marrowfield Logistics.',
        'It has its own delivery van.',
        'It is located in the area covered by the trial.',
      ],
      correct: 'D',
      vi: 'Tiệm in nằm "just inside the Old Town ring road", và bài báo nói thử nghiệm áp dụng cho khu bên trong vành đai này; cần kết hợp hai văn bản.',
      en: 'Her shop is just inside the Old Town ring road, which the article identifies as the trial area.',
      evidence: 'My print shop is on Saddler Street, just inside the Old Town ring road',
    },
    {
      n: 199,
      subskill: 'inference',
      difficulty: 'B2',
      stem: "How will Ms. Oduro's monthly poster order most likely be delivered?",
      options: [
        'By cargo bike for $6.50',
        'By cargo bike for $9.00',
        'By van at a standard rate',
        'By the postal service',
      ],
      correct: 'C',
      vi: 'Ống poster dài 1,2 m (email) vượt giới hạn 1 m của xe đạp (bài báo), và bảng giá nói hàng quá cỡ đi bằng xe van với giá tiêu chuẩn; cần kết hợp cả ba văn bản.',
      en: 'The 1.2-meter tubes (e-mail) exceed the one-meter bike limit (article), and the rate sheet says oversized items go by van at standard rates.',
      evidence: 'Parcels heavier than that, or larger than one meter on any side, will still be delivered by van.',
    },
    {
      n: 200,
      subskill: 'inference',
      difficulty: 'B2',
      stem: "What is suggested about Ms. Oduro's planned use of the same-day service?",
      options: [
        'She will need to book before 6:00 P.M.',
        'She will qualify for a discount.',
        'She will pay $9.00 for most deliveries.',
        'She will need deliveries only on weekends.',
      ],
      correct: 'B',
      vi: '3–4 lần mỗi tuần là khoảng 12–16 lần mỗi tháng, vượt mốc 10 lần trong bảng giá nên được giảm 10%. Bẫy: hạn đặt là 12 giờ trưa (không phải 6 giờ chiều); phần lớn gói dưới 5 kg nên giá $6.50.',
      en: 'Three or four bookings a week is 12 to 16 a month, above the 10-booking threshold for a discount. Trap: the booking deadline is noon, not 6:00 P.M., and most parcels are under 5 kg ($6.50).',
      evidence: 'Customers who book 10 or more deliveries per month receive a 10 percent discount.',
    },
  ],
);

// ===========================================================================
// Đề hoàn chỉnh + bộ luyện theo Part

const GROUPS: readonly Group[] = [
  P6_01,
  P6_02,
  P6_03,
  P6_04,
  P7_S01,
  P7_S02,
  P7_S03,
  P7_S04,
  P7_S05,
  P7_S06,
  P7_S07,
  P7_S08,
  P7_S09,
  P7_S10,
  P7_M01,
  P7_M02,
  P7_M03,
  P7_M04,
  P7_M05,
];

export const READING_FULL_01: {
  code: 'toeic-reading-full-01';
  title: { vi: string; en: string };
  passages: ReadingPassage[];
  questions: ReadingQuestion[];
} = {
  code: 'toeic-reading-full-01',
  title: {
    vi: 'Đề luyện TOEIC Reading đầy đủ 01 (Part 5–7, 100 câu)',
    en: 'TOEIC Reading Full Practice Test 01 (Parts 5–7, 100 questions)',
  },
  passages: GROUPS.flatMap((g) => g.passages),
  questions: [...PART5, ...GROUPS.flatMap((g) => g.questions)].sort((a, b) => a.number - b.number),
};

const keysOf = (section: ReadingQuestion['section'], from: number, to: number): string[] =>
  READING_FULL_01.questions
    .filter((q) => q.section === section && q.number >= from && q.number <= to)
    .map((q) => q.key);

/** 3 bộ luyện theo Part – chỉ tham chiếu key câu trong READING_FULL_01 */
export const READING_DRILLS: Array<{
  code: string;
  title: { vi: string; en: string };
  section: 'part5' | 'part6' | 'part7';
  question_keys: string[];
}> = [
  {
    code: 'toeic-reading-01-drill-part5',
    title: { vi: 'Luyện Part 5 – 15 câu (Đề 01)', en: 'Part 5 Drill – 15 questions (Test 01)' },
    section: 'part5',
    question_keys: keysOf('part5', 101, 115),
  },
  {
    code: 'toeic-reading-01-drill-part6',
    title: { vi: 'Luyện Part 6 – 2 đoạn văn (Đề 01)', en: 'Part 6 Drill – 2 texts (Test 01)' },
    section: 'part6',
    question_keys: keysOf('part6', 131, 138),
  },
  {
    code: 'toeic-reading-01-drill-part7',
    title: {
      vi: 'Luyện Part 7 – 3 đoạn đơn + 1 bộ đôi (Đề 01)',
      en: 'Part 7 Drill – 3 single texts + 1 double set (Test 01)',
    },
    section: 'part7',
    question_keys: [...keysOf('part7', 147, 152), ...keysOf('part7', 176, 180)],
  },
];

// ---------------------------------------------------------------------------
// Gộp nhóm đa đoạn cho catalog.passages (questions.passage_id chỉ trỏ một đoạn)

export interface MergedGroupPassage {
  group_key: string;
  section: 'part6' | 'part7';
  topic: string;
  title: string;
  /** Bản gộp `[Tiêu đề]\n…` – dự phòng cho client cũ/AI giải thích (passages.body) */
  body: string;
  passage_keys: string[];
  /** B5/S24: nhóm đa đoạn → từng văn bản (catalog.passage_parts, tab trên giao diện); đoạn đơn → [] */
  parts: Array<{ sort_order: number; title: string; body: string }>;
}

/**
 * Một bản ghi mỗi group_key: đoạn đơn giữ nguyên; nhóm đa đoạn nối các đoạn theo thứ tự, mỗi đoạn mở đầu bằng
 * nhãn `[Tiêu đề]` để giao diện và AI giải thích phân biệt được từng văn bản.
 * B5/S24: nhóm đa đoạn kèm `parts` (một văn bản mỗi phần tử) → `catalog.passage_parts`; bản gộp giữ làm dự phòng.
 */
export function mergeGroupPassages(
  passages: readonly ReadingPassage[] = READING_FULL_01.passages,
): MergedGroupPassage[] {
  const byGroup = new Map<string, ReadingPassage[]>();
  for (const p of passages) byGroup.set(p.group_key, [...(byGroup.get(p.group_key) ?? []), p]);
  const merged: MergedGroupPassage[] = [];
  for (const [groupKey, list] of byGroup) {
    const [first, ...rest] = list;
    if (!first) continue;
    const single = rest.length === 0;
    merged.push({
      group_key: groupKey,
      section: first.section,
      topic: first.topic,
      title: single ? first.title : list.map((p) => p.title).join(' + '),
      body: single ? first.body : list.map((p) => `[${p.title}]\n${p.body}`).join('\n\n'),
      passage_keys: list.map((p) => p.key),
      parts: single ? [] : list.map((p, i) => ({ sort_order: i + 1, title: p.title, body: p.body })),
    });
  }
  return merged;
}
