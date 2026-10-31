import type { QuestionContent } from '@allingo/schemas';

/**
 * Nội dung demo TỰ BIÊN SOẠN cho Sprint 0 (source = 'human'). Không sao chép đề thi thật.
 * Các câu dùng ngữ cảnh văn phòng/kinh doanh phổ biến, mức khó A2–B1.
 */

export interface DemoQuestion {
  key: string;
  section: string;
  subskill?: string;
  topic?: string;
  difficulty: 'A2' | 'B1' | 'B2';
  content: QuestionContent;
}

const mcq = (
  key: string,
  section: string,
  stem: string,
  options: [string, string, string, string],
  correct: 'A' | 'B' | 'C' | 'D',
  explanation: { vi: string; en: string },
  extra: {
    subskill?: string;
    topic?: string;
    difficulty?: 'A2' | 'B1' | 'B2';
    evidence?: string;
    media?: QuestionContent['media'];
  } = {},
): DemoQuestion => ({
  key,
  section,
  subskill: extra.subskill,
  topic: extra.topic,
  difficulty: extra.difficulty ?? 'B1',
  content: {
    type: 'mcq_single',
    stem,
    options: [
      { key: 'A', text: options[0] },
      { key: 'B', text: options[1] },
      { key: 'C', text: options[2] },
      { key: 'D', text: options[3] },
    ],
    answer_key: { correct },
    explanation,
    evidence: extra.evidence,
    media: extra.media,
    tags: [],
  },
});

/** Part 5 – 10 câu hoàn thành câu */
export const DEMO_PART5: DemoQuestion[] = [
  mcq(
    'p5-01',
    'part5',
    'The quarterly report must be ______ to the finance department by Friday.',
    ['submit', 'submitted', 'submitting', 'submission'],
    'B',
    {
      vi: 'Cấu trúc bị động "must be + V3": báo cáo được nộp.',
      en: 'Passive "must be + past participle": the report is submitted.',
    },
    { subskill: 'word_form', topic: 'finance', evidence: 'must be ______ to' },
  ),
  mcq(
    'p5-02',
    'part5',
    'Ms. Tran will be out of the office ______ next Wednesday.',
    ['until', 'since', 'during', 'while'],
    'A',
    { vi: '"until" + mốc thời gian: vắng mặt cho đến thứ Tư tới.', en: '"until" + a point in time.' },
    { subskill: 'preposition', topic: 'office', difficulty: 'A2' },
  ),
  mcq(
    'p5-03',
    'part5',
    'All employees are required to wear ______ identification badges while in the building.',
    ['they', 'them', 'their', 'theirs'],
    'C',
    { vi: 'Cần tính từ sở hữu đứng trước danh từ "badges".', en: 'Possessive adjective before the noun "badges".' },
    { subskill: 'pronoun', topic: 'office', difficulty: 'A2' },
  ),
  mcq(
    'p5-04',
    'part5',
    'The new software update has ______ improved the speed of our online store.',
    ['significant', 'significance', 'significantly', 'signify'],
    'C',
    { vi: 'Trạng từ bổ nghĩa cho động từ "improved".', en: 'An adverb modifies the verb "improved".' },
    { subskill: 'word_form', topic: 'technology' },
  ),
  mcq(
    'p5-05',
    'part5',
    '______ the heavy rain, the outdoor product launch went ahead as planned.',
    ['Because', 'Despite', 'Although', 'Even'],
    'B',
    {
      vi: '"Despite" + cụm danh từ; "Although" cần mệnh đề.',
      en: '"Despite" + noun phrase; "Although" needs a clause.',
    },
    { subskill: 'conjunction', topic: 'business' },
  ),
  mcq(
    'p5-06',
    'part5',
    'The hotel offers a complimentary shuttle service ______ runs every thirty minutes.',
    ['who', 'that', 'where', 'what'],
    'B',
    { vi: 'Mệnh đề quan hệ chỉ vật dùng "that/which".', en: 'Relative pronoun for a thing: "that/which".' },
    { subskill: 'relative_clause', topic: 'travel' },
  ),
  mcq(
    'p5-07',
    'part5',
    'Please ______ the attached invoice and return a signed copy within five business days.',
    ['review', 'reviewing', 'reviewed', 'reviews'],
    'A',
    { vi: 'Câu mệnh lệnh dùng động từ nguyên mẫu.', en: 'Imperative sentence uses the base verb.' },
    { subskill: 'verb_tense', topic: 'finance', difficulty: 'A2' },
  ),
  mcq(
    'p5-08',
    'part5',
    "The marketing budget for next year is ______ larger than this year's.",
    ['very', 'much', 'more', 'so'],
    'B',
    { vi: '"much" nhấn mạnh so sánh hơn "larger".', en: '"much" intensifies the comparative "larger".' },
    { subskill: 'vocabulary_context', topic: 'finance' },
  ),
  mcq(
    'p5-09',
    'part5',
    'By the time the auditors arrive, the accounting team ______ all the records.',
    ['organizes', 'will have organized', 'has organized', 'is organizing'],
    'B',
    {
      vi: '"By the time + hiện tại" → tương lai hoàn thành ở mệnh đề chính.',
      en: '"By the time + present" → future perfect in the main clause.',
    },
    { subskill: 'verb_tense', topic: 'finance', difficulty: 'B2' },
  ),
  mcq(
    'p5-10',
    'part5',
    'Customers who register before March 1 are ______ to a 15 percent discount on their first order.',
    ['entitled', 'available', 'capable', 'eligible'],
    'A',
    {
      vi: '"be entitled to + danh từ" = được hưởng quyền; "eligible" đi với "for".',
      en: '"be entitled to + noun"; "eligible" collocates with "for".',
    },
    { subskill: 'vocabulary_context', topic: 'shopping', difficulty: 'B2' },
  ),
];

/** Part 2 – 6 câu hỏi đáp (audio placeholder: script lưu trong evidence, media gắn khi có TTS) */
export const DEMO_PART2: DemoQuestion[] = [
  {
    key: 'p2-01',
    section: 'part2',
    subskill: 'wh_question',
    difficulty: 'A2',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'B' },
      evidence:
        "Q: Where is the staff meeting this afternoon? — A: At three o'clock. B: In the conference room on the second floor. C: Yes, I will attend.",
      explanation: { vi: 'Câu hỏi "Where" cần trả lời về địa điểm.', en: '"Where" asks for a place.' },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
  {
    key: 'p2-02',
    section: 'part2',
    subskill: 'yes_no_question',
    difficulty: 'A2',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'A' },
      evidence:
        'Q: Did you send the contract to the client? — A: Yes, this morning. B: The client is from Singapore. C: It costs two hundred dollars.',
      explanation: { vi: 'Câu hỏi Yes/No về hành động đã làm.', en: 'Yes/No question about a completed action.' },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
  {
    key: 'p2-03',
    section: 'part2',
    subskill: 'indirect_response',
    difficulty: 'B1',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'C' },
      evidence:
        'Q: Who is going to present the sales figures? — A: The figures were higher last month. B: At the quarterly meeting. C: I thought Mr. Lee had volunteered.',
      explanation: {
        vi: 'Trả lời gián tiếp: nêu người đã xung phong.',
        en: 'Indirect answer naming the person who volunteered.',
      },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
  {
    key: 'p2-04',
    section: 'part2',
    subskill: 'similar_sound',
    difficulty: 'B1',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'B' },
      evidence:
        'Q: How long does the delivery usually take? — A: It takes the highway. B: About three business days. C: The package is quite long.',
      explanation: {
        vi: 'Bẫy từ lặp "take/long"; "How long" hỏi thời gian.',
        en: 'Distractors repeat "take/long"; "How long" asks duration.',
      },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
  {
    key: 'p2-05',
    section: 'part2',
    subskill: 'wh_question',
    difficulty: 'A2',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'A' },
      evidence:
        'Q: When will the new branch open? — A: Sometime in October. B: On Nguyen Hue Street. C: The manager opened it.',
      explanation: { vi: '"When" hỏi thời điểm.', en: '"When" asks for a time.' },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
  {
    key: 'p2-06',
    section: 'part2',
    subskill: 'indirect_response',
    difficulty: 'B2',
    content: {
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '' },
        { key: 'B', text: '' },
        { key: 'C', text: '' },
      ],
      answer_key: { correct: 'C' },
      evidence:
        'Q: Should we order more printer paper? — A: The printer is on the third floor. B: I ordered a sandwich. C: Let me check the supply closet first.',
      explanation: {
        vi: 'Trả lời gián tiếp hợp lý: kiểm tra kho trước.',
        en: 'Reasonable indirect response: check the closet first.',
      },
      media: { listen_policy: 'once', pause_ms: 5000 },
      tags: [],
    },
  },
];

export const DEMO_VOCAB: Array<{
  headword: string;
  pos: string;
  ipa: string;
  meaning: { vi: string; en: string };
  example: string;
  topic: string;
}> = [
  {
    headword: 'invoice',
    pos: 'n',
    ipa: '/ˈɪnvɔɪs/',
    meaning: { vi: 'hoá đơn', en: 'a bill for goods or services' },
    example: 'Please pay the invoice within 30 days.',
    topic: 'finance',
  },
  {
    headword: 'deadline',
    pos: 'n',
    ipa: '/ˈdedlaɪn/',
    meaning: { vi: 'hạn chót', en: 'the latest time by which something must be done' },
    example: 'The deadline for applications is Friday.',
    topic: 'office',
  },
  {
    headword: 'submit',
    pos: 'v',
    ipa: '/səbˈmɪt/',
    meaning: { vi: 'nộp, trình', en: 'to give a document to someone for a decision' },
    example: 'Submit your report by noon.',
    topic: 'office',
  },
  {
    headword: 'complimentary',
    pos: 'adj',
    ipa: '/ˌkɒmplɪˈmentəri/',
    meaning: { vi: 'miễn phí (tặng kèm)', en: 'given free as a courtesy' },
    example: 'Breakfast is complimentary for all guests.',
    topic: 'travel',
  },
  {
    headword: 'quarterly',
    pos: 'adj',
    ipa: '/ˈkwɔːtəli/',
    meaning: { vi: 'hằng quý', en: 'happening every three months' },
    example: 'We publish a quarterly newsletter.',
    topic: 'business',
  },
  {
    headword: 'shipment',
    pos: 'n',
    ipa: '/ˈʃɪpmənt/',
    meaning: { vi: 'lô hàng', en: 'a quantity of goods sent together' },
    example: 'The shipment arrived on time.',
    topic: 'logistics',
  },
  {
    headword: 'warehouse',
    pos: 'n',
    ipa: '/ˈweəhaʊs/',
    meaning: { vi: 'nhà kho', en: 'a large building for storing goods' },
    example: 'The warehouse is located near the port.',
    topic: 'logistics',
  },
  {
    headword: 'eligible',
    pos: 'adj',
    ipa: '/ˈelɪdʒəbl/',
    meaning: { vi: 'đủ điều kiện', en: 'having the right to do or obtain something' },
    example: 'Only full-time staff are eligible for the bonus.',
    topic: 'hr',
  },
  {
    headword: 'recruit',
    pos: 'v',
    ipa: '/rɪˈkruːt/',
    meaning: { vi: 'tuyển dụng', en: 'to find new people to join a company' },
    example: 'We plan to recruit ten engineers this year.',
    topic: 'hr',
  },
  {
    headword: 'budget',
    pos: 'n',
    ipa: '/ˈbʌdʒɪt/',
    meaning: { vi: 'ngân sách', en: 'the amount of money available for a purpose' },
    example: 'The project is under budget.',
    topic: 'finance',
  },
  {
    headword: 'agenda',
    pos: 'n',
    ipa: '/əˈdʒendə/',
    meaning: { vi: 'chương trình họp', en: 'a list of items to be discussed at a meeting' },
    example: 'The agenda was sent out yesterday.',
    topic: 'office',
  },
  {
    headword: 'postpone',
    pos: 'v',
    ipa: '/pəˈspəʊn/',
    meaning: { vi: 'hoãn lại', en: 'to arrange for something to take place later' },
    example: 'The meeting was postponed until Monday.',
    topic: 'office',
  },
  {
    headword: 'refund',
    pos: 'n',
    ipa: '/ˈriːfʌnd/',
    meaning: { vi: 'tiền hoàn lại', en: 'money paid back' },
    example: 'You can request a full refund within 14 days.',
    topic: 'shopping',
  },
  {
    headword: 'discount',
    pos: 'n',
    ipa: '/ˈdɪskaʊnt/',
    meaning: { vi: 'giảm giá', en: 'a reduction in the usual price' },
    example: 'Members get a 10% discount.',
    topic: 'shopping',
  },
  {
    headword: 'estimate',
    pos: 'n',
    ipa: '/ˈestɪmət/',
    meaning: { vi: 'bản ước tính, báo giá', en: 'an approximate calculation of cost' },
    example: 'The contractor sent an estimate for the repairs.',
    topic: 'business',
  },
  {
    headword: 'itinerary',
    pos: 'n',
    ipa: '/aɪˈtɪnərəri/',
    meaning: { vi: 'lịch trình chuyến đi', en: 'a planned route or journey' },
    example: 'Your itinerary includes two nights in Da Nang.',
    topic: 'travel',
  },
  {
    headword: 'merger',
    pos: 'n',
    ipa: '/ˈmɜːdʒə/',
    meaning: { vi: 'sáp nhập', en: 'the joining of two companies' },
    example: 'The merger was announced in June.',
    topic: 'business',
  },
  {
    headword: 'maintenance',
    pos: 'n',
    ipa: '/ˈmeɪntənəns/',
    meaning: { vi: 'bảo trì', en: 'the work of keeping something in good condition' },
    example: 'The elevator is closed for maintenance.',
    topic: 'office',
  },
  {
    headword: 'inventory',
    pos: 'n',
    ipa: '/ˈɪnvəntri/',
    meaning: { vi: 'hàng tồn kho', en: 'the goods a company has in stock' },
    example: 'We check inventory every month.',
    topic: 'logistics',
  },
  {
    headword: 'reimburse',
    pos: 'v',
    ipa: '/ˌriːɪmˈbɜːs/',
    meaning: { vi: 'hoàn trả chi phí', en: 'to pay back money someone has spent' },
    example: 'The company will reimburse your travel expenses.',
    topic: 'finance',
  },
];

export const DEMO_LESSON = {
  code: 'toeic-part5-tenses-intro',
  title: { vi: 'Part 5: Nhận diện thì qua dấu hiệu thời gian', en: 'Part 5: Spotting tenses from time markers' },
  summary: {
    vi: 'Ba bước đọc dấu hiệu thời gian để chọn thì đúng trong 10 giây.',
    en: 'A three-step routine to pick the right tense in 10 seconds.',
  },
  estMinutes: 12,
  steps: [
    {
      type: 'text',
      content: {
        vi: '## Bước 1 – Tìm mốc thời gian\nCác từ như *yesterday, last week, next Monday, by the time, since 2019* quyết định thì của động từ.',
        en: '## Step 1 – Find the time marker\nWords such as *yesterday, last week, next Monday, by the time, since 2019* decide the tense.',
      },
    },
    {
      type: 'text',
      content: {
        vi: '## Bước 2 – Ghép dấu hiệu với thì\n- next/tomorrow → tương lai\n- by the time + hiện tại → tương lai hoàn thành\n- since/for + hiện tại hoàn thành',
        en: '## Step 2 – Map marker → tense\n- next/tomorrow → future\n- by the time + present → future perfect\n- since/for → present perfect',
      },
    },
    { type: 'practice', content: { question_keys: ['p5-01', 'p5-07', 'p5-09'] } },
    {
      type: 'text',
      content: {
        vi: '## Bước 3 – Kiểm tra chủ ngữ\nSau khi chọn thì, kiểm tra số ít/số nhiều và thể bị động.',
        en: '## Step 3 – Check the subject\nAfter choosing the tense, check agreement and passive voice.',
      },
    },
  ],
};
