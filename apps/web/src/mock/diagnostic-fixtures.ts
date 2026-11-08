import type { MockQuestion, MockTestSet } from './fixtures';

/**
 * Ngân hàng chẩn đoán giả lập (S9) – 23 câu TỰ BIÊN SOẠN (source = 'human'), hai mức mỗi Part (mức 1 = A2, mức 2 = B1/B2;
 * nhóm passage mức 2 khi có câu B2 – như `unitLevel` của @allingo/scoring). Audio/ảnh dùng lại tệp demo im lặng.
 * Blueprint mock: P1 2 · P2 2 · P3 1 nhóm (2 câu) · P5 5 · P7 1 nhóm (2 câu) = 13 câu (API thật ≈ 31).
 */

const uid = (n: number, prefix: string) => `${prefix}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const QID = (n: number) => uid(700 + n, 'aaaa');
const LA = (n: number) => uid(700 + n, 'dddd');
const audio = (file: string) => `/demo-audio/listening/${file}.wav`;

/** Mức CEFR của câu (catalog.questions.difficulty_target) – xác định mức đơn vị */
export const MOCK_DIAGNOSTIC_DIFFICULTY: Record<string, string> = {};

type Opt = [string, string, string, string];
let order = 0;

function q(n: number, section: string, difficulty: string, content: MockQuestion['content'], extra: Partial<MockQuestion> = {}): MockQuestion {
  order += 1;
  const id = QID(n);
  MOCK_DIAGNOSTIC_DIFFICULTY[id] = difficulty;
  return { question_id: id, question_version_id: uid(700 + n, 'bbbb'), section_code: section, group_key: null, order_no: order, content, media: [], passage: null, community_correct_rate: 60, ...extra };
}

const mcq = (stem: string, options: string[], correct: string, tags: string[], explanation: { vi: string; en: string }) =>
  ({ type: 'mcq_single', stem, options: options.map((text, i) => ({ key: String.fromCharCode(65 + i), text })), answer_key: { correct }, explanation, tags }) as MockQuestion['content'];

const p1 = (n: number, difficulty: string, image: string, file: string, options: Opt, correct: string) =>
  q(n, 'part1', difficulty, { ...mcq('', options, correct, ['listening:photo'], { vi: 'Câu mô tả khớp với hành động chính trong tranh.', en: 'The statement matches the main action in the picture.' }), media: { audio_asset_id: LA(n), image_asset_id: LA(n + 50), listen_policy: 'once', pause_ms: 1000 } }, {
    media: [
      { id: LA(n), kind: 'audio', url: audio(file), duration_ms: 2000 },
      { id: LA(n + 50), kind: 'image', url: `/demo-images/${image}.svg`, duration_ms: null },
    ],
  });

const p2 = (n: number, difficulty: string, file: string, prompt: string, options: [string, string, string], correct: string) =>
  q(n, 'part2', difficulty, { ...mcq(prompt, options, correct, ['listening:wh'], { vi: 'Lời đáp trả lời đúng trọng tâm câu hỏi.', en: 'The response answers the question directly.' }), media: { audio_asset_id: LA(n), listen_policy: 'once', pause_ms: 1000 } }, {
    media: [{ id: LA(n), kind: 'audio', url: audio(file), duration_ms: 2000 }],
  });

const P3_A = { id: uid(781, 'eeee'), kind: 'audio_script', title: 'Conversation A', body: 'W: Could you send me the updated price list before noon?\nM: Sure, I just need the sales figures from Lena.', media_url: audio('p3-c01'), media_asset_id: LA(81) };
const P3_B = { id: uid(782, 'eeee'), kind: 'audio_script', title: 'Conversation B', body: 'M: The vendor postponed the installation because a component was back-ordered.\nW: Then we should notify the branch managers and reschedule the training.', media_url: audio('p3-c01'), media_asset_id: LA(82) };
const P7_A = {
  id: uid(783, 'eeee'),
  kind: 'notice',
  title: 'Notice: Staff cafeteria hours',
  body: 'Starting Monday, the staff cafeteria will open at 7:30 A.M. instead of 8:00 A.M.\nBreakfast will be served until 10:00 A.M. Lunch service is unchanged.',
  media_url: null,
};
const P7_B = {
  id: uid(784, 'eeee'),
  kind: 'email',
  title: 'Email: Quarterly supplier review',
  body: 'Dear team,\nOur quarterly review of suppliers will take place on April 14. Please submit delivery-time reports by April 10 so that the procurement committee can compare performance across regions.\nVendors whose on-time rate falls below 90 percent will be asked to propose corrective measures.\nRegards, Dana Ito, Procurement',
  media_url: null,
};

const grp = (n: number, section: 'part3' | 'part7', difficulty: string, passage: MockQuestion['passage'] & object, stem: string, options: Opt, correct: string, tag: string, withAudio: boolean) =>
  q(n, section, difficulty, { ...mcq(stem, options, correct, [tag], { vi: 'Thông tin nằm trực tiếp trong đoạn.', en: 'The information is stated in the passage.' }), ...(withAudio ? { media: { audio_asset_id: LA(n), listen_policy: 'once', pause_ms: 1500 } } : {}) }, {
    group_key: passage.id,
    passage,
    media: withAudio ? [{ id: LA(n), kind: 'audio', url: audio(`q0${5 + (n % 5)}`), duration_ms: 1000 }] : [],
  });

const p5 = (n: number, difficulty: string, stem: string, options: Opt, correct: string, tag: string) => q(n, 'part5', difficulty, mcq(stem, options, correct, [tag], { vi: 'Dấu hiệu ngữ pháp quanh chỗ trống quyết định đáp án.', en: 'The grammar cue around the blank decides the answer.' }));

export const MOCK_DIAGNOSTIC_QUESTIONS: MockQuestion[] = [
  p1(1, 'A2', 'p1-01', 'p1-01', ['A man is typing on a laptop.', 'A man is closing a window.', 'Some chairs are stacked.', 'A woman is pouring coffee.'], 'A'),
  p1(2, 'A2', 'p1-02', 'p1-02', ['Boxes are being unloaded.', 'A door is being painted.', 'People are boarding a bus.', 'A cart is parked by a shelf.'], 'D'),
  p1(3, 'B1', 'p1-01', 'p1-01', ['The workstation has been cleared.', 'A screen is displaying a chart.', 'A cable is being repaired.', 'Documents are scattered on the floor.'], 'B'),
  p2(4, 'A2', 'p2-03', 'Where is the meeting room?', ['On the third floor.', 'At two o’clock.', 'Yes, I met him.'], 'A'),
  p2(5, 'A2', 'p2-04', 'When does the store open?', ['At the corner.', 'At nine tomorrow.', 'A new store.'], 'B'),
  p2(6, 'B1', 'p2-03', 'Haven’t the samples arrived yet?', ['They were delayed at customs.', 'I sampled the soup.', 'Yes, arrive early.'], 'A'),
  p2(7, 'B1', 'p2-04', 'Would you rather meet in person or by video?', ['A video camera.', 'Whichever suits your schedule.', 'Yes, I would.'], 'B'),
  grp(8, 'part3', 'A2', P3_A, 'What does the woman ask for?', ['A price list', 'A meeting room', 'A delivery date', 'A new laptop'], 'A', 'listening:detail', true),
  grp(9, 'part3', 'B1', P3_A, 'What does the man need first?', ['A signature', 'Sales figures', 'A password', 'A taxi'], 'B', 'listening:detail', true),
  grp(10, 'part3', 'B1', P3_B, 'Why was the installation postponed?', ['A part was unavailable.', 'The staff were on leave.', 'The budget was cut.', 'The room was booked.'], 'A', 'listening:gist', true),
  grp(11, 'part3', 'B2', P3_B, 'What will the speakers most likely do next?', ['Order lunch', 'Inform managers', 'Cancel the contract', 'Visit the vendor'], 'B', 'listening:detail', true),
  p5(12, 'A2', 'Ms. Tran ______ the report every Friday.', ['send', 'sends', 'sending', 'to send'], 'B', 'grammar:verb-form'),
  p5(13, 'A2', 'The office is closed ______ Sunday.', ['in', 'at', 'on', 'by'], 'C', 'grammar:preposition'),
  p5(14, 'A2', 'Please give ______ your contact number.', ['me', 'my', 'mine', 'I'], 'A', 'grammar:pronoun'),
  p5(15, 'A2', 'Our team worked ______ to finish the project.', ['hard', 'hardly', 'harden', 'hardness'], 'A', 'grammar:word-form'),
  p5(16, 'B1', 'The new policy will take effect ______ the board approves it.', ['once', 'despite', 'during', 'whereas'], 'A', 'grammar:conjunction'),
  p5(17, 'B1', 'Applicants must submit their forms no later ______ May 3.', ['by', 'than', 'until', 'from'], 'B', 'vocab:collocation'),
  p5(18, 'B1', 'By the time the shipment arrives, we ______ the warehouse.', ['clean', 'will have cleaned', 'cleaning', 'have been cleaned'], 'B', 'grammar:tense'),
  p5(19, 'B2', 'The manager praised the staff for their ______ handling of the complaint.', ['diplomat', 'diplomatic', 'diplomatically', 'diplomacy'], 'B', 'grammar:word-form'),
  grp(20, 'part7', 'A2', P7_A, 'What is changing?', ['The opening time', 'The lunch menu', 'The cafeteria location', 'The prices'], 'A', 'reading:detail', false),
  grp(21, 'part7', 'A2', P7_A, 'Until when is breakfast served?', ['7:30 A.M.', '8:00 A.M.', '10:00 A.M.', 'Noon'], 'C', 'reading:detail', false),
  grp(22, 'part7', 'B1', P7_B, 'What are team members asked to do?', ['Visit suppliers', 'Submit reports', 'Lower prices', 'Hire staff'], 'B', 'reading:detail', false),
  grp(23, 'part7', 'B2', P7_B, 'What is implied about some vendors?', ['They will lose contracts immediately.', 'They may need to explain how they will improve.', 'They operate in only one region.', 'They have requested a review.'], 'B', 'reading:inference', false),
];

export const MOCK_DIAGNOSTIC_SET: MockTestSet = {
  id: uid(790, 'cccc'),
  code: 'toeic-diagnostic-mock-01',
  title: { vi: 'TOEIC · Bài chẩn đoán (mock)', en: 'TOEIC · Diagnostic (mock)' },
  kind: 'diagnostic',
  level: null,
  is_free: true,
  locked: false,
  duration_sec: null,
  question_count: MOCK_DIAGNOSTIC_QUESTIONS.length,
  sections: [
    { code: 'part1', skill: 'listening', name: { vi: 'Part 1', en: 'Part 1' }, duration_sec: null, question_count: 3 },
    { code: 'part2', skill: 'listening', name: { vi: 'Part 2', en: 'Part 2' }, duration_sec: null, question_count: 4 },
    { code: 'part3', skill: 'listening', name: { vi: 'Part 3', en: 'Part 3' }, duration_sec: null, question_count: 4 },
    { code: 'part5', skill: 'reading', name: { vi: 'Part 5', en: 'Part 5' }, duration_sec: null, question_count: 8 },
    { code: 'part7', skill: 'reading', name: { vi: 'Part 7', en: 'Part 7' }, duration_sec: null, question_count: 4 },
  ],
  questions: MOCK_DIAGNOSTIC_QUESTIONS,
};

/** Blueprint mock (đơn vị = câu lẻ hoặc trọn nhóm passage) */
export const MOCK_DIAGNOSTIC_BLUEPRINT = [
  { section_code: 'part1', units: 2 },
  { section_code: 'part2', units: 2 },
  { section_code: 'part3', units: 1 },
  { section_code: 'part5', units: 5 },
  { section_code: 'part7', units: 1 },
] as const;
