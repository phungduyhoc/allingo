import { linesOf, type IeltsFullSection, type IeltsScriptSegment } from './types.js';

/**
 * Listening 01 – Part 3 (Questions 21–30, sinh viên thảo luận dự án với giảng viên) và Part 4 (Questions 31–40, bài giảng lịch sử
 * đèn đường). Tự biên soạn; Riverside College và mọi nhân vật là hư cấu.
 */

const ONCE = { listen_policy: 'once' } as const;

// --------------------------------------------------------------------------- Part 3

export const LISTENING_01_P3_SCRIPT: readonly IeltsScriptSegment[] = [
  { speaker: 'N', accent: 'us', name: 'Narrator', text: 'Part 3. You will hear two students, Maya and Tom, talking to their tutor, Dr Price, about their project on food waste in the university canteen. Listen and answer questions 21 to 30.' },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: "Come in, both of you. So, you've finished collecting your data on food waste in the canteen. How did the different methods work out?" },
  { speaker: 'W1', accent: 'au', name: 'Maya', text: "Well, we started with the questionnaire. Lots of students filled it in, but when we compared their answers with what we actually saw, they'd clearly underestimated how much they threw away. So we can't really trust those results." },
  { speaker: 'M2', accent: 'us', name: 'Tom', text: 'The interviews with the kitchen staff were much better. They told us exactly which dishes came back half-eaten, and in the end that gave us the most useful information of the whole project.' },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: 'And the weighing?' },
  { speaker: 'W1', accent: 'au', name: 'Maya', text: "That was harder than we thought. We planned to do it in a week, but sorting and weighing every tray took nearly three weeks. It didn't cost anything extra, though – the canteen lent us their scales." },
  { speaker: 'M2', accent: 'us', name: 'Tom', text: "The photo diary was interesting. We asked ten students to photograph their trays before they cleared them. Most of them were amazed when they looked back at the pictures and saw how much they'd left." },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: 'And you compared the results with the canteen at Riverside College?' },
  { speaker: 'W1', accent: 'au', name: 'Maya', text: "We did, but we only had data from December, when everyone's busy with exams. We think it would be worth doing it again in the summer term to see if the pattern is the same." },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: 'Good. Now, your presentation is next week. Having seen the draft, I think the introduction is far too long – you take five minutes before you get to your findings.' },
  { speaker: 'M2', accent: 'us', name: 'Tom', text: "We'll cut it down, then. Should we add a video of the canteen?" },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: "I wouldn't – the equipment in that room is unreliable. What would help is more charts. Your numbers are hard to follow when they're just read out." },
  { speaker: 'W1', accent: 'au', name: 'Maya', text: "OK, more charts and a shorter introduction. We were also going to drop the photo section, but people seemed to like it in our practice run, so we'll keep it." },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: 'Yes, keep it. And what are you going to recommend to the canteen?' },
  { speaker: 'M2', accent: 'us', name: 'Tom', text: "We thought about suggesting cheaper desserts, but the manager said prices are fixed by the university, so that's not realistic. Our first recommendation is smaller plates, because people take less when the plate is smaller." },
  { speaker: 'W1', accent: 'au', name: 'Maya', text: "And we'd like them to put up a board showing how much food was thrown away each day. We also discussed a scheme with reusable containers for leftovers, but the kitchen staff said there's nowhere to wash them." },
  { speaker: 'M1', accent: 'uk', name: 'Dr Price', text: "Sensible. Finally, don't forget the written report. The presentation is on Wednesday, but the report isn't due until Friday, so you'll have time to include any feedback." },
  { speaker: 'M2', accent: 'us', name: 'Tom', text: 'Friday – great. Thanks, Dr Price.' },
];
const P3 = LISTENING_01_P3_SCRIPT;

export const LISTENING_01_P3: IeltsFullSection = {
  section_code: 'listening_p3',
  group_key: 'ielts-l01-p3',
  topic: 'education',
  passage: { kind: 'audio_script', title: 'A student project on canteen food waste', segments: P3 },
  questions: [
    {
      key: 'ielts-l01-q21-25-features',
      difficulty: 'B2',
      content: {
        type: 'matching_features',
        stem: 'Questions 21–25. What do the students say about each research method? Choose FIVE answers from the list and write the correct letter, A–F, next to Questions 21–25.',
        options_title: 'Comments',
        media: ONCE,
        items: [
          { key: '21', text: 'the questionnaire' },
          { key: '22', text: 'the interviews with kitchen staff' },
          { key: '23', text: 'weighing the waste' },
          { key: '24', text: 'the photo diary' },
          { key: '25', text: 'the comparison with another canteen' },
        ],
        options: [
          { key: 'A', text: 'It took longer than expected.' },
          { key: 'B', text: 'It produced the most useful data.' },
          { key: 'C', text: 'It should be repeated at a different time of year.' },
          { key: 'D', text: 'Its results were unreliable.' },
          { key: 'E', text: 'It cost more than planned.' },
          { key: 'F', text: 'It surprised the participants.' },
        ],
        allow_reuse: false,
        answer_key: { pairs: { '21': 'D', '22': 'B', '23': 'A', '24': 'F', '25': 'C' } },
        explanation: {
          vi: '21: sinh viên ước lượng thấp → "can\'t really trust" (D); 22: "the most useful information" (B); 23: dự kiến 1 tuần nhưng mất gần 3 tuần (A) – không tốn thêm tiền nên E sai; 24: người tham gia "amazed" (F); 25: chỉ có dữ liệu tháng 12, nên làm lại kỳ hè (C).',
          en: '21: D (students underestimated); 22: B (most useful); 23: A (three weeks, not one; no extra cost); 24: F (participants amazed); 25: C (repeat in the summer term).',
        },
        evidence: linesOf(P3, 2, 3, 5, 6, 8),
        tags: ['ielts:listening', 'matching_features'],
      },
    },
    {
      key: 'ielts-l01-q26-27-presentation',
      difficulty: 'B2',
      content: {
        type: 'mcq_multi',
        stem: 'Questions 26–27. Choose TWO letters, A–E. Which TWO changes will the students make to their presentation?',
        select_count: 2,
        media: ONCE,
        options: [
          { key: 'A', text: 'shorten the introduction' },
          { key: 'B', text: 'add a video of the canteen' },
          { key: 'C', text: 'include more charts' },
          { key: 'D', text: 'remove the photo section' },
          { key: 'E', text: 'hand out printed notes' },
        ],
        answer_key: { correct: ['A', 'C'], scoring: 'partial', penalize_extra: false },
        explanation: { vi: '"more charts and a shorter introduction"; không thêm video (thiết bị kém), giữ phần ảnh.', en: 'More charts and a shorter introduction; no video, and the photo section stays.' },
        evidence: linesOf(P3, 9, 11, 12),
        tags: ['ielts:listening', 'mcq_multi', 'choose_two'],
      },
    },
    {
      key: 'ielts-l01-q28-29-recommendations',
      difficulty: 'B2',
      content: {
        type: 'mcq_multi',
        stem: 'Questions 28–29. Choose TWO letters, A–E. Which TWO recommendations will the students make to the canteen?',
        select_count: 2,
        media: ONCE,
        options: [
          { key: 'A', text: 'use smaller plates' },
          { key: 'B', text: 'reduce the price of desserts' },
          { key: 'C', text: 'start a reusable container scheme' },
          { key: 'D', text: 'display daily waste figures' },
          { key: 'E', text: 'open the canteen for longer' },
        ],
        answer_key: { correct: ['A', 'D'], scoring: 'partial', penalize_extra: false },
        explanation: { vi: 'Đĩa nhỏ hơn và bảng hiển thị lượng thức ăn bỏ đi mỗi ngày; giá món tráng miệng do trường quy định, hộp tái sử dụng không có chỗ rửa.', en: 'Smaller plates and a board showing daily waste; dessert prices are fixed and containers cannot be washed.' },
        evidence: linesOf(P3, 14, 15),
        tags: ['ielts:listening', 'mcq_multi', 'choose_two'],
      },
    },
    {
      key: 'ielts-l01-q30-short',
      difficulty: 'B1',
      content: {
        type: 'short_answer',
        stem: 'Question 30. Answer the question below. Write ONE WORD ONLY for your answer.',
        media: ONCE,
        word_limit: { max_words: 1 },
        questions: [{ id: '30', text: 'On which day must the written report be submitted?' }],
        answer_key: { gaps: { '30': { accepted: ['Friday'] } } },
        explanation: { vi: 'Thuyết trình thứ Tư, báo cáo viết hạn thứ Sáu.', en: 'The presentation is on Wednesday; the report is due on Friday.' },
        evidence: linesOf(P3, 16),
        tags: ['ielts:listening', 'short_answer'],
      },
    },
  ],
};

// --------------------------------------------------------------------------- Part 4

export const LISTENING_01_P4_SCRIPT: readonly IeltsScriptSegment[] = [
  { speaker: 'N', accent: 'us', name: 'Narrator', text: 'Part 4. You will hear a lecture about the history of street lighting. Listen and answer questions 31 to 40.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: "Good morning. Today I'm going to talk about something most of us never think about: the lights that line our streets at night. Their history tells us a great deal about how cities have changed." },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: "For most of history, streets were simply dark after sunset. In the fifteenth century, some European cities introduced rules requiring householders to hang a lantern outside their door after dark. Not everyone obeyed, of course, and the light from a single candle didn't reach far." },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'Later, many towns installed public oil lamps. These were an improvement, but the light they gave was weak, and they produced a great deal of smoke, which blackened the glass and had to be cleaned off every day.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'The real change came with gas. Although experiments began earlier, gas street lamps spread rapidly through the cities of Europe and North America in the nineteenth century. For the first time, main streets could be lit brightly enough for people to feel safe walking at night.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: "Each lamp had to be lit by hand, and this was the job of the lamplighter. Lamplighters didn't carry ladders, as people often imagine; instead they used a long pole, which allowed them to reach each lamp from the ground." },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'So how was a gas lamp lit? The lamplighter arrived at dusk and first opened a valve, which let the gas flow up to the burner. Then he held the small flame on the end of his pole to the mantle, a fine mesh that glowed brightly when heated. Finally, he closed the little glass door, which protected the flame from the wind. At dawn he came back and turned the gas off again.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'Electric light arrived towards the end of the century. The first electric street lamps produced light from an arc between two carbon rods. The light was intensely bright – far too bright, in fact, for narrow streets, where it dazzled people rather than helping them.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'Filament bulbs, which came next, were gentler and cheaper to run, but they burned out quickly and needed frequent replacement, which kept maintenance crews very busy.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: 'Today, many cities are replacing their old lamps with LEDs. These use far less electricity, and, importantly, they can be dimmed late at night when the streets are quiet, saving even more energy. Some can even brighten automatically when a pedestrian approaches.' },
  { speaker: 'W2', accent: 'uk', name: 'Lecturer', text: "In the next lecture, we'll look at the effect of all this artificial light on wildlife." },
];
const P4 = LISTENING_01_P4_SCRIPT;

export const LISTENING_01_P4: IeltsFullSection = {
  section_code: 'listening_p4',
  group_key: 'ielts-l01-p4',
  topic: 'technology',
  passage: { kind: 'audio_script', title: 'Lecture: the history of street lighting', segments: P4 },
  questions: [
    {
      key: 'ielts-l01-q31-34-notes',
      difficulty: 'B2',
      content: {
        type: 'note_completion',
        stem: 'Questions 31–34. Complete the notes below. Write ONE WORD ONLY for each answer.',
        title: 'The history of street lighting',
        media: ONCE,
        word_limit: { max_words: 1 },
        lines: [
          { text: 'Before gas', level: 0, heading: true },
          { text: '1400s: householders in some cities had to hang a {{31}} outside their door after dark', level: 1 },
          { text: 'Oil lamps: weak light; produced a lot of {{32}}, so the glass needed daily cleaning', level: 1 },
          { text: 'Gas lighting', level: 0, heading: true },
          { text: 'Gas street lamps spread quickly in the {{33}} century', level: 1 },
          { text: 'Lamplighters reached each lamp using a long {{34}}', level: 1 },
        ],
        answer_key: { gaps: { '31': { accepted: ['lantern'] }, '32': { accepted: ['smoke'] }, '33': { accepted: ['nineteenth', '19th'] }, '34': { accepted: ['pole'] } } },
        explanation: { vi: '31: "hang a lantern outside their door"; 32: "a great deal of smoke"; 33: "in the nineteenth century"; 34: không dùng thang mà "a long pole".', en: '31: lantern; 32: smoke; 33: nineteenth century; 34: a long pole, not a ladder.' },
        evidence: linesOf(P4, 2, 3, 4, 5),
        tags: ['ielts:listening', 'note_completion'],
      },
    },
    {
      key: 'ielts-l01-q35-37-flow',
      difficulty: 'B2',
      content: {
        type: 'flow_chart_completion',
        stem: 'Questions 35–37. Complete the flow-chart below. Write ONE WORD ONLY for each answer.',
        title: 'Lighting a gas lamp',
        media: ONCE,
        word_limit: { max_words: 1 },
        steps: [
          { text: 'The lamplighter arrives at dusk.' },
          { text: 'He opens a {{35}} so that gas flows to the burner.' },
          { text: 'He holds the flame on his pole to the {{36}}, which glows when heated.' },
          { text: 'He closes the glass door to protect the flame from the {{37}}.' },
          { text: 'At dawn, he returns and turns the gas off.' },
        ],
        answer_key: { gaps: { '35': { accepted: ['valve'] }, '36': { accepted: ['mantle'] }, '37': { accepted: ['wind'] } } },
        explanation: { vi: '"first opened a valve" → "held the small flame… to the mantle" → "protected the flame from the wind".', en: 'Valve, then mantle, then the door protects the flame from the wind.' },
        evidence: linesOf(P4, 6),
        tags: ['ielts:listening', 'flow_chart_completion'],
      },
    },
    {
      key: 'ielts-l01-q38-40-summary',
      difficulty: 'C1',
      content: {
        type: 'summary_completion',
        stem: 'Questions 38–40. Complete the summary below. Write NO MORE THAN TWO WORDS for each answer.',
        title: 'Electric street lighting',
        media: ONCE,
        word_limit: { max_words: 2 },
        text: 'The first electric street lamps produced light from an arc between two {{38}}. This light was so bright that it was unsuitable for narrow streets. Filament bulbs were cheaper to run, but they needed frequent {{39}}. Today, many cities are installing LED lamps, which can be {{40}} late at night to save energy.',
        answer_key: { gaps: { '38': { accepted: ['(carbon) rods'] }, '39': { accepted: ['replacement'] }, '40': { accepted: ['dimmed'] } } },
        explanation: { vi: '38: "an arc between two carbon rods"; 39: "needed frequent replacement"; 40: "they can be dimmed late at night".', en: '38: carbon rods; 39: replacement; 40: dimmed.' },
        evidence: linesOf(P4, 7, 8, 9),
        tags: ['ielts:listening', 'summary_completion'],
      },
    },
  ],
};
