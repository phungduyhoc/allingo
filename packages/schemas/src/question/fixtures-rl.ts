import type { ProgramCode } from '../common.js';
import type { AnswerInput } from './answer.js';
import type { QuestionContentInput } from './content.js';
import type { RL_QUESTION_TYPE_CODES } from './rl-types.js';

/**
 * C2 – fixture tự biên soạn cho 14 dạng câu IELTS Reading/Listening (source = 'human'). Bối cảnh, tên người/địa danh hư cấu
 * (thị trấn Wexley, vườn cộng đồng Harbourview, Dr Mara Ellison…); KHÔNG sao chép đề IELTS thật (CLAUDE.md §10).
 * Fixture đầu tiên mỗi dạng là bản đầy đủ dùng cho đề mẫu `ielts-question-types-demo` (seed demo + web mock), các fixture sau
 * kiểm tra quy tắc chấm (giới hạn từ, chính tả Anh/Mỹ, dùng lại lựa chọn, dòng ví dụ, partial).
 */

export interface RawRlFixture {
  program: ProgramCode;
  content: QuestionContentInput;
  correct_answer: AnswerInput;
  wrong_answer: AnswerInput;
  partial_answer?: AnswerInput;
  expected: { correct: number | null; wrong: number | null; partial?: number };
}

/** UUID giả ổn định cho ảnh sơ đồ/bản đồ trong fixture (seed demo thay bằng asset thật) */
const IMG = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;

/** Đoạn văn đọc hiểu dùng chung (seed demo gắn làm passage của nhóm Reading – tự biên soạn) */
export const RL_DEMO_READING = {
  title: 'Lending seeds, not just books',
  body: [
    'A  In the small town of Wexley, the public library lends more than books. Since 2015, a cabinet near the entrance has held hundreds of paper envelopes, each containing seeds of vegetables, herbs and flowers. Borrowers take the seeds home, grow the plants and, at the end of the season, return seeds saved from their own harvest. The idea, known as a seed library, has since spread to more than forty towns in the region.',
    'B  The founder, retired botanist Dr Mara Ellison, says the project began as a response to a loss she had noticed over several decades. Local varieties of beans and tomatoes, once swapped between neighbours, were disappearing from gardens as people bought the same few commercial types. "Every variety that vanishes takes its adaptations with it," she explains. Seeds saved locally, she argues, are gradually shaped by the soil and weather of the area.',
    'C  Running a seed library is not without difficulties. Volunteers must check that returned seeds are clean, dry and correctly labelled, and some plants cross-pollinate so easily that saved seeds may not grow true to type. To reduce this risk, the Wexley library publishes a simple guide and holds monthly workshops led by the horticulturalist Tom Achebe, who teaches borrowers how to keep different plants apart and how to dry seeds properly.',
    'D  Supporters claim that seed libraries strengthen communities as much as they protect plants. A survey of 300 borrowers carried out by the regional council found that two thirds had met new people through the scheme, and many had started sharing tools and surplus produce. The economist Priya Nandakumar, however, warns that the financial savings for households are modest, since seeds are a small part of the cost of gardening.',
    'E  The future of the movement may depend on technology. Several libraries now record the history of each variety in an online catalogue, including where it was grown and how well it performed. Ellison hopes that this information will eventually help gardeners choose seeds suited to a changing climate. It seems likely that the movement’s greatest contribution will be the knowledge it gathers rather than the seeds it lends.',
  ].join('\n\n'),
} as const;

/** Lời thoại Listening dùng chung (seed demo gắn làm passage `audio_script` – tự biên soạn) */
export const RL_DEMO_LISTENING = {
  title: 'Joining Harbourview Community Garden',
  segments: [
    { speaker: 'Jenny', text: 'Good morning, Harbourview Community Garden, Jenny speaking.' },
    { speaker: 'Daniel', text: "Hi, I'd like to register for a garden plot, please. My name's Daniel Okafor – that's O-K-A-F-O-R." },
    { speaker: 'Jenny', text: "Thanks, Daniel. And your address?" },
    { speaker: 'Daniel', text: "It's 14 Mill Lane. I'd prefer a small plot, if possible – I'm new to gardening." },
    { speaker: 'Jenny', text: 'No problem. Plots are available from the 3rd of May. Just a few rules: please water only before nine in the morning, and the compost bins are next to the greenhouse. Children are welcome but must be with an adult.' },
    { speaker: 'Jenny', text: 'We also run workshops. On Tuesdays there is pruning for beginners, which is free. The composting class on Thursday costs six pounds, and on Saturday you can learn about growing herbs for four pounds.' },
    { speaker: 'Jenny', text: "When you arrive, go through the main gate at the bottom of the map. The greenhouse is in the top left corner, the compost bins are just to the right of it, the tool shed is in the middle of the east side, and the pond is near the main gate on the left." },
    { speaker: 'Jenny', text: 'Rain from the shed roof runs into a gutter, then down a pipe and through a filter before it reaches the tank. You fill your watering can from the tap at the bottom of the tank.' },
    { speaker: 'Jenny', text: 'On your first day, please bring gloves and a bottle of water. We provide all the tools and seeds.' },
  ],
} as const;

/** Ảnh SVG tự vẽ cho bản đồ khu vườn (seed demo + web mock) – các chữ A–F khớp `markers` của fixture plan_map_labelling-01 */
export const RL_DEMO_MAP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img"><rect width="800" height="600" fill="#f4f7ef"/><rect x="40" y="40" width="720" height="520" fill="#e6efd8" stroke="#55703a" stroke-width="6"/><rect x="350" y="548" width="100" height="24" fill="#f4f7ef"/><text x="400" y="590" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#33461f">Main gate</text>' +
  [
    ['A', 120, 110],
    ['B', 300, 110],
    ['C', 660, 300],
    ['D', 400, 300],
    ['E', 150, 470],
    ['F', 640, 470],
  ]
    .map(([k, x, y]) => `<circle cx="${x}" cy="${y}" r="30" fill="#1f3a5f"/><text x="${x}" y="${Number(y) + 9}" font-size="28" text-anchor="middle" font-family="sans-serif" font-weight="700" fill="#ffffff">${k}</text>`)
    .join('') +
  '</svg>';

/** Ảnh SVG tự vẽ cho sơ đồ thu nước mưa – số 1–3 khớp `labels` của fixture diagram_labelling-01 */
export const RL_DEMO_DIAGRAM_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img"><rect width="800" height="600" fill="#f5f7fa"/><polygon points="120,200 360,110 600,200" fill="#8d6e63"/><rect x="150" y="200" width="420" height="250" fill="#d7ccc8" stroke="#5d4037" stroke-width="4"/><rect x="560" y="196" width="120" height="16" fill="#607d8b"/><rect x="664" y="212" width="16" height="140" fill="#607d8b"/><rect x="644" y="352" width="56" height="30" fill="#90a4ae"/><rect x="620" y="382" width="104" height="170" rx="12" fill="#4f83cc"/><rect x="600" y="520" width="24" height="14" fill="#37474f"/>' +
  [
    [1, 620, 175],
    [2, 735, 367],
    [3, 575, 527],
  ]
    .map(([n, x, y]) => `<circle cx="${x}" cy="${y}" r="22" fill="#ffffff" stroke="#1f3a5f" stroke-width="4"/><text x="${x}" y="${Number(y) + 8}" font-size="24" text-anchor="middle" font-family="sans-serif" font-weight="700" fill="#1f3a5f">${n}</text>`)
    .join('') +
  '</svg>';

export const RL_RAW: Record<(typeof RL_QUESTION_TYPE_CODES)[number], RawRlFixture[]> = {
  // ------------------------------------------------------------------------- Nối tiêu đề
  matching_headings: [
    {
      program: 'ielts',
      content: {
        type: 'matching_headings',
        stem: 'The reading passage has five paragraphs, A–E. Choose the correct heading for paragraphs B–E from the list of headings below.',
        options_title: 'List of Headings',
        items: [
          { key: 'A', text: 'Paragraph A' },
          { key: 'B', text: 'Paragraph B' },
          { key: 'C', text: 'Paragraph C' },
          { key: 'D', text: 'Paragraph D' },
          { key: 'E', text: 'Paragraph E' },
        ],
        options: [
          { key: 'i', text: 'How the scheme operates' },
          { key: 'ii', text: 'Why local varieties are worth saving' },
          { key: 'iii', text: 'Government funding for gardeners' },
          { key: 'iv', text: 'Keeping returned seeds reliable' },
          { key: 'v', text: 'Social gains and economic limits' },
          { key: 'vi', text: 'Competition with commercial suppliers' },
          { key: 'vii', text: 'Gathering knowledge for the future' },
        ],
        example: { item: 'A', option: 'i' },
        answer_key: { pairs: { B: 'ii', C: 'iv', D: 'v', E: 'vii' } },
        explanation: { vi: 'B nói lý do giữ giống địa phương; C nêu khó khăn và cách khắc phục; D lợi ích xã hội + giới hạn kinh tế; E dữ liệu cho tương lai.', en: 'B explains why local varieties matter; C covers problems and fixes; D social benefits and economic limits; E data for the future.' },
        tags: ['ielts:reading', 'matching_headings'],
      },
      correct_answer: { type: 'matching_headings', pairs: { B: 'ii', C: 'iv', D: 'v', E: 'vii' } },
      wrong_answer: { type: 'matching_headings', pairs: { B: 'iii', C: 'vi', D: 'i', E: 'ii' } },
      partial_answer: { type: 'matching_headings', pairs: { B: 'ii', C: 'iv', D: 'iii', E: 'vi' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      // Dùng lại một tiêu đề cho hai đoạn → cả hai mục sai (allow_reuse = false)
      program: 'ielts',
      content: {
        type: 'matching_headings',
        stem: 'Choose the correct heading for each paragraph.',
        items: [
          { key: 'A', text: 'Paragraph A' },
          { key: 'B', text: 'Paragraph B' },
        ],
        options: [
          { key: 'i', text: 'A surprising discovery' },
          { key: 'ii', text: 'Reasons for caution' },
          { key: 'iii', text: 'An unexpected cost' },
        ],
        answer_key: { pairs: { A: 'i', B: 'ii' } },
      },
      correct_answer: { type: 'matching_headings', pairs: { A: 'i', B: 'ii' } },
      wrong_answer: { type: 'matching_headings', pairs: { A: 'i', B: 'i' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      // Dòng ví dụ không tính điểm kể cả khi người học sửa
      program: 'ielts',
      content: {
        type: 'matching_headings',
        stem: 'Choose the correct heading for paragraphs B and C.',
        items: [
          { key: 'A', text: 'Paragraph A' },
          { key: 'B', text: 'Paragraph B' },
          { key: 'C', text: 'Paragraph C' },
        ],
        options: [
          { key: 'i', text: 'Early experiments' },
          { key: 'ii', text: 'A change of direction' },
          { key: 'iii', text: 'Lessons for other cities' },
          { key: 'iv', text: 'Opposition from residents' },
        ],
        example: { item: 'A', option: 'i' },
        answer_key: { pairs: { B: 'ii', C: 'iii' } },
      },
      correct_answer: { type: 'matching_headings', pairs: { A: 'iv', B: 'ii', C: 'iii' } },
      wrong_answer: { type: 'matching_headings', pairs: { B: 'iv', C: 'i' } },
      partial_answer: { type: 'matching_headings', pairs: { B: 'ii' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Nối thông tin – đoạn
  matching_information: [
    {
      program: 'ielts',
      content: {
        type: 'matching_information',
        stem: 'Which paragraph contains the following information? You may use any letter more than once.',
        items: [
          { key: '1', text: 'the number of towns that now have a seed library' },
          { key: '2', text: 'an explanation of why some saved seeds may be unreliable' },
          { key: '3', text: 'a finding from research involving borrowers' },
          { key: '4', text: 'a description of what borrowers do at the end of the season' },
        ],
        options: ['A', 'B', 'C', 'D', 'E'].map((k) => ({ key: k, text: `Paragraph ${k}` })),
        answer_key: { pairs: { '1': 'A', '2': 'C', '3': 'D', '4': 'A' } },
        explanation: { vi: 'Câu 1 và 4 cùng ở đoạn A (được dùng lại chữ cái).', en: 'Statements 1 and 4 are both in paragraph A (letters may be reused).' },
        tags: ['ielts:reading', 'matching_information'],
      },
      correct_answer: { type: 'matching_information', pairs: { '1': 'A', '2': 'C', '3': 'D', '4': 'A' } },
      wrong_answer: { type: 'matching_information', pairs: { '1': 'E', '2': 'B', '3': 'C', '4': 'D' } },
      partial_answer: { type: 'matching_information', pairs: { '1': 'A', '2': 'C', '3': 'B', '4': 'E' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_information',
        stem: 'Which paragraph mentions each point?',
        items: [
          { key: '1', text: 'a comparison of two methods' },
          { key: '2', text: 'a warning about cost' },
        ],
        options: ['A', 'B', 'C'].map((k) => ({ key: k, text: `Paragraph ${k}` })),
        answer_key: { pairs: { '1': 'B', '2': 'B' } },
      },
      correct_answer: { type: 'matching_information', pairs: { '1': 'B', '2': 'B' } },
      wrong_answer: { type: 'matching_information', pairs: {} },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_information',
        stem: 'Which section contains the following information?',
        items: [
          { key: '1', text: 'a date' },
          { key: '2', text: 'a name' },
          { key: '3', text: 'a place' },
        ],
        options: ['A', 'B', 'C', 'D'].map((k) => ({ key: k, text: `Section ${k}` })),
        answer_key: { pairs: { '1': 'A', '2': 'C', '3': 'D' }, scoring: 'all_or_nothing' },
      },
      correct_answer: { type: 'matching_information', pairs: { '1': 'A', '2': 'C', '3': 'D' } },
      wrong_answer: { type: 'matching_information', pairs: { '1': 'A', '2': 'C', '3': 'B' } },
      expected: { correct: 1, wrong: 0 },
    },
  ],
  // ------------------------------------------------------------------------- Nối đặc điểm – người
  matching_features: [
    {
      program: 'ielts',
      content: {
        type: 'matching_features',
        stem: 'Match each statement with the correct person, A, B or C. You may use any letter more than once.',
        options_title: 'List of People',
        items: [
          { key: '1', text: 'teaches borrowers how to keep different plants apart' },
          { key: '2', text: 'doubts that the scheme saves families much money' },
          { key: '3', text: 'believes that local seeds adapt to the conditions of an area' },
          { key: '4', text: 'hopes records will help gardeners deal with climate change' },
        ],
        options: [
          { key: 'A', text: 'Mara Ellison' },
          { key: 'B', text: 'Tom Achebe' },
          { key: 'C', text: 'Priya Nandakumar' },
        ],
        answer_key: { pairs: { '1': 'B', '2': 'C', '3': 'A', '4': 'A' } },
        explanation: { vi: 'Ellison (A) được dùng hai lần: giống địa phương thích nghi + dữ liệu khí hậu.', en: 'Ellison (A) is used twice: local adaptation and climate data.' },
        tags: ['ielts:reading', 'matching_features'],
      },
      correct_answer: { type: 'matching_features', pairs: { '1': 'B', '2': 'C', '3': 'A', '4': 'A' } },
      wrong_answer: { type: 'matching_features', pairs: { '1': 'A', '2': 'A', '3': 'C', '4': 'B' } },
      partial_answer: { type: 'matching_features', pairs: { '1': 'B', '2': 'C', '3': 'B', '4': 'C' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_features',
        stem: 'Match each invention with the decade.',
        items: [
          { key: '1', text: 'the folding bicycle' },
          { key: '2', text: 'the solar kettle' },
        ],
        options: [
          { key: 'A', text: 'the 1950s' },
          { key: 'B', text: 'the 1970s' },
          { key: 'C', text: 'the 1990s' },
        ],
        allow_reuse: false,
        answer_key: { pairs: { '1': 'A', '2': 'C' } },
      },
      correct_answer: { type: 'matching_features', pairs: { '1': 'A', '2': 'C' } },
      wrong_answer: { type: 'matching_features', pairs: { '1': 'C', '2': 'C' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_features',
        stem: 'Which researcher made each claim?',
        items: [
          { key: '1', text: 'Sleep affects memory.' },
          { key: '2', text: 'Diet affects mood.' },
        ],
        options: [
          { key: 'A', text: 'Dr Halvorsen' },
          { key: 'B', text: 'Professor Ito' },
        ],
        answer_key: { pairs: { '1': 'A', '2': 'B' } },
      },
      correct_answer: { type: 'matching_features', pairs: { '1': 'A', '2': 'B' } },
      wrong_answer: { type: 'matching_features', pairs: { '1': 'B', '2': 'A' } },
      partial_answer: { type: 'matching_features', pairs: { '1': 'A' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Nối đuôi câu
  matching_sentence_endings: [
    {
      program: 'ielts',
      content: {
        type: 'matching_sentence_endings',
        stem: 'Complete each sentence with the correct ending, A–E.',
        items: [
          { key: '1', text: 'Borrowers who take seeds from the library' },
          { key: '2', text: 'Commercial varieties of vegetables' },
          { key: '3', text: 'The monthly workshops' },
        ],
        options: [
          { key: 'A', text: 'are expected to return seeds from their own plants.' },
          { key: 'B', text: 'have replaced many traditional types in gardens.' },
          { key: 'C', text: 'show people how to dry seeds correctly.' },
          { key: 'D', text: 'are paid for by the regional council.' },
          { key: 'E', text: 'are mainly attended by retired botanists.' },
        ],
        answer_key: { pairs: { '1': 'A', '2': 'B', '3': 'C' } },
        explanation: { vi: 'D và E là đuôi câu nhiễu – bài không nói hội đồng trả tiền hay người tham dự chủ yếu là nhà thực vật học.', en: 'D and E are distractors – the passage says nothing about council funding or who attends.' },
        tags: ['ielts:reading', 'matching_sentence_endings'],
      },
      correct_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'B', '3': 'C' } },
      wrong_answer: { type: 'matching_sentence_endings', pairs: { '1': 'D', '2': 'E', '3': 'A' } },
      partial_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'D', '3': 'E' } },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_sentence_endings',
        stem: 'Complete each sentence with the correct ending.',
        items: [
          { key: '1', text: 'The bridge was closed' },
          { key: '2', text: 'The ferry was introduced' },
        ],
        options: [
          { key: 'A', text: 'because of storm damage.' },
          { key: 'B', text: 'to reduce traffic.' },
          { key: 'C', text: 'after a public vote.' },
        ],
        answer_key: { pairs: { '1': 'A', '2': 'B' } },
      },
      correct_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'B' } },
      wrong_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'A' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'matching_sentence_endings',
        stem: 'Complete each sentence.',
        items: [
          { key: '1', text: 'Early maps' },
          { key: '2', text: 'Satellite images' },
        ],
        options: [
          { key: 'A', text: 'were drawn by hand.' },
          { key: 'B', text: 'are updated daily.' },
          { key: 'C', text: 'were sold in markets.' },
        ],
        answer_key: { pairs: { '1': 'A', '2': 'B' } },
      },
      correct_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'B' } },
      wrong_answer: { type: 'matching_sentence_endings', pairs: { '1': 'C', '2': 'A' } },
      partial_answer: { type: 'matching_sentence_endings', pairs: { '1': 'A', '2': 'C' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành câu
  sentence_completion: [
    {
      program: 'ielts',
      content: {
        type: 'sentence_completion',
        stem: 'Complete the sentences below. Choose NO MORE THAN TWO WORDS from the passage for each answer.',
        word_limit: { max_words: 2 },
        sentences: [
          { key: 's1', text: 'The seed envelopes are kept in a {{1}} near the library entrance.' },
          { key: 's2', text: 'Tom Achebe runs {{2}} that teach borrowers how to dry seeds.' },
        ],
        answer_key: { gaps: { '1': { accepted: ['cabinet'] }, '2': { accepted: ['(monthly) workshops'] } }, spelling_variants: true },
        explanation: { vi: '"a cabinet near the entrance" (đoạn A); "monthly workshops led by ... Tom Achebe" (đoạn C).', en: '"a cabinet near the entrance" (A); "monthly workshops led by Tom Achebe" (C).' },
        tags: ['ielts:reading', 'sentence_completion'],
      },
      correct_answer: { type: 'sentence_completion', gaps: { '1': 'Cabinet', '2': 'monthly workshops' } },
      wrong_answer: { type: 'sentence_completion', gaps: { '1': 'shelf', '2': 'the monthly workshops' } },
      partial_answer: { type: 'sentence_completion', gaps: { '1': ' cabinet. ', '2': 'classes' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      // Giới hạn ONE WORD AND/OR A NUMBER: "25 kilometres" hợp lệ, "twenty five kilometres" vượt giới hạn
      program: 'ielts',
      content: {
        type: 'sentence_completion',
        stem: 'Write ONE WORD AND/OR A NUMBER for each answer.',
        word_limit: { max_words: 1, allow_number: true },
        sentences: [{ key: 's1', text: 'The new cycle path is {{d}} long.' }],
        answer_key: { gaps: { d: { accepted: ['25 kilometres', '25 km'] } }, spelling_variants: true },
      },
      correct_answer: { type: 'sentence_completion', gaps: { d: '25 kilometers' } },
      wrong_answer: { type: 'sentence_completion', gaps: { d: 'twenty five kilometres' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      // Phân biệt hoa thường khi khai báo (mã sản phẩm)
      program: 'ielts',
      content: {
        type: 'sentence_completion',
        stem: 'Write NO MORE THAN ONE WORD AND/OR A NUMBER.',
        word_limit: { max_words: 1, allow_number: true },
        sentences: [
          { key: 's1', text: 'The model code is {{m}}.' },
          { key: 's2', text: 'The tour starts at {{t}}.' },
        ],
        answer_key: { gaps: { m: { accepted: ['XR7'], case_sensitive: true }, t: { accepted: ['7.30', '7:30', 'seven thirty'] } } },
      },
      correct_answer: { type: 'sentence_completion', gaps: { m: 'XR7', t: '7:30' } },
      wrong_answer: { type: 'sentence_completion', gaps: { m: 'xr7', t: '8.30' } },
      partial_answer: { type: 'sentence_completion', gaps: { m: 'XR7', t: '' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành tóm tắt (gõ)
  summary_completion: [
    {
      program: 'ielts',
      content: {
        type: 'summary_completion',
        stem: 'Complete the summary below. Choose ONE WORD ONLY from the passage for each answer.',
        word_limit: { max_words: 1 },
        title: 'How a seed library works',
        text: 'Borrowers grow plants at home and later return seeds saved from their own {{1}}. According to the founder, locally saved seeds are slowly shaped by the soil and {{2}} of an area. Before seeds go back into the cabinet, volunteers check that they are clean, dry and correctly {{3}}.',
        answer_key: { gaps: { '1': { accepted: ['harvest'] }, '2': { accepted: ['weather'] }, '3': { accepted: ['labelled'] } }, spelling_variants: true },
        explanation: { vi: '"labelled" (Anh) – viết "labeled" (Mỹ) cũng được chấp nhận vì câu khai báo chính tả Anh/Mỹ.', en: '"labelled" (UK) – "labeled" (US) is also accepted.' },
        tags: ['ielts:reading', 'summary_completion'],
      },
      correct_answer: { type: 'summary_completion', gaps: { '1': 'harvest', '2': 'Weather', '3': 'labeled' } },
      wrong_answer: { type: 'summary_completion', gaps: { '1': 'garden', '2': 'climate', '3': 'stored' } },
      partial_answer: { type: 'summary_completion', gaps: { '1': 'harvest', '2': 'rain', '3': 'labelled' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      // Không khai báo chính tả Anh/Mỹ → "color" ≠ "colour"
      program: 'ielts',
      content: {
        type: 'summary_completion',
        stem: 'Write ONE WORD ONLY.',
        word_limit: { max_words: 1 },
        text: 'The flag is mostly one {{1}}.',
        answer_key: { gaps: { '1': { accepted: ['colour'] } } },
      },
      correct_answer: { type: 'summary_completion', gaps: { '1': 'COLOUR' } },
      wrong_answer: { type: 'summary_completion', gaps: { '1': 'color' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'summary_completion',
        stem: 'Write NO MORE THAN TWO WORDS.',
        word_limit: { max_words: 2 },
        text: 'Visitors should meet at the {{1}} and bring a {{2}}.',
        answer_key: { gaps: { '1': { accepted: ['(main) entrance'] }, '2': { accepted: ['packed lunch', 'lunch'] } } },
      },
      correct_answer: { type: 'summary_completion', gaps: { '1': 'main  entrance', '2': 'packed lunch' } },
      wrong_answer: { type: 'summary_completion', gaps: { '1': 'the main entrance', '2': 'a packed lunch box' } },
      partial_answer: { type: 'summary_completion', gaps: { '1': 'entrance', '2': 'sandwich' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành ghi chú
  note_completion: [
    {
      program: 'ielts',
      content: {
        type: 'note_completion',
        stem: 'Complete the notes below. Write ONE WORD AND/OR A NUMBER for each answer.',
        word_limit: { max_words: 1, allow_number: true },
        title: 'Garden rules',
        lines: [
          { text: 'Watering', heading: true, level: 0 },
          { text: 'only before {{1}} a.m.', level: 1 },
          { text: 'Compost', heading: true, level: 0 },
          { text: 'bins are next to the {{2}}', level: 1 },
          { text: 'Visitors', heading: true, level: 0 },
          { text: 'children must be with an {{3}}', level: 1 },
        ],
        answer_key: { gaps: { '1': { accepted: ['9', 'nine'] }, '2': { accepted: ['greenhouse'] }, '3': { accepted: ['adult'] } } },
        explanation: { vi: 'Nghe: "water only before nine in the morning", "next to the greenhouse", "with an adult".', en: 'Listen for "before nine", "next to the greenhouse", "with an adult".' },
        tags: ['ielts:listening', 'note_completion'],
      },
      correct_answer: { type: 'note_completion', gaps: { '1': 'nine', '2': 'greenhouse', '3': 'Adult' } },
      wrong_answer: { type: 'note_completion', gaps: { '1': '10', '2': 'shed', '3': 'teacher' } },
      partial_answer: { type: 'note_completion', gaps: { '1': '9', '2': 'pond', '3': '' } },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      program: 'ielts',
      content: {
        type: 'note_completion',
        stem: 'Write A NUMBER for each answer.',
        word_limit: { number_only: true },
        lines: [{ text: 'Group size: up to {{1}} people' }],
        answer_key: { gaps: { '1': { accepted: ['12'] } } },
      },
      correct_answer: { type: 'note_completion', gaps: { '1': '12' } },
      wrong_answer: { type: 'note_completion', gaps: { '1': 'twelve' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'note_completion',
        stem: 'Write NO MORE THAN TWO WORDS AND/OR A NUMBER.',
        word_limit: { max_words: 2, allow_number: true },
        lines: [
          { text: 'Cost: £{{1}} per person' },
          { text: 'Bring: {{2}}' },
        ],
        answer_key: { gaps: { '1': { accepted: ['1,250', '1250'] }, '2': { accepted: ['walking boots'] } } },
      },
      correct_answer: { type: 'note_completion', gaps: { '1': '1250', '2': 'walking boots' } },
      wrong_answer: { type: 'note_completion', gaps: { '1': '125', '2': 'strong walking boots' } },
      partial_answer: { type: 'note_completion', gaps: { '1': '1,250', '2': 'boots' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành bảng
  table_completion: [
    {
      program: 'ielts',
      content: {
        type: 'table_completion',
        stem: 'Complete the table below. Write ONE WORD AND/OR A NUMBER for each answer.',
        word_limit: { max_words: 1, allow_number: true },
        title: 'Weekly workshops',
        columns: ['Day', 'Workshop', 'Cost'],
        rows: [
          ['Tuesday', '{{1}} for beginners', 'free'],
          ['Thursday', 'Composting', '£{{2}}'],
          ['Saturday', 'Growing {{3}}', '£4'],
        ],
        answer_key: { gaps: { '1': { accepted: ['pruning'] }, '2': { accepted: ['6', 'six'] }, '3': { accepted: ['herbs'] } } },
        explanation: { vi: 'Thứ Ba: pruning (miễn phí); thứ Năm: 6 bảng; thứ Bảy: herbs.', en: 'Tuesday: pruning; Thursday: £6; Saturday: herbs.' },
        tags: ['ielts:listening', 'table_completion'],
      },
      correct_answer: { type: 'table_completion', gaps: { '1': 'Pruning', '2': '6', '3': 'herbs' } },
      wrong_answer: { type: 'table_completion', gaps: { '1': 'planting', '2': '4', '3': 'flowers' } },
      partial_answer: { type: 'table_completion', gaps: { '1': 'pruning', '2': 'six', '3': 'vegetables' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      program: 'ielts',
      content: {
        type: 'table_completion',
        stem: 'Write ONE WORD ONLY.',
        word_limit: { max_words: 1 },
        columns: ['Room', 'Use'],
        rows: [['Room 2', '{{a}}']],
        answer_key: { gaps: { a: { accepted: ['storage'] } } },
      },
      correct_answer: { type: 'table_completion', gaps: { a: 'storage' } },
      wrong_answer: { type: 'table_completion', gaps: { a: 'long-term storage' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'table_completion',
        stem: 'Write NO MORE THAN TWO WORDS.',
        word_limit: { max_words: 2 },
        columns: ['Species', 'Habitat'],
        rows: [
          ['Grey heron', '{{1}}'],
          ['Red kite', '{{2}}'],
        ],
        answer_key: { gaps: { '1': { accepted: ['river banks', 'riverbanks'] }, '2': { accepted: ['open farmland', 'farmland'] } }, spelling_variants: true },
      },
      correct_answer: { type: 'table_completion', gaps: { '1': 'riverbanks', '2': 'farmland' } },
      wrong_answer: { type: 'table_completion', gaps: { '1': 'lakes', '2': 'woods' } },
      partial_answer: { type: 'table_completion', gaps: { '1': 'river banks', '2': 'forest' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành sơ đồ quy trình
  flow_chart_completion: [
    {
      program: 'ielts',
      content: {
        type: 'flow_chart_completion',
        stem: 'Complete the flow chart below. Choose ONE WORD ONLY from the passage for each answer.',
        word_limit: { max_words: 1 },
        title: 'The life of a borrowed seed',
        steps: [
          { text: 'A borrower takes an envelope from the cabinet.' },
          { text: 'The seeds are grown at {{1}}.' },
          { text: 'New seeds are saved from the {{2}}.' },
          { text: 'Returned seeds are checked by {{3}}.' },
        ],
        answer_key: { gaps: { '1': { accepted: ['home'] }, '2': { accepted: ['harvest'] }, '3': { accepted: ['volunteers'] } } },
        tags: ['ielts:reading', 'flow_chart_completion'],
      },
      correct_answer: { type: 'flow_chart_completion', gaps: { '1': 'home', '2': 'harvest', '3': 'Volunteers' } },
      wrong_answer: { type: 'flow_chart_completion', gaps: { '1': 'school', '2': 'flowers', '3': 'staff' } },
      partial_answer: { type: 'flow_chart_completion', gaps: { '1': 'home', '2': 'plants', '3': 'volunteers' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      program: 'ielts',
      content: {
        type: 'flow_chart_completion',
        stem: 'Write ONE WORD ONLY.',
        word_limit: { max_words: 1 },
        steps: [{ text: 'Clay is {{1}}.' }, { text: 'The pot is fired.' }],
        answer_key: { gaps: { '1': { accepted: ['shaped', 'moulded'] } }, spelling_variants: true },
      },
      correct_answer: { type: 'flow_chart_completion', gaps: { '1': 'molded' } },
      wrong_answer: { type: 'flow_chart_completion', gaps: { '1': 'painted' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'flow_chart_completion',
        stem: 'Write NO MORE THAN TWO WORDS.',
        word_limit: { max_words: 2 },
        steps: [{ text: 'Apply for a {{1}}.' }, { text: 'Attend an {{2}}.' }],
        answer_key: { gaps: { '1': { accepted: ['parking permit'] }, '2': { accepted: ['interview'] } } },
      },
      correct_answer: { type: 'flow_chart_completion', gaps: { '1': 'parking permit', '2': 'interview' } },
      wrong_answer: { type: 'flow_chart_completion', gaps: { '1': 'permit for parking', '2': '' } },
      partial_answer: { type: 'flow_chart_completion', gaps: { '1': 'parking permit', '2': 'exam' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Hoàn thành biểu mẫu
  form_completion: [
    {
      program: 'ielts',
      content: {
        type: 'form_completion',
        stem: 'Complete the form below. Write ONE WORD AND/OR A NUMBER for each answer.',
        word_limit: { max_words: 1, allow_number: true },
        title: 'Harbourview Community Garden – plot registration',
        fields: [
          { label: 'Name', value: 'Daniel {{1}}' },
          { label: 'Address', value: '{{2}} Mill Lane' },
          { label: 'Plot size', value: '{{3}}' },
          { label: 'Start date', value: '{{4}} May' },
        ],
        answer_key: { gaps: { '1': { accepted: ['Okafor'] }, '2': { accepted: ['14', 'fourteen'] }, '3': { accepted: ['small'] }, '4': { accepted: ['3', '3rd', 'third'] } } },
        explanation: { vi: 'Tên được đánh vần O-K-A-F-O-R; ngày bắt đầu "the 3rd of May".', en: 'The surname is spelled O-K-A-F-O-R; the plots open on the 3rd of May.' },
        tags: ['ielts:listening', 'form_completion'],
      },
      correct_answer: { type: 'form_completion', gaps: { '1': 'okafor', '2': '14', '3': 'small', '4': '3rd' } },
      wrong_answer: { type: 'form_completion', gaps: { '1': 'Okafore', '2': '40', '3': 'large', '4': '13' } },
      partial_answer: { type: 'form_completion', gaps: { '1': 'Okafor', '2': '14', '3': 'big', '4': '30' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'form_completion',
        stem: 'Write ONE WORD ONLY.',
        word_limit: { max_words: 1 },
        fields: [{ label: 'Payment method', value: '{{p}}' }],
        answer_key: { gaps: { p: { accepted: ['cheque'] } }, spelling_variants: true },
      },
      correct_answer: { type: 'form_completion', gaps: { p: 'check' } },
      wrong_answer: { type: 'form_completion', gaps: { p: 'cash' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'form_completion',
        stem: 'Write NO MORE THAN THREE WORDS AND/OR A NUMBER.',
        word_limit: { max_words: 3, allow_number: true },
        fields: [
          { label: 'Postcode', value: '{{1}}' },
          { label: 'Reason for visit', value: '{{2}}' },
        ],
        answer_key: { gaps: { '1': { accepted: ['BN7 2QT'] }, '2': { accepted: ['(a) job interview'] } } },
      },
      correct_answer: { type: 'form_completion', gaps: { '1': 'bn7 2qt', '2': 'a job interview' } },
      wrong_answer: { type: 'form_completion', gaps: { '1': 'BN7 2QF', '2': 'an interview for a job' } },
      partial_answer: { type: 'form_completion', gaps: { '1': 'BN7 2QT', '2': 'meeting' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Trả lời ngắn
  short_answer: [
    {
      program: 'ielts',
      content: {
        type: 'short_answer',
        stem: 'Answer the questions below. Choose NO MORE THAN THREE WORDS AND/OR A NUMBER from the passage for each answer.',
        word_limit: { max_words: 3, allow_number: true },
        questions: [
          { id: '1', text: 'In how many towns in the region is there now a seed library?' },
          { id: '2', text: 'What do several libraries use to record the history of each variety?' },
        ],
        answer_key: { gaps: { '1': { accepted: ['(more than) forty', '(more than) 40', 'over forty', 'over 40'] }, '2': { accepted: ['(an) online catalogue'] } }, spelling_variants: true },
        explanation: { vi: '"spread to more than forty towns" (A); "an online catalogue" (E) – "catalog" (Mỹ) cũng đúng.', en: '"more than forty towns" (A); "an online catalogue" (E) – US "catalog" accepted.' },
        tags: ['ielts:reading', 'short_answer'],
      },
      correct_answer: { type: 'short_answer', gaps: { '1': 'more than 40', '2': 'online catalog' } },
      wrong_answer: { type: 'short_answer', gaps: { '1': '300', '2': 'a printed paper notebook' } },
      partial_answer: { type: 'short_answer', gaps: { '1': 'forty', '2': 'a website' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'short_answer',
        stem: 'Write NO MORE THAN TWO WORDS.',
        word_limit: { max_words: 2 },
        questions: [{ id: 'q', text: 'What did the team organise first?' }],
        answer_key: { gaps: { q: { accepted: ['(a) fundraising event'] } }, spelling_variants: true },
      },
      correct_answer: { type: 'short_answer', gaps: { q: 'fundraising event' } },
      wrong_answer: { type: 'short_answer', gaps: { q: 'a fundraising event' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'short_answer',
        stem: 'Write ONE WORD AND/OR A NUMBER.',
        word_limit: { max_words: 1, allow_number: true },
        questions: [
          { id: '1', text: 'Which year did the museum open?' },
          { id: '2', text: 'Which material was used for the roof?' },
        ],
        answer_key: { gaps: { '1': { accepted: ['1968'] }, '2': { accepted: ['copper'] } } },
      },
      correct_answer: { type: 'short_answer', gaps: { '1': '1968', '2': 'copper.' } },
      wrong_answer: { type: 'short_answer', gaps: { '1': '1986', '2': 'glass' } },
      partial_answer: { type: 'short_answer', gaps: { '1': '1968', '2': 'steel' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Gán nhãn sơ đồ (gõ)
  diagram_labelling: [
    {
      program: 'ielts',
      content: {
        type: 'diagram_labelling',
        stem: 'Label the diagram below. Write ONE WORD ONLY for each answer.',
        word_limit: { max_words: 1 },
        title: 'Rainwater collection at the tool shed',
        image_asset_id: IMG(2),
        image_alt: 'Diagram of a garden shed with a sloping roof. Along the bottom edge of the roof on the right is label 1. Water runs from it down a vertical pipe on the right side of the shed into a box, label 2, which sits on top of a large blue tank. At the bottom left of the tank is a small outlet, label 3.',
        labels: [
          { id: '1', x: 77.5, y: 29, description: 'Label 1: the channel along the edge of the shed roof' },
          { id: '2', x: 92, y: 61, description: 'Label 2: the box between the pipe and the top of the tank' },
          { id: '3', x: 72, y: 88, description: 'Label 3: the outlet at the bottom of the tank' },
        ],
        answer_key: { gaps: { '1': { accepted: ['gutter'] }, '2': { accepted: ['filter'] }, '3': { accepted: ['tap'] } } },
        explanation: { vi: 'Nước mưa: gutter → pipe → filter → tank; lấy nước ở tap dưới đáy bồn.', en: 'Rain: gutter → pipe → filter → tank; water is taken from the tap at the bottom.' },
        tags: ['ielts:listening', 'diagram_labelling'],
      },
      correct_answer: { type: 'diagram_labelling', gaps: { '1': 'gutter', '2': 'Filter', '3': 'tap' } },
      wrong_answer: { type: 'diagram_labelling', gaps: { '1': 'roof', '2': 'pump', '3': 'pipe' } },
      partial_answer: { type: 'diagram_labelling', gaps: { '1': 'gutter', '2': 'tank', '3': 'tap' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
    {
      program: 'ielts',
      content: {
        type: 'diagram_labelling',
        stem: 'Write ONE WORD ONLY.',
        word_limit: { max_words: 1 },
        image_asset_id: IMG(3),
        image_alt: 'A simple drawing of a lighthouse with a light at the top (label a).',
        labels: [{ id: 'a', x: 50, y: 10, description: 'Label a: the top of the tower' }],
        answer_key: { gaps: { a: { accepted: ['lantern'] } } },
      },
      correct_answer: { type: 'diagram_labelling', gaps: { a: 'Lantern' } },
      wrong_answer: { type: 'diagram_labelling', gaps: { a: 'glass lantern' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'diagram_labelling',
        stem: 'Write NO MORE THAN TWO WORDS.',
        word_limit: { max_words: 2 },
        image_asset_id: IMG(4),
        image_alt: 'Cross-section of a solar oven: a reflective lid (1) above an insulated box (2).',
        labels: [
          { id: '1', x: 50, y: 15, description: 'Label 1: the lid' },
          { id: '2', x: 50, y: 70, description: 'Label 2: the box walls' },
        ],
        answer_key: { gaps: { '1': { accepted: ['reflective lid', 'mirror'] }, '2': { accepted: ['insulation'] } } },
      },
      correct_answer: { type: 'diagram_labelling', gaps: { '1': 'mirror', '2': 'insulation' } },
      wrong_answer: { type: 'diagram_labelling', gaps: { '1': 'lid', '2': 'wood' } },
      partial_answer: { type: 'diagram_labelling', gaps: { '1': 'reflective lid', '2': 'metal' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
  // ------------------------------------------------------------------------- Tóm tắt chọn từ ngân hàng
  summary_word_bank: [
    {
      program: 'ielts',
      content: {
        type: 'summary_word_bank',
        stem: 'Complete the summary using the list of words, A–G, below.',
        title: 'The value of seed libraries',
        text: 'A council survey suggested that seed libraries help people make new {{1}}, and many borrowers had begun sharing {{2}} and extra produce. However, an economist believes the {{3}} for households are small.',
        bank: [
          { key: 'A', text: 'contacts' },
          { key: 'B', text: 'tools' },
          { key: 'C', text: 'savings' },
          { key: 'D', text: 'profits' },
          { key: 'E', text: 'plants' },
          { key: 'F', text: 'workshops' },
          { key: 'G', text: 'volunteers' },
        ],
        answer_key: { gaps: { '1': 'A', '2': 'B', '3': 'C' } },
        explanation: { vi: '"met new people" ≈ contacts; "sharing tools"; "financial savings ... are modest".', en: '"met new people" ≈ contacts; "sharing tools"; "financial savings are modest".' },
        tags: ['ielts:reading', 'summary_word_bank'],
      },
      correct_answer: { type: 'summary_word_bank', gaps: { '1': 'A', '2': 'B', '3': 'C' } },
      wrong_answer: { type: 'summary_word_bank', gaps: { '1': 'G', '2': 'E', '3': 'D' } },
      partial_answer: { type: 'summary_word_bank', gaps: { '1': 'A', '2': 'E', '3': 'D' } },
      expected: { correct: 1, wrong: 0, partial: 0.333 },
    },
    {
      // Dùng một từ cho hai chỗ trống khi không cho phép → cả hai sai
      program: 'ielts',
      content: {
        type: 'summary_word_bank',
        stem: 'Choose the correct word, A–D.',
        text: 'The scheme is both {{1}} and {{2}}.',
        bank: [
          { key: 'A', text: 'cheap' },
          { key: 'B', text: 'popular' },
          { key: 'C', text: 'new' },
          { key: 'D', text: 'slow' },
        ],
        answer_key: { gaps: { '1': 'A', '2': 'B' } },
      },
      correct_answer: { type: 'summary_word_bank', gaps: { '1': 'A', '2': 'B' } },
      wrong_answer: { type: 'summary_word_bank', gaps: { '1': 'A', '2': 'A' } },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'summary_word_bank',
        stem: 'Choose the correct word. You may use any word more than once.',
        text: 'Both the {{1}} and the {{2}} were {{3}}.',
        bank: [
          { key: 'A', text: 'repaired' },
          { key: 'B', text: 'roof' },
          { key: 'C', text: 'walls' },
        ],
        allow_reuse: true,
        answer_key: { gaps: { '1': 'B', '2': 'C', '3': 'A' } },
      },
      correct_answer: { type: 'summary_word_bank', gaps: { '1': 'B', '2': 'C', '3': 'A' } },
      wrong_answer: { type: 'summary_word_bank', gaps: { '1': 'A', '2': 'A', '3': 'B' } },
      partial_answer: { type: 'summary_word_bank', gaps: { '1': 'B', '2': 'B', '3': 'A' } },
      expected: { correct: 1, wrong: 0, partial: 0.667 },
    },
  ],
  // ------------------------------------------------------------------------- Bản đồ / mặt bằng
  plan_map_labelling: [
    {
      program: 'ielts',
      content: {
        type: 'plan_map_labelling',
        stem: 'Label the map below. Choose the correct letter, A–F, for each place.',
        kind: 'map',
        title: 'Harbourview Community Garden',
        image_asset_id: IMG(1),
        image_alt: 'Map of a rectangular garden. The main gate is in the middle of the bottom (south) edge. Six letters are marked: A in the top-left corner, B to the right of A along the top edge, C in the middle of the right (east) side, D in the centre of the garden, E in the bottom-left corner near the gate, F in the bottom-right corner.',
        markers: [
          { key: 'A', x: 15, y: 18, description: 'A: top-left corner' },
          { key: 'B', x: 37.5, y: 18, description: 'B: top edge, right of A' },
          { key: 'C', x: 82.5, y: 50, description: 'C: middle of the east side' },
          { key: 'D', x: 50, y: 50, description: 'D: centre of the garden' },
          { key: 'E', x: 18.75, y: 78, description: 'E: bottom-left, near the main gate' },
          { key: 'F', x: 80, y: 78, description: 'F: bottom-right corner' },
        ],
        items: [
          { key: '1', text: 'Greenhouse' },
          { key: '2', text: 'Compost bins' },
          { key: '3', text: 'Tool shed' },
          { key: '4', text: 'Pond' },
        ],
        answer_key: { values: { '1': 'A', '2': 'B', '3': 'C', '4': 'E' } },
        explanation: { vi: 'Greenhouse góc trên trái (A), compost ngay bên phải (B), tool shed giữa cạnh đông (C), pond gần cổng bên trái (E).', en: 'Greenhouse top left (A), compost to its right (B), shed on the east side (C), pond near the gate on the left (E).' },
        tags: ['ielts:listening', 'plan_map_labelling'],
      },
      correct_answer: { type: 'plan_map_labelling', values: { '1': 'A', '2': 'B', '3': 'C', '4': 'E' } },
      wrong_answer: { type: 'plan_map_labelling', values: { '1': 'F', '2': 'D', '3': 'A', '4': 'B' } },
      partial_answer: { type: 'plan_map_labelling', values: { '1': 'A', '2': 'B', '3': 'D', '4': 'F' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
    {
      program: 'ielts',
      content: {
        type: 'plan_map_labelling',
        stem: 'Label the plan. Choose the correct letter.',
        kind: 'plan',
        image_asset_id: IMG(5),
        image_alt: 'Floor plan of a museum ground floor with rooms A, B and C from left to right.',
        markers: [
          { key: 'A', x: 20, y: 50 },
          { key: 'B', x: 50, y: 50 },
          { key: 'C', x: 80, y: 50 },
        ],
        items: [{ key: '1', text: 'Café' }],
        answer_key: { values: { '1': 'C' } },
      },
      correct_answer: { type: 'plan_map_labelling', values: { '1': 'C' } },
      wrong_answer: { type: 'plan_map_labelling', values: {} },
      expected: { correct: 1, wrong: 0 },
    },
    {
      program: 'ielts',
      content: {
        type: 'plan_map_labelling',
        stem: 'Label the map.',
        image_asset_id: IMG(6),
        image_alt: 'Map of a small island with a harbour (A), a lighthouse (B) and a beach (C).',
        markers: [
          { key: 'A', x: 10, y: 80 },
          { key: 'B', x: 90, y: 10 },
          { key: 'C', x: 50, y: 90 },
        ],
        items: [
          { key: '1', text: 'Ferry stop' },
          { key: '2', text: 'Viewpoint' },
        ],
        answer_key: { values: { '1': 'A', '2': 'B' } },
      },
      correct_answer: { type: 'plan_map_labelling', values: { '1': 'A', '2': 'B' } },
      wrong_answer: { type: 'plan_map_labelling', values: { '1': 'C', '2': 'C' } },
      partial_answer: { type: 'plan_map_labelling', values: { '1': 'A', '2': 'C' } },
      expected: { correct: 1, wrong: 0, partial: 0.5 },
    },
  ],
};

/** mcq_multi "Choose TWO letters" (IELTS) – thêm vào fixture mcq_multi */
export const RL_MCQ_MULTI_CHOOSE_TWO: RawRlFixture = {
  program: 'ielts',
  content: {
    type: 'mcq_multi',
    stem: 'Which TWO things should new members bring on their first day?',
    select_count: 2,
    options: [
      { key: 'A', text: 'gloves' },
      { key: 'B', text: 'seeds' },
      { key: 'C', text: 'a garden fork' },
      { key: 'D', text: 'a bottle of water' },
      { key: 'E', text: 'a packed lunch' },
    ],
    answer_key: { correct: ['A', 'D'], scoring: 'partial', penalize_extra: false },
    explanation: { vi: '"please bring gloves and a bottle of water. We provide all the tools and seeds."', en: '"bring gloves and a bottle of water; tools and seeds are provided".' },
    tags: ['ielts:listening', 'mcq_multi', 'choose_two'],
  },
  correct_answer: { type: 'mcq_multi', selected: ['D', 'A'] },
  wrong_answer: { type: 'mcq_multi', selected: ['B', 'C'] },
  partial_answer: { type: 'mcq_multi', selected: ['A', 'B'] },
  expected: { correct: 1, wrong: 0, partial: 0.5 },
};

/** mcq_single + TFNG/YNNG cho đề mẫu IELTS (dạng đã có từ S1, bổ sung nội dung IELTS) */
export const RL_DEMO_EXTRA: RawRlFixture[] = [
  {
    program: 'ielts',
    content: {
      type: 'mcq_single',
      stem: 'Why is Daniel calling the garden?',
      options: [
        { key: 'A', text: 'to book a workshop' },
        { key: 'B', text: 'to register for a plot' },
        { key: 'C', text: 'to complain about the rules' },
      ],
      answer_key: { correct: 'B' },
      explanation: { vi: '"I\'d like to register for a garden plot."', en: '"I\'d like to register for a garden plot."' },
      tags: ['ielts:listening', 'mcq_single'],
    },
    correct_answer: { type: 'mcq_single', selected: 'B' },
    wrong_answer: { type: 'mcq_single', selected: 'A' },
    expected: { correct: 1, wrong: 0 },
  },
  {
    program: 'ielts',
    content: {
      type: 'tfng',
      variant: 'tfng',
      stem: 'Do the following statements agree with the information given in the reading passage?',
      statements: [
        { key: '1', text: 'The Wexley seed library opened in 2015.' },
        { key: '2', text: 'Dr Ellison used to work for a commercial seed company.' },
        { key: '3', text: 'All plants produce seeds that grow true to type.' },
      ],
      answer_key: { values: { '1': 'true', '2': 'not_given', '3': 'false' } },
      explanation: { vi: '1: "Since 2015"; 2: bài chỉ nói bà là nhà thực vật học đã nghỉ hưu; 3: "may not grow true to type".', en: '1: "Since 2015"; 2: only "retired botanist"; 3: "may not grow true to type".' },
      tags: ['ielts:reading', 'tfng'],
    },
    correct_answer: { type: 'tfng', values: { '1': 'true', '2': 'not_given', '3': 'false' } },
    wrong_answer: { type: 'tfng', values: { '1': 'false', '2': 'true', '3': 'not_given' } },
    expected: { correct: 1, wrong: 0 },
  },
  {
    program: 'ielts',
    content: {
      type: 'tfng',
      variant: 'ynng',
      stem: 'Do the following statements agree with the views of the writer?',
      statements: [
        { key: '1', text: 'The information collected may prove more important than the seeds themselves.' },
        { key: '2', text: 'Every town in the region should open a seed library.' },
      ],
      answer_key: { values: { '1': 'true', '2': 'not_given' } },
      explanation: { vi: '1: "greatest contribution will be the knowledge it gathers"; 2: tác giả không nêu ý kiến này.', en: '1: "greatest contribution will be the knowledge"; 2: not stated.' },
      tags: ['ielts:reading', 'ynng'],
    },
    correct_answer: { type: 'tfng', values: { '1': 'true', '2': 'not_given' } },
    wrong_answer: { type: 'tfng', values: { '1': 'false', '2': 'false' } },
    expected: { correct: 1, wrong: 0 },
  },
];
