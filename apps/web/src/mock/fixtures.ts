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
  /** `transcript`: transcript audio của câu (Part 1/2 – như media_assets.transcript), chỉ trả trong Review/feedback */
  media: { id: string; kind: string; url: string; duration_ms: number | null; transcript?: MockTranscript }[];
  /** Part 3/4: passage `audio_script` – `body` là transcript (ẩn khi đang làm bài), `segments` mốc thời gian để tô sáng */
  passage: { id: string; kind: string; title: string | null; body: string | null; media_url: string | null; media_asset_id?: string; segments?: MockSegment[] } | null;
  /** % cộng đồng đúng (giả lập) */
  community_correct_rate: number;
}

export interface MockTestSet extends Omit<TestSetSummary, 'last_score' | 'best_score' | 'attempts_count'> {
  sections: { code: string; skill: string; name: { vi: string; en: string }; duration_sec: number | null; question_count: number }[];
  questions: MockQuestion[];
}

export interface MockSegment {
  start_ms: number;
  end_ms: number;
  speaker: string;
  text: string;
}
export interface MockTranscript {
  text: string;
  segments?: MockSegment[];
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

/** Câu trắc nghiệm có đoạn văn (Part 6–7) – đánh số câu theo đề mini Reading bên dưới */
const passageMcq = (
  n: number,
  section: 'part5' | 'part6' | 'part7',
  passage: MockQuestion['passage'],
  groupKey: string | null,
  stem: string,
  options: [string, string, string, string],
  correct: 'A' | 'B' | 'C' | 'D',
  explanation: { vi: string; en: string },
  tags: string[],
  rate: number,
): MockQuestion => ({
  question_id: uid(400 + n, 'aaaa'),
  question_version_id: uid(400 + n, 'bbbb'),
  section_code: section,
  group_key: groupKey,
  order_no: n,
  content: {
    type: 'mcq_single',
    stem,
    options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
    answer_key: { correct },
    explanation,
    tags,
  },
  media: [],
  passage,
  community_correct_rate: rate,
});

const P6_PASSAGE = {
  id: uid(2, 'eeee'),
  kind: 'email',
  title: 'E-mail: Office move',
  body: `To: All staff
From: Daniel Huynh, Office Manager
Subject: Office move

Dear colleagues,

Our team will move to the fourth floor of the Harbor Building on Monday, 2 June. Please pack your personal items [4] Friday afternoon so that the movers can begin work on time.

Boxes and labels are available in the supply room. [5], please write your name and new desk number on each box.

The IT department will reconnect all computers over the weekend. [6] If your equipment is not working on Monday morning, contact the help desk immediately.

Thank you for your [7] during this busy week.

Daniel Huynh`,
  media_url: null,
};

const P7_PASSAGE = {
  id: uid(3, 'eeee'),
  kind: 'double',
  title: 'Notice + E-mail',
  body: `[Notice]
Riverside Community Library – Summer Hours

From 1 July to 31 August, the library will open at 9:00 A.M. and close at 6:00 P.M. on weekdays. On Saturdays, the library will close at 1:00 P.M. The library will be closed on Sundays during the summer.

[E-mail]
From: Mai Linh Tran
To: Riverside Community Library
Date: 3 July
Subject: Study room booking

Hello,

I would like to book a study room for a group of five students on Saturday, 12 July, from 11:00 A.M. to 3:00 P.M. Could you let me know whether a room is available?

Thank you,
Mai Linh Tran`,
  media_url: null,
};

/** Đề mini Reading 3 Part (5–6–7) để thử thanh Part, đoạn văn chia đôi màn hình, nhóm câu chung đoạn văn (Sprint 3) */
export const READING_MINI: MockTestSet = {
  id: uid(5, 'cccc'),
  code: 'toeic-reading-mini-01',
  title: { vi: 'TOEIC Reading mini · 3 phần (P5–P7)', en: 'TOEIC Reading mini · three Parts (P5–P7)' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 600,
  question_count: 10,
  sections: [
    { code: 'part5', skill: 'reading', name: { vi: 'Part 5 · Hoàn thành câu', en: 'Part 5 · Incomplete Sentences' }, duration_sec: 120, question_count: 3 },
    { code: 'part6', skill: 'reading', name: { vi: 'Part 6 · Hoàn thành đoạn', en: 'Part 6 · Text Completion' }, duration_sec: 180, question_count: 4 },
    { code: 'part7', skill: 'reading', name: { vi: 'Part 7 · Đọc hiểu', en: 'Part 7 · Reading Comprehension' }, duration_sec: 300, question_count: 3 },
  ],
  questions: [
    passageMcq(1, 'part5', null, null, 'The quarterly report ______ to all department heads before the meeting on Friday.', ['was distributed', 'distributing', 'distribute', 'to distribute'], 'A', { vi: 'Báo cáo "được phân phát" → bị động quá khứ "was distributed".', en: 'The report receives the action → past passive "was distributed".' }, ['grammar:verb-form'], 62),
    passageMcq(2, 'part5', null, null, 'Ms. Okafor asked the supplier to send the samples ______ possible.', ['as soon as', 'so that', 'even if', 'in case'], 'A', { vi: 'Cụm cố định "as soon as possible" = càng sớm càng tốt.', en: 'Fixed phrase "as soon as possible".' }, ['grammar:conjunction'], 80),
    passageMcq(3, 'part5', null, null, 'Our new branch office is conveniently located ______ the central train station.', ['near', 'among', 'onto', 'during'], 'A', { vi: '"located near" = nằm gần; "among" cần danh từ số nhiều.', en: '"located near" = close to; "among" needs a plural noun.' }, ['grammar:preposition'], 77),
    passageMcq(4, 'part6', P6_PASSAGE, 'mock-p6-office-move', 'Choose the best option for blank [4].', ['by', 'until', 'since', 'within'], 'A', { vi: '"by + mốc thời gian" = chậm nhất vào lúc đó.', en: '"by + time" = no later than that time.' }, ['grammar:preposition'], 58),
    passageMcq(5, 'part6', P6_PASSAGE, 'mock-p6-office-move', 'Choose the best option for blank [5].', ['In addition', 'However', 'Otherwise', 'For instance'], 'A', { vi: 'Bổ sung thêm một yêu cầu → "In addition".', en: 'Adds a further instruction → "In addition".' }, ['grammar:connector'], 51),
    passageMcq(6, 'part6', P6_PASSAGE, 'mock-p6-office-move', 'Choose the sentence that best fits blank [6].', ['No action is required from you during this process.', 'The fourth floor was renovated last year.', 'Please return your laptop to the supply room.', 'The movers will arrive on Thursday.'], 'A', { vi: 'Câu trước nói IT tự kết nối lại máy → nhân viên không cần làm gì.', en: 'IT reconnects everything → staff need not do anything.' }, ['reading:inference'], 43),
    passageMcq(7, 'part6', P6_PASSAGE, 'mock-p6-office-move', 'Choose the best option for blank [7].', ['cooperation', 'cooperate', 'cooperative', 'cooperatively'], 'A', { vi: 'Sau tính từ sở hữu "your" cần danh từ → "cooperation".', en: 'A noun is needed after "your" → "cooperation".' }, ['grammar:word-form'], 69),
    passageMcq(8, 'part7', P7_PASSAGE, 'mock-p7-library', 'What is the purpose of the notice?', ['To announce temporary opening hours', 'To advertise a new study room', 'To request volunteers', 'To explain a membership fee'], 'A', { vi: 'Thông báo nêu giờ mở cửa mùa hè (1/7–31/8).', en: 'The notice gives summer opening hours (1 July–31 August).' }, ['reading:main-idea'], 84),
    passageMcq(9, 'part7', P7_PASSAGE, 'mock-p7-library', 'Why will Ms. Tran most likely need to change her booking?', ['The library closes before 3:00 P.M. on Saturdays.', 'Study rooms hold only four people.', 'The library is closed in July.', 'She asked for a Sunday.'], 'A', { vi: 'Thứ Bảy thư viện đóng cửa lúc 1:00 chiều, cô ấy đặt tới 3:00 chiều (kết hợp hai văn bản).', en: 'On Saturdays the library closes at 1:00 P.M. but she booked until 3:00 P.M. (combine both texts).' }, ['reading:inference'], 47),
    passageMcq(10, 'part7', P7_PASSAGE, 'mock-p7-library', 'What is indicated about the library?', ['It is closed on Sundays in the summer.', 'It opens at 8:00 A.M. on weekdays.', 'It offers free laptops.', 'It moved to a new building.'], 'A', { vi: 'Câu cuối của thông báo: đóng cửa Chủ nhật trong mùa hè.', en: 'Last sentence of the notice: closed on Sundays during the summer.' }, ['reading:detail'], 73),
  ],
};


// ----------------------------------------------------------------------------- Listening Part 1–4 (Sprint 4)
// Nội dung tự biên soạn; audio là tệp WAV im lặng ngắn trong public/demo-audio/listening (đủ để chạy chuỗi phát/E2E).

const seg = (start_ms: number, end_ms: number, speaker: string, text: string): MockSegment => ({ start_ms, end_ms, speaker, text });
const transcriptOf = (segments: MockSegment[]): MockTranscript => ({ text: segments.map((x) => x.text).join(' '), segments });
const LA = (n: number) => uid(500 + n, 'dddd');
const audioUrl = (file: string) => `/demo-audio/listening/${file}.wav`;

type Opt4 = [string, string, string, string];

const p1 = (n: number, image: string, options: Opt4, correct: 'A' | 'B' | 'C' | 'D', explanation: { vi: string; en: string }, rate: number): MockQuestion => ({
  question_id: uid(500 + n, 'aaaa'),
  question_version_id: uid(500 + n, 'bbbb'),
  section_code: 'part1',
  group_key: null,
  order_no: n,
  content: {
    type: 'mcq_single',
    stem: '',
    options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
    media: { audio_asset_id: LA(n), image_asset_id: LA(20 + n), listen_policy: 'once', pause_ms: 1000 },
    answer_key: { correct },
    explanation,
    evidence: options[correct.charCodeAt(0) - 65],
    tags: ['listening:photo'],
  },
  media: [
    {
      id: LA(n),
      kind: 'audio',
      url: audioUrl(`p1-0${n}`),
      duration_ms: 2000,
      transcript: transcriptOf([
        seg(0, 400, 'N', `Number ${n}.`),
        seg(400, 800, 'M1', `(A) ${options[0]}`),
        seg(800, 1200, 'M1', `(B) ${options[1]}`),
        seg(1200, 1600, 'M1', `(C) ${options[2]}`),
        seg(1600, 2000, 'M1', `(D) ${options[3]}`),
      ]),
    },
    { id: LA(20 + n), kind: 'image', url: `/demo-images/${image}.svg`, duration_ms: null },
  ],
  passage: null,
  community_correct_rate: rate,
});

const p2l = (n: number, prompt: string, options: [string, string, string], correct: 'A' | 'B' | 'C', explanation: { vi: string; en: string }, rate: number): MockQuestion => ({
  question_id: uid(500 + n, 'aaaa'),
  question_version_id: uid(500 + n, 'bbbb'),
  section_code: 'part2',
  group_key: null,
  order_no: n,
  content: {
    type: 'mcq_single',
    stem: prompt,
    options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
    media: { audio_asset_id: LA(n), listen_policy: 'once', pause_ms: 1000 },
    answer_key: { correct },
    explanation,
    evidence: options[correct.charCodeAt(0) - 65],
    tags: ['listening:wh'],
  },
  media: [
    {
      id: LA(n),
      kind: 'audio',
      url: audioUrl(`p2-0${n}`),
      duration_ms: 2000,
      transcript: transcriptOf([seg(0, 300, 'N', `Number ${n}.`), seg(300, 900, 'W1', prompt), seg(900, 1300, 'M1', `(A) ${options[0]}`), seg(1300, 1650, 'M1', `(B) ${options[1]}`), seg(1650, 2000, 'M1', `(C) ${options[2]}`)]),
    },
  ],
  passage: null,
  community_correct_rate: rate,
});

const P3_SEGMENTS = [
  seg(0, 900, 'N', 'Questions 5 through 7 refer to the following conversation.'),
  seg(900, 2600, 'W', "Hi Tom, I'm organizing the client lunch on Thursday. Have you booked a room yet?"),
  seg(2600, 4400, 'M', 'Not yet. The large conference room is taken, but Room 4 is free from noon.'),
  seg(4400, 6000, 'W', 'Room 4 is fine. Could you also order sandwiches for eight people?'),
  seg(6000, 7800, 'M', "Sure. I'll call the café downstairs this afternoon."),
];
const P4_SEGMENTS = [
  seg(0, 1000, 'N', 'Questions 8 through 10 refer to the following announcement and schedule.'),
  seg(1000, 3000, 'W', 'Good morning, shoppers, and welcome to Greenway Market.'),
  seg(3000, 4800, 'W', 'This weekend only, all fresh fruit is twenty percent off.'),
  seg(4800, 6400, 'W', 'Our cooking demonstration has moved from the front entrance to the bakery corner.'),
  seg(6400, 7900, 'W', 'Please also note that the store will close early on Sunday for inventory.'),
];
const scriptOf = (segments: MockSegment[]) => segments.map((x) => (x.speaker === 'N' ? x.text : `${x.speaker}: ${x.text}`)).join('\n');

const P3_PASSAGE: NonNullable<MockQuestion['passage']> = { id: uid(501, 'eeee'), kind: 'audio_script', title: 'Conversation 1', body: scriptOf(P3_SEGMENTS), media_url: audioUrl('p3-c01'), media_asset_id: LA(40), segments: P3_SEGMENTS };
const P4_PASSAGE: NonNullable<MockQuestion['passage']> = { id: uid(502, 'eeee'), kind: 'audio_script', title: 'Talk 1 – Announcement', body: scriptOf(P4_SEGMENTS), media_url: audioUrl('p4-t01'), media_asset_id: LA(41), segments: P4_SEGMENTS };

const groupQ = (n: number, section: 'part3' | 'part4', passage: NonNullable<MockQuestion['passage']>, stem: string, options: Opt4, correct: 'A' | 'B' | 'C' | 'D', evidence: string, explanation: { vi: string; en: string }, tag: string, rate: number): MockQuestion => ({
  question_id: uid(500 + n, 'aaaa'),
  question_version_id: uid(500 + n, 'bbbb'),
  section_code: section,
  group_key: passage.id,
  order_no: n,
  content: {
    type: 'mcq_single',
    stem,
    options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
    media: { audio_asset_id: LA(n), listen_policy: 'once', pause_ms: 1500 },
    answer_key: { correct },
    explanation,
    evidence,
    tags: [tag],
  },
  media: [{ id: LA(n), kind: 'audio', url: audioUrl(`q${String(n).padStart(2, '0')}`), duration_ms: 1000 }],
  passage,
  community_correct_rate: rate,
});

const LISTENING_QUESTIONS: MockQuestion[] = [
  p1(1, 'p1-01', ['The man is typing on a laptop.', 'The man is closing a window.', 'The man is carrying a chair.', 'The man is drinking from a cup.'], 'A', { vi: 'Tranh: người đàn ông đang gõ máy tính xách tay.', en: 'The picture shows a man typing on a laptop.' }, 72),
  p1(2, 'p1-02', ['The women are sitting at a table.', 'One of the women is painting a wall.', 'The women are standing near a bookshelf.', 'The women are opening a door.'], 'C', { vi: 'Hai người phụ nữ đứng cạnh kệ sách.', en: 'Two women are standing next to a bookshelf.' }, 64),
  p2l(3, 'When does the training session start?', ['In the main hall.', 'At nine thirty tomorrow.', 'Yes, I trained there.'], 'B', { vi: 'Hỏi "When" → trả lời bằng thời gian.', en: '"When" question → answer with a time.' }, 68),
  p2l(4, 'Could you send me the updated schedule?', ["Sure, I'll e-mail it right away.", 'It was updated last week.', 'A new schedule board.'], 'A', { vi: 'Lời đề nghị → đồng ý thực hiện.', en: 'A request → agreeing to do it.' }, 61),
  groupQ(5, 'part3', P3_PASSAGE, 'What are the speakers mainly discussing?', ['A client lunch', 'A job interview', 'A product launch', 'A training course'], 'A', "I'm organizing the client lunch on Thursday", { vi: 'Câu đầu của người phụ nữ nêu chủ đề: bữa trưa với khách hàng.', en: "The woman's first line states the topic: a client lunch." }, 'listening:gist', 70),
  groupQ(6, 'part3', P3_PASSAGE, "Why can't they use the large conference room?", ['It is being cleaned.', 'It is already booked.', 'It is too small.', 'It has no projector.'], 'B', 'The large conference room is taken', { vi: '"is taken" = đã có người đặt.', en: '"is taken" = already booked.' }, 'listening:detail', 55),
  groupQ(7, 'part3', P3_PASSAGE, 'What will the man do this afternoon?', ['Send an invitation', 'Call a café', 'Move some chairs', 'Meet a client'], 'B', "I'll call the café downstairs this afternoon.", { vi: 'Người đàn ông sẽ gọi quán cà phê dưới tầng.', en: 'The man will call the café downstairs.' }, 'listening:detail', 63),
  groupQ(8, 'part4', P4_PASSAGE, 'Where is the announcement being made?', ['At a supermarket', 'At a bank', 'At an airport', 'At a library'], 'A', 'welcome to Greenway Market', { vi: '"shoppers", "Greenway Market" → siêu thị.', en: '"shoppers", "Greenway Market" → a supermarket.' }, 'listening:gist', 78),
  groupQ(9, 'part4', P4_PASSAGE, 'What has changed about the cooking demonstration?', ['Its time', 'Its location', 'Its price', 'Its host'], 'B', 'has moved from the front entrance to the bakery corner', { vi: 'Buổi trình diễn chuyển chỗ → địa điểm thay đổi.', en: 'The demonstration moved → its location changed.' }, 'listening:detail', 59),
  groupQ(
    10,
    'part4',
    P4_PASSAGE,
    'Look at the graphic. What time will the store close on Sunday?\n\n**Greenway Market – Weekend Hours**\n\n| Day | Opens | Closes |\n| --- | --- | --- |\n| Friday | 8:00 | 21:00 |\n| Saturday | 8:00 | 21:00 |\n| Sunday | 9:00 | 17:00 |',
    ['21:00', '17:00', '9:00', '8:00'],
    'B',
    'the store will close early on Sunday',
    { vi: 'Chủ nhật đóng cửa sớm → bảng: 17:00.', en: 'Closing early on Sunday → the table shows 17:00.' },
    'listening:graphic',
    41,
  ),
];

const LISTENING_SECTIONS: MockTestSet['sections'] = [
  { code: 'part1', skill: 'listening', name: { vi: 'Part 1 · Mô tả tranh', en: 'Part 1 · Photographs' }, duration_sec: null, question_count: 2 },
  { code: 'part2', skill: 'listening', name: { vi: 'Part 2 · Hỏi – đáp', en: 'Part 2 · Question–Response' }, duration_sec: null, question_count: 2 },
  { code: 'part3', skill: 'listening', name: { vi: 'Part 3 · Hội thoại', en: 'Part 3 · Conversations' }, duration_sec: null, question_count: 3 },
  { code: 'part4', skill: 'listening', name: { vi: 'Part 4 · Bài nói', en: 'Part 4 · Talks' }, duration_sec: null, question_count: 3 },
];

/** Đề mini Listening Part 1–4 (10 câu): ảnh Part 1, chữ Part 1/2 chỉ có trong Review, nhóm hội thoại/bài nói, graphic dạng bảng */
export const LISTENING_MINI: MockTestSet = {
  id: uid(6, 'cccc'),
  code: 'toeic-listening-mini-01',
  title: { vi: 'TOEIC Listening mini · Part 1–4 (10 câu)', en: 'TOEIC Listening mini · Parts 1–4 (10 questions)' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 600,
  question_count: 10,
  sections: LISTENING_SECTIONS,
  questions: LISTENING_QUESTIONS,
};

/** Đề mini L&R (20 câu = Listening mini + Reading mini): hết Listening tự chuyển sang Reading, điểm L/R/Tổng */
export const LR_MINI: MockTestSet = {
  id: uid(7, 'cccc'),
  code: 'toeic-lr-mini-01',
  title: { vi: 'TOEIC L&R mini · Nghe + Đọc (20 câu)', en: 'TOEIC L&R mini · Listening + Reading (20 questions)' },
  kind: 'mini',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: 1200,
  question_count: 20,
  sections: [...LISTENING_SECTIONS, ...READING_MINI.sections],
  questions: [...LISTENING_QUESTIONS, ...READING_MINI.questions.map((q) => ({ ...q, order_no: q.order_no + LISTENING_QUESTIONS.length }))],
};

export const MOCK_TEST_SETS: MockTestSet[] = [PART5_MINI, PART2_MINI, MIXED_DRILL, FULL_TEST_LOCKED, READING_MINI, LISTENING_MINI, LR_MINI];

/** Ánh xạ tag fixture → mã kỹ năng con của seed core (catalog.subskills) để chẩn đoán mock dùng nhãn i18n thật */
export const MOCK_SUBSKILL_OF_TAG: Record<string, string> = {
  'grammar:tense': 'verb_tense',
  'grammar:verb-form': 'verb_tense',
  'grammar:preposition': 'preposition',
  'grammar:word-form': 'word_form',
  'grammar:conjunction': 'conjunction',
  'grammar:connector': 'conjunction',
  'grammar:pronoun': 'pronoun',
  'vocab:collocation': 'vocabulary_context',
  'reading:main-idea': 'paraphrase_recognition',
  'reading:detail': 'detail',
  'reading:inference': 'inference',
  'listening:part2': 'wh_question',
  'listening:wh': 'wh_question',
  'listening:photo': 'listening_detail',
  'listening:detail': 'listening_detail',
  'listening:gist': 'listening_gist',
  'listening:graphic': 'listening_detail',
};

export const MOCK_PROGRAMS = [
  { code: 'toeic', name: { vi: 'TOEIC', en: 'TOEIC' }, score_scale: { min: 10, max: 990, step: 5 }, languages: ['en'] },
  { code: 'ielts', name: { vi: 'IELTS', en: 'IELTS' }, score_scale: { min: 0, max: 9, step: 0.5 }, languages: ['en'] },
  { code: 'jlpt', name: { vi: 'JLPT', en: 'JLPT' }, score_scale: { min: 0, max: 180, step: 1 }, languages: ['ja'] },
  { code: 'hsk', name: { vi: 'HSK', en: 'HSK' }, score_scale: { min: 0, max: 300, step: 1 }, languages: ['zh'] },
];
