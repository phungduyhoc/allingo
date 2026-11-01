import type { QuestionContent, TestSetSummary } from '@allingo/schemas';

/**
 * Dữ liệu mẫu cho chế độ mock (NEXT_PUBLIC_API_MOCK=1). Nội dung câu hỏi tự biên soạn (source = 'human'),
 * không sao chép đề thi thật. Chỉ dùng cho dev/e2e – không bundle vào production.
 */

export interface MockQuestion {
  question_id: string;
  question_version_id: string;
  section_code: string;
  group_key: string | null;
  order_no: number;
  /** Nội dung đầy đủ (có answer_key) – mock sẽ lọc trước khi trả client */
  content: QuestionContent;
  media: { id: string; kind: string; url: string; duration_ms: number | null }[];
  passage: { id: string; kind: string; title: string | null; body: string | null; media_url: string | null } | null;
  /** % cộng đồng đúng (giả lập) */
  community_correct_rate: number;
}

export interface MockTestSet extends Omit<TestSetSummary, 'last_score' | 'best_score' | 'attempts_count'> {
  sections: { code: string; skill: string; name: { vi: string; en: string }; duration_sec: number | null; question_count: number }[];
  questions: MockQuestion[];
}

const uid = (n: number, prefix = '1111') => `${prefix}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const mcq = (
  n: number,
  stem: string,
  options: [string, string, string, string],
  correct: 'A' | 'B' | 'C' | 'D',
  explanation: { vi: string; en: string },
  tags: string[],
  rate: number,
): MockQuestion => ({
  question_id: uid(n, 'aaaa'),
  question_version_id: uid(n, 'bbbb'),
  section_code: 'part5',
  group_key: null,
  order_no: n,
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
    tags,
  },
  media: [],
  passage: null,
  community_correct_rate: rate,
});

export const PART5_MINI: MockTestSet = {
  id: uid(1, 'cccc'),
  code: 'toeic-p5-mini-01',
  title: { vi: 'TOEIC Part 5 mini · Đề 01', en: 'TOEIC Part 5 mini · Set 01' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 600,
  question_count: 10,
  sections: [{ code: 'part5', skill: 'reading', name: { vi: 'Part 5 · Hoàn thành câu', en: 'Part 5 · Incomplete Sentences' }, duration_sec: 600, question_count: 10 }],
  questions: [
    mcq(
      1,
      'The marketing team ______ the new campaign proposal to the board next Monday.',
      ['presents', 'will present', 'presented', 'has presented'],
      'B',
      { vi: 'Có mốc thời gian tương lai "next Monday" → thì tương lai đơn.', en: 'Future time marker "next Monday" → simple future.' },
      ['grammar:tense', 'part5'],
      78,
    ),
    mcq(
      2,
      'All visitors must sign in at the front desk ______ entering the laboratory.',
      ['before', 'during', 'until', 'among'],
      'A',
      { vi: 'Hành động ký tên xảy ra trước khi vào phòng thí nghiệm → "before" + V-ing.', en: 'Signing in happens prior to entering → "before" + V-ing.' },
      ['grammar:preposition', 'part5'],
      71,
    ),
    mcq(
      3,
      'Ms. Tran was praised for her ______ handling of the client complaint.',
      ['efficient', 'efficiently', 'efficiency', 'efficiencies'],
      'A',
      { vi: 'Cần tính từ bổ nghĩa cho danh từ "handling" → "efficient".', en: 'An adjective is needed to modify the noun "handling" → "efficient".' },
      ['grammar:word-form', 'part5'],
      64,
    ),
    mcq(
      4,
      'Employees who wish to attend the workshop should register ______ the end of the week.',
      ['by', 'on', 'at', 'in'],
      'A',
      { vi: '"by + mốc thời gian" = không muộn hơn thời điểm đó.', en: '"by + time" means no later than that point.' },
      ['grammar:preposition', 'part5'],
      59,
    ),
    mcq(
      5,
      'Neither the invoice ______ the delivery note listed the correct quantity.',
      ['or', 'nor', 'and', 'but'],
      'B',
      { vi: 'Cặp liên từ tương quan "neither … nor".', en: 'Correlative conjunction "neither … nor".' },
      ['grammar:conjunction', 'part5'],
      82,
    ),
    mcq(
      6,
      'The renovation of the lobby is expected to ______ approximately three weeks.',
      ['take', 'spend', 'last for', 'make'],
      'A',
      { vi: '"take + khoảng thời gian" với chủ ngữ là sự việc; "spend" cần chủ ngữ là người.', en: '"take + duration" with an event as subject; "spend" needs a person as subject.' },
      ['vocab:collocation', 'part5'],
      55,
    ),
    mcq(
      7,
      '______ the heavy rain, the outdoor product launch went ahead as planned.',
      ['Because of', 'Despite', 'Although', 'Even'],
      'B',
      { vi: 'Sau chỗ trống là cụm danh từ → giới từ "Despite"; "Although" cần mệnh đề.', en: 'A noun phrase follows → preposition "Despite"; "Although" needs a clause.' },
      ['grammar:connector', 'part5'],
      67,
    ),
    mcq(
      8,
      'The committee will announce ______ decision once all applications have been reviewed.',
      ['it', 'its', "it's", 'itself'],
      'B',
      { vi: 'Cần tính từ sở hữu trước danh từ "decision" → "its".', en: 'A possessive adjective before "decision" → "its".' },
      ['grammar:pronoun', 'part5'],
      74,
    ),
    mcq(
      9,
      'Customers can ______ a full refund within 30 days of purchase.',
      ['request', 'requesting', 'requested', 'requests'],
      'A',
      { vi: 'Sau động từ khuyết thiếu "can" dùng động từ nguyên mẫu.', en: 'After the modal "can", use the base form of the verb.' },
      ['grammar:verb-form', 'part5'],
      86,
    ),
    mcq(
      10,
      'The new software update is ______ compatible with older versions of the operating system.',
      ['fully', 'full', 'fullness', 'fuller'],
      'A',
      { vi: 'Cần trạng từ bổ nghĩa cho tính từ "compatible" → "fully".', en: 'An adverb modifying the adjective "compatible" → "fully".' },
      ['grammar:word-form', 'part5'],
      69,
    ),
  ],
};

const p2 = (n: number, correct: 'A' | 'B' | 'C', explanation: { vi: string; en: string }, rate: number): MockQuestion => ({
  question_id: uid(100 + n, 'aaaa'),
  question_version_id: uid(100 + n, 'bbbb'),
  section_code: 'part2',
  group_key: null,
  order_no: n,
  content: {
    type: 'mcq_single',
    stem: '',
    options: [
      { key: 'A', text: '' },
      { key: 'B', text: '' },
      { key: 'C', text: '' },
    ],
    media: { listen_policy: 'once', pause_ms: 5000 },
    answer_key: { correct },
    explanation,
    tags: ['listening:part2'],
  },
  media: [{ id: uid(200 + n, 'dddd'), kind: 'audio', url: `/demo-audio/p2-${String(n).padStart(2, '0')}.wav`, duration_ms: 3000 }],
  passage: null,
  community_correct_rate: rate,
});

export const PART2_MINI: MockTestSet = {
  id: uid(2, 'cccc'),
  code: 'toeic-p2-mini-01',
  title: { vi: 'TOEIC Part 2 mini · Nghe 6 câu', en: 'TOEIC Part 2 mini · 6 questions' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 360,
  question_count: 6,
  sections: [{ code: 'part2', skill: 'listening', name: { vi: 'Part 2 · Hỏi – đáp', en: 'Part 2 · Question–Response' }, duration_sec: 360, question_count: 6 }],
  questions: [
    p2(1, 'B', { vi: 'Câu hỏi "Where" → chọn câu trả lời chỉ địa điểm.', en: '"Where" question → choose the answer giving a place.' }, 70),
    p2(2, 'A', { vi: 'Câu hỏi Yes/No về lịch họp → câu trả lời xác nhận thời gian.', en: 'Yes/No question about a meeting → the answer confirming the time.' }, 66),
    p2(3, 'C', { vi: 'Câu hỏi "Who" → câu trả lời nêu người phụ trách.', en: '"Who" question → the answer naming a person.' }, 61),
    p2(4, 'A', { vi: 'Câu đề nghị "Would you like…?" → chấp nhận hoặc từ chối lịch sự.', en: 'Offer "Would you like…?" → polite accept or decline.' }, 58),
    p2(5, 'B', { vi: 'Câu hỏi lựa chọn "or" → chọn một trong hai, không trả lời Yes/No.', en: '"Or" question → pick one option, not Yes/No.' }, 52),
    p2(6, 'C', { vi: 'Câu hỏi "How long" → câu trả lời chỉ khoảng thời gian.', en: '"How long" question → an answer with a duration.' }, 63),
  ],
};

const PASSAGE_ID = uid(1, 'eeee');
const PASSAGE_BODY = `To: All staff
From: Facilities Department
Subject: Parking lot resurfacing

The east parking lot will be closed from Monday, 12 May to Friday, 16 May for resurfacing. During this period, staff may park in the overflow lot behind Building C. Shuttle buses will run every fifteen minutes between the overflow lot and the main entrance from 7:30 a.m. to 6:30 p.m.

Please note that vehicles left in the east lot after 6:00 p.m. on Sunday, 11 May will be towed at the owner's expense. We apologise for the inconvenience and thank you for your cooperation.`;

export const MIXED_DRILL: MockTestSet = {
  id: uid(3, 'cccc'),
  code: 'toeic-drill-mixed-01',
  title: { vi: 'Luyện dạng câu · Demo đọc hiểu', en: 'Question-type drill · Reading demo' },
  kind: 'part_drill',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: null,
  question_count: 5,
  sections: [{ code: 'part7', skill: 'reading', name: { vi: 'Part 7 · Đọc hiểu', en: 'Part 7 · Reading Comprehension' }, duration_sec: null, question_count: 5 }],
  questions: [
    {
      question_id: uid(301, 'aaaa'),
      question_version_id: uid(301, 'bbbb'),
      section_code: 'part7',
      group_key: 'memo-parking',
      order_no: 1,
      content: {
        type: 'mcq_single',
        stem: 'What is the purpose of the memo?',
        options: [
          { key: 'A', text: 'To announce a new shuttle service for customers' },
          { key: 'B', text: 'To inform staff about a temporary parking closure' },
          { key: 'C', text: 'To request volunteers for a building project' },
          { key: 'D', text: 'To explain changes to working hours' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: 'Dòng chủ đề và câu đầu nói về việc đóng bãi đỗ xe phía đông để trải lại mặt đường.', en: 'The subject line and first sentence announce the east lot closure for resurfacing.' },
        tags: ['reading:main-idea'],
      },
      media: [],
      passage: { id: PASSAGE_ID, kind: 'memo', title: 'Memo: Parking lot resurfacing', body: PASSAGE_BODY, media_url: null },
      community_correct_rate: 81,
    },
    {
      question_id: uid(302, 'aaaa'),
      question_version_id: uid(302, 'bbbb'),
      section_code: 'part7',
      group_key: 'memo-parking',
      order_no: 2,
      content: {
        type: 'mcq_multi',
        stem: 'Which TWO services are mentioned for staff during the closure?',
        options: [
          { key: 'A', text: 'Parking in the overflow lot' },
          { key: 'B', text: 'Free taxi vouchers' },
          { key: 'C', text: 'A shuttle bus every fifteen minutes' },
          { key: 'D', text: 'Reserved spaces in Building C' },
        ],
        answer_key: { correct: ['A', 'C'], scoring: 'partial' },
        explanation: { vi: 'Đoạn 1 nêu bãi đỗ dự phòng sau Toà C và xe đưa đón 15 phút/chuyến.', en: 'Paragraph 1 mentions the overflow lot behind Building C and a shuttle every fifteen minutes.' },
        tags: ['reading:detail'],
      },
      media: [],
      passage: { id: PASSAGE_ID, kind: 'memo', title: 'Memo: Parking lot resurfacing', body: PASSAGE_BODY, media_url: null },
      community_correct_rate: 57,
    },
    {
      question_id: uid(303, 'aaaa'),
      question_version_id: uid(303, 'bbbb'),
      section_code: 'part7',
      group_key: 'memo-parking',
      order_no: 3,
      content: {
        type: 'fill_blank',
        stem: 'The shuttle runs from {{b1}} a.m. to {{b2}} p.m.',
        blanks: [
          { id: 'b1', accepted: ['7:30', '7.30', 'seven thirty'], case_sensitive: false, max_words: 2 },
          { id: 'b2', accepted: ['6:30', '6.30', 'six thirty'], case_sensitive: false, max_words: 2 },
        ],
        answer_key: { ordered: true },
        explanation: { vi: 'Thông tin giờ xe đưa đón ở cuối đoạn 1.', en: 'The shuttle hours are at the end of paragraph 1.' },
        tags: ['reading:detail'],
      },
      media: [],
      passage: { id: PASSAGE_ID, kind: 'memo', title: 'Memo: Parking lot resurfacing', body: PASSAGE_BODY, media_url: null },
      community_correct_rate: 49,
    },
    {
      question_id: uid(304, 'aaaa'),
      question_version_id: uid(304, 'bbbb'),
      section_code: 'part7',
      group_key: 'memo-parking',
      order_no: 4,
      content: {
        type: 'tfng',
        stem: 'Do the following statements agree with the information in the memo?',
        variant: 'tfng',
        statements: [
          { key: 's1', text: 'The closure lasts five working days.' },
          { key: 's2', text: 'Towing fees will be covered by the company.' },
          { key: 's3', text: 'The main entrance will also be closed.' },
        ],
        answer_key: { values: { s1: 'true', s2: 'false', s3: 'not_given' } },
        explanation: { vi: 'Thứ Hai–Thứ Sáu = 5 ngày (True); phí kéo xe do chủ xe chịu (False); không nhắc tới lối vào chính (Not Given).', en: 'Monday–Friday = five days (True); towing is at the owner\'s expense (False); the entrance is not mentioned (Not Given).' },
        tags: ['reading:inference'],
      },
      media: [],
      passage: { id: PASSAGE_ID, kind: 'memo', title: 'Memo: Parking lot resurfacing', body: PASSAGE_BODY, media_url: null },
      community_correct_rate: 44,
    },
    {
      question_id: uid(305, 'aaaa'),
      question_version_id: uid(305, 'bbbb'),
      section_code: 'part7',
      group_key: null,
      order_no: 5,
      content: {
        type: 'matching',
        stem: 'Match each department with its main responsibility.',
        left: [
          { key: 'L1', text: 'Facilities' },
          { key: 'L2', text: 'Accounting' },
        ],
        right: [
          { key: 'R1', text: 'Processing invoices' },
          { key: 'R2', text: 'Maintaining buildings' },
        ],
        allow_reuse: false,
        answer_key: { pairs: { L1: 'R2', L2: 'R1' } },
        tags: [],
      },
      media: [],
      passage: null,
      community_correct_rate: 90,
    },
  ],
};

export const FULL_TEST_LOCKED: MockTestSet = {
  id: uid(4, 'cccc'),
  code: 'toeic-full-01',
  title: { vi: 'TOEIC Full Test 01 · 200 câu', en: 'TOEIC Full Test 01 · 200 questions' },
  kind: 'full',
  level: null,
  is_free: false,
  locked: true,
  duration_sec: 7200,
  question_count: 200,
  sections: [],
  questions: [],
};

export const MOCK_TEST_SETS: MockTestSet[] = [PART5_MINI, PART2_MINI, MIXED_DRILL, FULL_TEST_LOCKED];

export const MOCK_PROGRAMS = [
  { code: 'toeic', name: { vi: 'TOEIC', en: 'TOEIC' }, score_scale: { min: 10, max: 990, step: 5 }, languages: ['en'] },
  { code: 'ielts', name: { vi: 'IELTS', en: 'IELTS' }, score_scale: { min: 0, max: 9, step: 0.5 }, languages: ['en'] },
  { code: 'jlpt', name: { vi: 'JLPT', en: 'JLPT' }, score_scale: { min: 0, max: 180, step: 1 }, languages: ['ja'] },
  { code: 'hsk', name: { vi: 'HSK', en: 'HSK' }, score_scale: { min: 0, max: 300, step: 1 }, languages: ['zh'] },
];
