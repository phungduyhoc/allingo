import type { ProgramCode } from '../common.js';
import type { AnswerInput } from './answer.js';
import { QUESTION_TYPE_CODES, questionContentSchema, type QuestionContent, type QuestionContentInput, type QuestionTypeCode } from './content.js';

/**
 * Fixture tự biên soạn (source = 'human') cho 12 dạng câu – dùng trong test, seed demo, CMS preview.
 * Nội dung ngắn, bối cảnh văn phòng/đời sống; KHÔNG sao chép đề thi thật (CLAUDE.md §10).
 *
 * `expected` là điểm (0–1) mà grade() phải trả cho từng câu trả lời; null với dạng chấm thủ công.
 */
export interface QuestionFixture {
  /** Mã duy nhất `<type>-<nn>` */
  id: string;
  program: ProgramCode;
  content: QuestionContent;
  /** Câu trả lời đạt (is_correct = true với dạng tự chấm) */
  correct_answer: AnswerInput;
  /** Câu trả lời không đạt */
  wrong_answer: AnswerInput;
  /** Câu trả lời đúng một phần (0 < score < 1) – chỉ với dạng hỗ trợ partial */
  partial_answer?: AnswerInput;
  expected: { correct: number | null; wrong: number | null; partial?: number };
}

type RawFixture = Omit<QuestionFixture, 'id' | 'content'> & { content: QuestionContentInput };

/** UUID giả ổn định cho asset/recording trong fixture */
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const RAW: Record<QuestionTypeCode, RawFixture[]> = {
  // -------------------------------------------------------------------------
  mcq_single: [
    {
      program: 'toeic',
      content: {
        type: 'mcq_single',
        stem: 'The marketing team ______ the new campaign proposal to the board next Monday.',
        options: [
          { key: 'A', text: 'presents' },
          { key: 'B', text: 'will present' },
          { key: 'C', text: 'presented' },
          { key: 'D', text: 'has presented' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: 'Có mốc thời gian tương lai "next Monday" → thì tương lai đơn.', en: 'Future time marker "next Monday" → simple future.' },
        evidence: 'next Monday',
        tags: ['grammar:tense', 'part5'],
      },
      correct_answer: { type: 'mcq_single', selected: 'B' },
      wrong_answer: { type: 'mcq_single', selected: 'A' },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'toeic',
      content: {
        type: 'mcq_single',
        stem: 'Where will the workshop most likely take place?',
        media: { audio_asset_id: U(11), listen_policy: 'once' },
        options: [
          { key: 'A', text: 'In the main conference room' },
          { key: 'B', text: 'At a nearby hotel' },
          { key: 'C', text: 'In the staff cafeteria' },
          { key: 'D', text: 'On the rooftop terrace' },
        ],
        answer_key: { correct: 'A' },
        evidence: "We've booked the main conference room for Thursday's workshop.",
        tags: ['part3', 'listening:detail'],
      },
      correct_answer: { type: 'mcq_single', selected: 'A' },
      wrong_answer: { type: 'mcq_single', selected: null },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'jlpt',
      content: {
        type: 'mcq_single',
        stem: '会議は　三時（　　）始まります。',
        options: [
          { key: '1', text: 'に' },
          { key: '2', text: 'で' },
          { key: '3', text: 'を' },
          { key: '4', text: 'と' },
        ],
        answer_key: { correct: '1' },
        explanation: { vi: 'Mốc thời gian cụ thể dùng trợ từ に.', ja: '時刻には「に」を使います。' },
        tags: ['n5', 'grammar:particle'],
      },
      correct_answer: { type: 'mcq_single', selected: '1' },
      wrong_answer: { type: 'mcq_single', selected: '2' },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  mcq_multi: [
    {
      program: 'ielts',
      content: {
        type: 'mcq_multi',
        stem: 'Which TWO benefits of the new scheduling tool are mentioned in the memo?',
        options: [
          { key: 'A', text: 'Lower cost' },
          { key: 'B', text: 'Automatic reminders' },
          { key: 'C', text: 'Mobile access' },
          { key: 'D', text: 'Free training' },
        ],
        answer_key: { correct: ['B', 'C'], scoring: 'partial' },
        tags: [],
      },
      correct_answer: { type: 'mcq_multi', selected: ['B', 'C'] },
      wrong_answer: { type: 'mcq_multi', selected: ['A', 'D'] },
      partial_answer: { type: 'mcq_multi', selected: ['B'] },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'mcq_multi',
        stem: 'Which TWO facilities will be closed during the renovation?',
        options: [
          { key: 'A', text: 'The gym' },
          { key: 'B', text: 'The library' },
          { key: 'C', text: 'The car park' },
          { key: 'D', text: 'The café' },
          { key: 'E', text: 'The reception desk' },
        ],
        answer_key: { correct: ['A', 'D'], scoring: 'all_or_nothing' },
        tags: ['listening:section2'],
      },
      correct_answer: { type: 'mcq_multi', selected: ['D', 'A'] },
      wrong_answer: { type: 'mcq_multi', selected: ['A', 'B'] },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'toeic',
      content: {
        type: 'mcq_multi',
        stem: 'According to the notice, which THREE items must employees bring to the safety training?',
        options: [
          { key: 'A', text: 'Photo ID' },
          { key: 'B', text: 'Safety boots' },
          { key: 'C', text: 'Laptop' },
          { key: 'D', text: 'Signed consent form' },
          { key: 'E', text: 'Parking permit' },
        ],
        answer_key: { correct: ['A', 'B', 'D'], scoring: 'partial', penalize_extra: false },
        tags: ['part7'],
      },
      correct_answer: { type: 'mcq_multi', selected: ['A', 'B', 'D'] },
      wrong_answer: { type: 'mcq_multi', selected: ['C', 'E'] },
      // 2 đúng + 1 thừa, không trừ điểm thừa → 2/3
      partial_answer: { type: 'mcq_multi', selected: ['A', 'B', 'C'] },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
  ],

  // -------------------------------------------------------------------------
  fill_blank: [
    {
      program: 'toeic',
      content: {
        type: 'fill_blank',
        stem: 'The warehouse is open from {{b1}} a.m. to {{b2}} p.m. on weekdays.',
        blanks: [
          { id: 'b1', accepted: ['8', 'eight', '8:00'], case_sensitive: false },
          { id: 'b2', accepted: ['6', 'six', '6:00'], case_sensitive: false, max_words: 1 },
        ],
        answer_key: { ordered: true },
        tags: ['listening:detail'],
      },
      correct_answer: { type: 'fill_blank', blanks: { b1: ' Eight ', b2: '6' } },
      wrong_answer: { type: 'fill_blank', blanks: { b1: '9', b2: '5' } },
      partial_answer: { type: 'fill_blank', blanks: { b1: '8' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'fill_blank',
        stem: 'Complete the notes. Write NO MORE THAN TWO WORDS.\nMeeting point: {{b1}}\nCost of ticket: £{{b2}}\nBring: {{b3}}',
        blanks: [
          { id: 'b1', accepted: ['main entrance', 'the main entrance'], max_words: 3 },
          // ignore_punctuation: "12.50" = "12,50" = "12 50" (không đặt max_words vì dấu câu được thay bằng khoảng trắng)
          { id: 'b2', accepted: ['12.50', '12,50'], ignore_punctuation: true },
          { id: 'b3', accepted: ['packed lunch', 'a packed lunch'], max_words: 3 },
        ],
        answer_key: { ordered: true, scoring: 'partial' },
        tags: ['listening:section1'],
      },
      correct_answer: { type: 'fill_blank', blanks: { b1: 'Main   Entrance', b2: '12.50', b3: 'packed lunch' } },
      wrong_answer: { type: 'fill_blank', blanks: { b1: 'car park', b2: '15', b3: 'umbrella' } },
      partial_answer: { type: 'fill_blank', blanks: { b1: 'main entrance', b2: '12.50', b3: 'a big packed lunch' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      program: 'hsk',
      content: {
        type: 'fill_blank',
        stem: '请填写量词：一{{b1}}书，两{{b2}}人。',
        blanks: [
          { id: 'b1', accepted: ['本'], case_sensitive: true },
          { id: 'b2', accepted: ['个', '位'], case_sensitive: true },
        ],
        answer_key: { ordered: true, scoring: 'all_or_nothing' },
        tags: ['hsk2', 'grammar:measure_word'],
      },
      correct_answer: { type: 'fill_blank', blanks: { b1: '本', b2: '位' } },
      wrong_answer: { type: 'fill_blank', blanks: { b1: '个', b2: '本' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  matching: [
    {
      program: 'toeic',
      content: {
        type: 'matching',
        stem: 'Match each department with its main responsibility.',
        left: [
          { key: 'L1', text: 'Human Resources' },
          { key: 'L2', text: 'Accounting' },
          { key: 'L3', text: 'Logistics' },
        ],
        right: [
          { key: 'R1', text: 'Processing invoices' },
          { key: 'R2', text: 'Recruiting staff' },
          { key: 'R3', text: 'Shipping orders' },
        ],
        allow_reuse: false,
        answer_key: { pairs: { L1: 'R2', L2: 'R1', L3: 'R3' } },
        tags: [],
      },
      correct_answer: { type: 'matching', pairs: { L1: 'R2', L2: 'R1', L3: 'R3' } },
      wrong_answer: { type: 'matching', pairs: { L1: 'R1', L2: 'R2', L3: 'R2' } },
      partial_answer: { type: 'matching', pairs: { L1: 'R2', L2: 'R3' } },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching',
        stem: 'Match each paragraph (A–D) with the correct heading. Headings may be used more than once.',
        left: [
          { key: 'A', text: 'Paragraph A' },
          { key: 'B', text: 'Paragraph B' },
          { key: 'C', text: 'Paragraph C' },
          { key: 'D', text: 'Paragraph D' },
        ],
        right: [
          { key: 'i', text: 'Causes of the problem' },
          { key: 'ii', text: 'Possible solutions' },
          { key: 'iii', text: 'Historical background' },
        ],
        allow_reuse: true,
        answer_key: { pairs: { A: 'iii', B: 'i', C: 'ii', D: 'ii' } },
        tags: ['reading:headings'],
      },
      correct_answer: { type: 'matching', pairs: { A: 'iii', B: 'i', C: 'ii', D: 'ii' } },
      wrong_answer: { type: 'matching', pairs: { A: 'i', B: 'ii', C: 'iii', D: 'i' } },
      partial_answer: { type: 'matching', pairs: { A: 'iii', B: 'i', C: 'i', D: 'ii' } },
      expected: { correct: 1, wrong: 0, partial: 0.75 },
    },
    {
      program: 'jlpt',
      content: {
        type: 'matching',
        stem: '言葉と意味を結びなさい。',
        left: [
          { key: 'k1', text: '会議' },
          { key: 'k2', text: '休憩' },
        ],
        right: [
          { key: 'm1', text: 'nghỉ giải lao' },
          { key: 'm2', text: 'cuộc họp' },
        ],
        allow_reuse: false,
        answer_key: { pairs: { k1: 'm2', k2: 'm1' }, scoring: 'all_or_nothing' },
        tags: ['n4', 'vocab'],
      },
      correct_answer: { type: 'matching', pairs: { k1: 'm2', k2: 'm1' } },
      wrong_answer: { type: 'matching', pairs: { k1: 'm1', k2: 'm2' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  drag_drop: [
    {
      program: 'toeic',
      content: {
        type: 'drag_drop',
        stem: 'Drag each word into the correct gap.',
        items: [
          { key: 'i1', text: 'deadline' },
          { key: 'i2', text: 'budget' },
          { key: 'i3', text: 'agenda' },
        ],
        slots: [
          { key: 's1', label: 'Please send the meeting ___ before Friday.' },
          { key: 's2', label: 'We cannot exceed the approved ___.' },
        ],
        answer_key: { placements: { s1: 'i3', s2: 'i2' } },
        tags: [],
      },
      correct_answer: { type: 'drag_drop', placements: { s1: 'i3', s2: 'i2' } },
      wrong_answer: { type: 'drag_drop', placements: { s1: 'i1', s2: 'i1' } },
      partial_answer: { type: 'drag_drop', placements: { s1: 'i3', s2: 'i1' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'drag_drop',
        stem: 'Complete the flow chart of the recycling process using the words in the box.',
        items: [
          { key: 'sort', text: 'sorting' },
          { key: 'wash', text: 'washing' },
          { key: 'melt', text: 'melting' },
          { key: 'mould', text: 'moulding' },
          { key: 'pack', text: 'packaging' },
        ],
        slots: [
          { key: 'st1', label: 'Step 1: collection → ___' },
          { key: 'st2', label: 'Step 2: ___ to remove labels' },
          { key: 'st3', label: 'Step 3: ___ into pellets' },
          { key: 'st4', label: 'Step 4: ___ new bottles' },
        ],
        answer_key: { placements: { st1: 'sort', st2: 'wash', st3: 'melt', st4: 'mould' }, scoring: 'partial' },
        tags: ['reading:flowchart'],
      },
      correct_answer: { type: 'drag_drop', placements: { st1: 'sort', st2: 'wash', st3: 'melt', st4: 'mould' } },
      wrong_answer: { type: 'drag_drop', placements: { st1: 'pack', st2: 'melt', st3: 'wash', st4: 'sort' } },
      partial_answer: { type: 'drag_drop', placements: { st1: 'sort', st2: 'wash', st3: 'mould', st4: 'melt' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'hsk',
      content: {
        type: 'drag_drop',
        stem: '把词语拖到正确的位置，组成句子。',
        items: [
          { key: 'w1', text: '我' },
          { key: 'w2', text: '每天' },
          { key: 'w3', text: '坐地铁' },
          { key: 'w4', text: '上班' },
        ],
        slots: [
          { key: 'p1', label: '___' },
          { key: 'p2', label: '___' },
          { key: 'p3', label: '___' },
          { key: 'p4', label: '___' },
        ],
        answer_key: { placements: { p1: 'w1', p2: 'w2', p3: 'w3', p4: 'w4' }, scoring: 'all_or_nothing' },
        tags: ['hsk3', 'grammar:word_order'],
      },
      correct_answer: { type: 'drag_drop', placements: { p1: 'w1', p2: 'w2', p3: 'w3', p4: 'w4' } },
      wrong_answer: { type: 'drag_drop', placements: { p1: 'w2', p2: 'w1', p3: 'w4', p4: 'w3' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  map_label: [
    {
      program: 'ielts',
      content: {
        type: 'map_label',
        stem: 'Label the office floor plan.',
        image_asset_id: U(1),
        labels: [
          { key: 'A', text: 'Reception' },
          { key: 'B', text: 'Meeting room' },
          { key: 'C', text: 'Kitchen' },
        ],
        positions: [
          { key: 'p1', x: 10, y: 20 },
          { key: 'p2', x: 70, y: 20 },
          { key: 'p3', x: 40, y: 80 },
        ],
        answer_key: { positions: { p1: 'A', p2: 'B', p3: 'C' } },
        tags: [],
      },
      correct_answer: { type: 'map_label', positions: { p1: 'A', p2: 'B', p3: 'C' } },
      wrong_answer: { type: 'map_label', positions: { p1: 'C', p2: 'A', p3: 'B' } },
      partial_answer: { type: 'map_label', positions: { p1: 'A' } },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      program: 'ielts',
      content: {
        type: 'map_label',
        stem: 'Label the map of the community centre. Choose the correct letter for each place.',
        image_asset_id: U(12),
        labels: [
          { key: 'cafe', text: 'Café' },
          { key: 'pool', text: 'Swimming pool' },
          { key: 'hall', text: 'Main hall' },
          { key: 'park', text: 'Car park' },
        ],
        positions: [
          { key: 'q1', x: 15, y: 15 },
          { key: 'q2', x: 85, y: 15 },
          { key: 'q3', x: 50, y: 50 },
          { key: 'q4', x: 50, y: 90 },
        ],
        answer_key: { positions: { q1: 'park', q2: 'cafe', q3: 'hall', q4: 'pool' }, scoring: 'partial' },
        tags: ['listening:map'],
      },
      correct_answer: { type: 'map_label', positions: { q1: 'park', q2: 'cafe', q3: 'hall', q4: 'pool' } },
      wrong_answer: { type: 'map_label', positions: { q1: 'cafe', q2: 'park', q3: 'pool', q4: 'hall' } },
      partial_answer: { type: 'map_label', positions: { q1: 'park', q2: 'cafe', q3: 'pool', q4: 'hall' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'toeic',
      content: {
        type: 'map_label',
        stem: 'Look at the seating chart. Where is each person sitting?',
        image_asset_id: U(13),
        labels: [
          { key: 'mgr', text: 'Manager' },
          { key: 'guest', text: 'Guest speaker' },
        ],
        positions: [
          { key: 'seat1', x: 20, y: 50 },
          { key: 'seat2', x: 80, y: 50 },
        ],
        answer_key: { positions: { seat1: 'guest', seat2: 'mgr' }, scoring: 'all_or_nothing' },
        tags: ['part3', 'graphic'],
      },
      correct_answer: { type: 'map_label', positions: { seat1: 'guest', seat2: 'mgr' } },
      wrong_answer: { type: 'map_label', positions: { seat1: 'mgr', seat2: 'guest' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  tfng: [
    {
      program: 'ielts',
      content: {
        type: 'tfng',
        stem: 'Do the following statements agree with the information in the passage?',
        variant: 'tfng',
        statements: [
          { key: 's1', text: 'The company was founded in 1998.' },
          { key: 's2', text: 'All employees work remotely.' },
          { key: 's3', text: 'The founder studied engineering.' },
        ],
        answer_key: { values: { s1: 'true', s2: 'false', s3: 'not_given' } },
        tags: [],
      },
      correct_answer: { type: 'tfng', values: { s1: 'true', s2: 'false', s3: 'not_given' } },
      wrong_answer: { type: 'tfng', values: { s1: 'false', s2: 'true', s3: 'true' } },
      partial_answer: { type: 'tfng', values: { s1: 'true', s2: 'true', s3: 'not_given' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      program: 'ielts',
      content: {
        type: 'tfng',
        stem: "Do the following statements agree with the writer's views?",
        variant: 'ynng',
        statements: [
          { key: 'y1', text: 'Open-plan offices improve collaboration.' },
          { key: 'y2', text: 'Noise is the main complaint of staff.' },
          { key: 'y3', text: 'Companies should offer quiet rooms.' },
          { key: 'y4', text: 'Remote work will replace offices entirely.' },
        ],
        answer_key: { values: { y1: 'false', y2: 'true', y3: 'true', y4: 'not_given' }, scoring: 'partial' },
        tags: ['reading:ynng'],
      },
      correct_answer: { type: 'tfng', values: { y1: 'false', y2: 'true', y3: 'true', y4: 'not_given' } },
      wrong_answer: { type: 'tfng', values: { y1: 'true', y2: 'false', y3: 'not_given', y4: 'true' } },
      partial_answer: { type: 'tfng', values: { y1: 'false', y2: 'true', y3: 'not_given' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'toeic',
      content: {
        type: 'tfng',
        stem: 'Based on the e-mail, decide whether each statement is true or false.',
        variant: 'tfng',
        statements: [
          { key: 't1', text: 'The invoice is due within 30 days.' },
          { key: 't2', text: 'Late payments incur a 2% fee.' },
        ],
        answer_key: { values: { t1: 'true', t2: 'false' }, scoring: 'all_or_nothing' },
        tags: ['part7'],
      },
      correct_answer: { type: 'tfng', values: { t1: 'true', t2: 'false' } },
      wrong_answer: { type: 'tfng', values: { t1: 'true', t2: 'true' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  ordering: [
    {
      program: 'toeic',
      content: {
        type: 'ordering',
        stem: 'Put the steps of the refund process in the correct order.',
        items: [
          { key: 'a', text: 'Submit the refund form' },
          { key: 'b', text: 'Receive a confirmation email' },
          { key: 'c', text: 'Return the item to the store' },
          { key: 'd', text: 'Get the money back' },
        ],
        answer_key: { order: ['c', 'a', 'b', 'd'], scoring: 'adjacent_pairs' },
        tags: [],
      },
      correct_answer: { type: 'ordering', order: ['c', 'a', 'b', 'd'] },
      wrong_answer: { type: 'ordering', order: ['d', 'b', 'a', 'c'] },
      // cặp kề đúng: (c,a) → 1/3
      partial_answer: { type: 'ordering', order: ['c', 'a', 'd', 'b'] },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      program: 'ielts',
      content: {
        type: 'ordering',
        stem: 'Arrange the sentences to form a coherent paragraph about preparing for an interview.',
        items: [
          { key: 's1', text: 'First, research the company thoroughly.' },
          { key: 's2', text: 'Next, prepare answers to common questions.' },
          { key: 's3', text: 'Then, choose appropriate clothing the night before.' },
          { key: 's4', text: 'Finally, arrive ten minutes early.' },
        ],
        answer_key: { order: ['s1', 's2', 's3', 's4'], scoring: 'partial' },
        tags: ['writing:coherence'],
      },
      correct_answer: { type: 'ordering', order: ['s1', 's2', 's3', 's4'] },
      wrong_answer: { type: 'ordering', order: ['s4', 's3', 's2', 's1'] },
      // s1, s4 đúng vị trí → 2/4
      partial_answer: { type: 'ordering', order: ['s1', 's3', 's2', 's4'] },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'jlpt',
      content: {
        type: 'ordering',
        stem: '正しい順番に並べなさい：「わたしは　＿＿　＿＿　＿＿　食べました。」',
        items: [
          { key: 'j1', text: '友だちと' },
          { key: 'j2', text: '駅の近くで' },
          { key: 'j3', text: '昼ごはんを' },
        ],
        answer_key: { order: ['j1', 'j2', 'j3'], scoring: 'exact' },
        tags: ['n5', 'grammar:word_order'],
      },
      correct_answer: { type: 'ordering', order: ['j1', 'j2', 'j3'] },
      wrong_answer: { type: 'ordering', order: ['j3', 'j1', 'j2'] },
      expected: { correct: 1, wrong: 0 },
    },
  ],

  // -------------------------------------------------------------------------
  dictation: [
    {
      program: 'toeic',
      content: {
        type: 'dictation',
        stem: 'Listen and type what you hear.',
        media: { audio_asset_id: U(2), listen_policy: 'free' },
        answer_key: { text: 'The shipment will arrive on Thursday morning.', max_edit_distance_per_token: 1, ignore_punctuation: true, pass_ratio: 0.9 },
        tags: [],
      },
      correct_answer: { type: 'dictation', text: 'the shipment will arive on thursday morning' },
      wrong_answer: { type: 'dictation', text: 'a package comes tomorrow' },
      partial_answer: { type: 'dictation', text: 'The shipment will arrive' },
      expected: { correct: 1, wrong: 0, partial: 0.571 },
    },
    {
      program: 'ielts',
      content: {
        type: 'dictation',
        stem: 'Listen to the announcement and write down the sentence.',
        media: { audio_asset_id: U(21), listen_policy: 'once', pause_ms: 8000 },
        answer_key: { text: 'Please keep your receipt until the end of the month.', max_edit_distance_per_token: 0, ignore_punctuation: true, pass_ratio: 1 },
        tags: ['listening:dictation'],
      },
      correct_answer: { type: 'dictation', text: 'please keep your receipt until the end of the month' },
      wrong_answer: { type: 'dictation', text: 'please keep your recipt untill the end of the month' },
      // wrong: 2 lỗi chính tả với tolerance 0 → 8/10 token, không đạt ngưỡng 1.0; partial: 7/10 token
      partial_answer: { type: 'dictation', text: 'Please keep your receipt until the end' },
      expected: { correct: 1, wrong: 0.8, partial: 0.7 },
    },
    {
      program: 'hsk',
      content: {
        type: 'dictation',
        stem: '听录音，写出你听到的句子（拼音）。',
        media: { audio_asset_id: U(22), listen_policy: 'free' },
        answer_key: { text: 'wo mingtian qu gongsi kaihui', max_edit_distance_per_token: 1, ignore_punctuation: true, pass_ratio: 0.75 },
        tags: ['hsk2', 'listening'],
      },
      correct_answer: { type: 'dictation', text: 'wo mingtian qu gongsi kaihui' },
      wrong_answer: { type: 'dictation', text: 'ta zuotian lai xuexiao' },
      // 4/5 token đúng ≥ 0.75 → vẫn đạt, nhưng score < 1
      partial_answer: { type: 'dictation', text: 'wo mingtian qu gongsi' },
      expected: { correct: 1, wrong: 0, partial: 0.8 },
    },
  ],

  // -------------------------------------------------------------------------
  essay: [
    {
      program: 'ielts',
      content: {
        type: 'essay',
        stem: 'Some people think companies should allow employees to work from home. Discuss both views and give your opinion.',
        task_type: 'ielts_task2',
        word_limit: { min: 250 },
        time_limit_sec: 2400,
        rubric_code: 'grade_writing_ielts',
        answer_key: {},
        tags: [],
      },
      correct_answer: { type: 'essay', text: 'Working from home has become common...' },
      wrong_answer: { type: 'essay', text: '' },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'toeic',
      content: {
        type: 'essay',
        stem: 'Write ONE sentence based on the picture using the two words given: "deliver" / "package".',
        task_type: 'toeic_w_q1_5',
        word_limit: { min: 5, max: 40 },
        time_limit_sec: 480,
        rubric_code: 'grade_writing_toeic',
        image_asset_id: U(31),
        answer_key: { model_answer: 'A courier is delivering a package to the front desk.', notes: 'Phải dùng cả hai từ, một câu đúng ngữ pháp.' },
        tags: ['writing:q1_5'],
      },
      correct_answer: { type: 'essay', text: 'The man is delivering a large package to the office.' },
      wrong_answer: { type: 'essay', text: 'Package.' },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'toeic',
      content: {
        type: 'essay',
        stem: 'Respond to the e-mail from your colleague asking to reschedule the team meeting. Suggest TWO alternative times.',
        task_type: 'toeic_w_q6_7',
        word_limit: { min: 60, max: 200 },
        time_limit_sec: 600,
        rubric_code: 'grade_writing_toeic',
        answer_key: {},
        tags: ['writing:email'],
      },
      correct_answer: { type: 'essay', text: 'Hi Minh, thanks for letting me know. Would Tuesday at 10 a.m. or Wednesday at 2 p.m. work for you? ...' },
      wrong_answer: { type: 'essay', text: 'ok' },
      expected: { correct: null, wrong: null },
    },
  ],

  // -------------------------------------------------------------------------
  speaking: [
    {
      program: 'ielts',
      content: {
        type: 'speaking',
        stem: 'Describe a product you bought recently that you were happy with.',
        task_type: 'ielts_part2',
        prep_seconds: 60,
        response_seconds: 120,
        rubric_code: 'grade_speaking_ielts',
        cue_points: ['what it was', 'where you bought it', 'why you were happy with it'],
        answer_key: {},
        tags: [],
      },
      correct_answer: { type: 'speaking', recording_id: U(3) },
      wrong_answer: { type: 'speaking', recording_id: '00000000-0000-0000-0000-000000000000' },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'toeic',
      content: {
        type: 'speaking',
        stem: 'Read the following announcement aloud: "Attention shoppers, the store will close in fifteen minutes. Please bring your purchases to the checkout."',
        task_type: 'toeic_s_q1_2',
        prep_seconds: 45,
        response_seconds: 45,
        rubric_code: 'grade_speaking_toeic',
        answer_key: { notes: 'Chấm phát âm, ngữ điệu, trọng âm.' },
        tags: ['speaking:read_aloud'],
      },
      correct_answer: { type: 'speaking', recording_id: U(32) },
      wrong_answer: { type: 'speaking', recording_id: '00000000-0000-0000-0000-000000000000' },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'ielts',
      content: {
        type: 'speaking',
        stem: 'Do you prefer to work in a team or on your own? Why?',
        task_type: 'ielts_part1',
        prep_seconds: 0,
        response_seconds: 30,
        rubric_code: 'grade_speaking_ielts',
        cue_points: [],
        answer_key: {},
        tags: ['speaking:part1'],
      },
      correct_answer: { type: 'speaking', recording_id: U(33) },
      wrong_answer: { type: 'speaking', recording_id: '00000000-0000-0000-0000-000000000000' },
      expected: { correct: null, wrong: null },
    },
  ],

  // -------------------------------------------------------------------------
  handwriting: [
    {
      program: 'hsk',
      content: {
        type: 'handwriting',
        stem: 'Write the character for "book".',
        target: '书',
        script: 'hanzi',
        reading: 'shū',
        meaning: { vi: 'sách', en: 'book' },
        answer_key: { stroke_count: 4 },
        tags: [],
      },
      correct_answer: {
        type: 'handwriting',
        strokes: [
          [
            [0.1, 0.1],
            [0.9, 0.1],
          ],
          [
            [0.5, 0.1],
            [0.5, 0.9],
          ],
        ],
      },
      wrong_answer: { type: 'handwriting', strokes: [] },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'jlpt',
      content: {
        type: 'handwriting',
        stem: '「やま」を漢字で書きなさい。',
        target: '山',
        script: 'kanji',
        reading: 'やま',
        meaning: { vi: 'núi', en: 'mountain', ja: 'やま' },
        answer_key: { stroke_count: 3 },
        tags: ['n5', 'kanji'],
      },
      correct_answer: {
        type: 'handwriting',
        strokes: [
          [
            [0.5, 0.1],
            [0.5, 0.8],
          ],
          [
            [0.1, 0.3],
            [0.1, 0.8],
            [0.9, 0.8],
          ],
          [
            [0.9, 0.3],
            [0.9, 0.8],
          ],
        ],
        image_key: 'handwriting/demo/yama.png',
      },
      wrong_answer: {
        type: 'handwriting',
        strokes: [
          [
            [0.1, 0.5],
            [0.9, 0.5],
          ],
        ],
      },
      expected: { correct: null, wrong: null },
    },
    {
      program: 'hsk',
      content: {
        type: 'handwriting',
        stem: '请写出"公司"两个字。',
        target: '公司',
        script: 'hanzi',
        reading: 'gōngsī',
        meaning: { vi: 'công ty', en: 'company' },
        answer_key: {},
        tags: ['hsk1', 'hanzi'],
      },
      correct_answer: {
        type: 'handwriting',
        strokes: [
          [
            [0.2, 0.2],
            [0.1, 0.4],
          ],
          [
            [0.3, 0.2],
            [0.4, 0.4],
          ],
          [
            [0.6, 0.2],
            [0.9, 0.2],
            [0.9, 0.8],
          ],
        ],
      },
      wrong_answer: { type: 'handwriting', strokes: [] },
      expected: { correct: null, wrong: null },
    },
  ],
};

/** Toàn bộ fixture, đã parse qua questionContentSchema (default được áp), ≥ 3 fixture/dạng */
export const QUESTION_FIXTURES_ALL: Record<QuestionTypeCode, QuestionFixture[]> = Object.fromEntries(
  QUESTION_TYPE_CODES.map((type) => [
    type,
    RAW[type].map((f, i) => ({ ...f, id: `${type}-${String(i + 1).padStart(2, '0')}`, content: questionContentSchema.parse(f.content) })),
  ]),
) as Record<QuestionTypeCode, QuestionFixture[]>;

/** Một fixture đại diện mỗi dạng (fixture đầu tiên) – dùng cho CMS "Chèn mẫu" và test nhanh */
export const QUESTION_FIXTURES: Record<QuestionTypeCode, QuestionFixture> = Object.fromEntries(
  QUESTION_TYPE_CODES.map((type) => [type, QUESTION_FIXTURES_ALL[type][0]!]),
) as Record<QuestionTypeCode, QuestionFixture>;

/** Danh sách phẳng mọi fixture (36+) */
export const QUESTION_FIXTURE_LIST: readonly QuestionFixture[] = QUESTION_TYPE_CODES.flatMap((type) => QUESTION_FIXTURES_ALL[type]);
