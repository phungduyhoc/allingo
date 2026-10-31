import type { AnswerInput } from './answer.js';
import type { QuestionContent, QuestionTypeCode } from './content.js';

/**
 * Fixture tự biên soạn (source = 'human') cho 12 dạng câu – dùng trong test, seed demo, CMS preview.
 * Không sao chép đề thi thật.
 */
export interface QuestionFixture {
  content: QuestionContent;
  correct: AnswerInput;
  wrong: AnswerInput;
  partial?: AnswerInput;
}

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const QUESTION_FIXTURES: Record<QuestionTypeCode, QuestionFixture> = {
  mcq_single: {
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
    correct: { type: 'mcq_single', selected: 'B' },
    wrong: { type: 'mcq_single', selected: 'A' },
  },
  mcq_multi: {
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
    correct: { type: 'mcq_multi', selected: ['B', 'C'] },
    wrong: { type: 'mcq_multi', selected: ['A', 'D'] },
    partial: { type: 'mcq_multi', selected: ['B'] },
  },
  fill_blank: {
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
    correct: { type: 'fill_blank', blanks: { b1: ' Eight ', b2: '6' } },
    wrong: { type: 'fill_blank', blanks: { b1: '9', b2: '5' } },
    partial: { type: 'fill_blank', blanks: { b1: '8' } },
  },
  matching: {
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
    correct: { type: 'matching', pairs: { L1: 'R2', L2: 'R1', L3: 'R3' } },
    wrong: { type: 'matching', pairs: { L1: 'R1', L2: 'R2', L3: 'R2' } },
    partial: { type: 'matching', pairs: { L1: 'R2', L2: 'R3' } },
  },
  drag_drop: {
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
    correct: { type: 'drag_drop', placements: { s1: 'i3', s2: 'i2' } },
    wrong: { type: 'drag_drop', placements: { s1: 'i1', s2: 'i1' } },
    partial: { type: 'drag_drop', placements: { s1: 'i3', s2: 'i1' } },
  },
  map_label: {
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
    correct: { type: 'map_label', positions: { p1: 'A', p2: 'B', p3: 'C' } },
    wrong: { type: 'map_label', positions: { p1: 'C', p2: 'A', p3: 'B' } },
    partial: { type: 'map_label', positions: { p1: 'A' } },
  },
  tfng: {
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
    correct: { type: 'tfng', values: { s1: 'true', s2: 'false', s3: 'not_given' } },
    wrong: { type: 'tfng', values: { s1: 'false', s2: 'true', s3: 'true' } },
    partial: { type: 'tfng', values: { s1: 'true', s2: 'true', s3: 'not_given' } },
  },
  ordering: {
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
    correct: { type: 'ordering', order: ['c', 'a', 'b', 'd'] },
    wrong: { type: 'ordering', order: ['d', 'b', 'a', 'c'] },
    partial: { type: 'ordering', order: ['c', 'a', 'd', 'b'] },
  },
  dictation: {
    content: {
      type: 'dictation',
      stem: 'Listen and type what you hear.',
      media: { audio_asset_id: U(2), listen_policy: 'free' },
      answer_key: { text: 'The shipment will arrive on Thursday morning.', max_edit_distance_per_token: 1, ignore_punctuation: true, pass_ratio: 0.9 },
      tags: [],
    },
    correct: { type: 'dictation', text: 'the shipment will arive on thursday morning' },
    wrong: { type: 'dictation', text: 'a package comes tomorrow' },
    partial: { type: 'dictation', text: 'The shipment will arrive' },
  },
  essay: {
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
    correct: { type: 'essay', text: 'Working from home has become common...' },
    wrong: { type: 'essay', text: '' },
  },
  speaking: {
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
    correct: { type: 'speaking', recording_id: U(3) },
    wrong: { type: 'speaking', recording_id: '00000000-0000-0000-0000-000000000000' },
  },
  handwriting: {
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
    correct: {
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
    wrong: { type: 'handwriting', strokes: [] },
  },
};
