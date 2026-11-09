import { ieltsFullImageId, linesOf, type IeltsFullImage, type IeltsFullSection, type IeltsScriptSegment } from './types.js';

/**
 * Listening 01 – Part 1 (Questions 1–10, hội thoại đặt nhà nghỉ) và Part 2 (Questions 11–20, độc thoại giới thiệu khu đất ngập nước).
 * Tự biên soạn; Fernley Bay, Thornbury Wetland Centre và mọi nhân vật là hư cấu.
 */

const ONCE = { listen_policy: 'once' } as const;

// --------------------------------------------------------------------------- Part 1

export const LISTENING_01_P1_SCRIPT: readonly IeltsScriptSegment[] = [
  { speaker: 'N', accent: 'us', name: 'Narrator', text: 'Part 1. You will hear a woman calling Fernley Bay Holiday Cottages to book a holiday. Listen and answer questions 1 to 10.' },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: 'Good afternoon, Fernley Bay Holiday Cottages, Sam speaking. How can I help?' },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Oh, hello. I'd like to book one of your cottages for a week this summer, please." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: 'Of course. Can I start with your name?' },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Yes, it's Laura Penhallow. That's P-E-N-H-A-L-L-O-W." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: 'Thank you, Ms Penhallow. And how many people will be staying?' },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "There'll be four of us at first, but my sister has decided to come along as well, so could you put down five, please?" },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: 'Five guests, no problem. And when would you like to arrive?' },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "We were thinking of the 7th of June, but my husband can't get away then, so it'll have to be the 14th of July." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "The 14th of July, for one week. Let me see what's free. Kestrel Cottage is already taken that week, I'm afraid, but Heron Cottage is available, and it sleeps six." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Heron Cottage sounds lovely. We'll take that one." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "Great. Is there anything special you'll need during your stay?" },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Well, we're bringing our baby daughter, so we'll need a cot. We don't need a high chair, though – we'll bring our own." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "I'll make sure a cot is put in the main bedroom. Now, the total for the week comes to four hundred and eighty pounds, and we ask for a deposit to secure the booking." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: 'How much is the deposit?' },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "It's one hundred and twenty pounds, and the rest is due two weeks before you arrive." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "That's fine. Could you tell me a bit about the area? We've never been to Fernley Bay before." },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "Certainly. Parking in the village is limited, but there's a free car park next to the church, just two minutes' walk from the cottage. Don't use the one behind the post office – that's for residents only." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: 'Good to know. Are there boat trips? My son loves boats.' },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: 'Yes, boat trips leave every morning from the old harbour, at the far end of the beach. You can buy tickets on the boat.' },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: 'And is there anywhere to buy local food?' },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "There's a farmers' market in the square. It used to be on Fridays, but now it's held every Saturday, from eight until one." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Perfect. And we're keen walkers – is the coastal path easy to follow?" },
  { speaker: 'M1', accent: 'au', name: 'Sam', text: "It's well signposted, but I'd recommend proper boots. The path can be very muddy after rain, especially near the cliffs." },
  { speaker: 'W1', accent: 'uk', name: 'Laura', text: "Thanks, Sam, that's really helpful." },
];
const P1 = LISTENING_01_P1_SCRIPT;

export const LISTENING_01_P1: IeltsFullSection = {
  section_code: 'listening_p1',
  group_key: 'ielts-l01-p1',
  topic: 'travel',
  passage: { kind: 'audio_script', title: 'Booking a holiday cottage', segments: P1 },
  questions: [
    {
      key: 'ielts-l01-q01-06-form',
      difficulty: 'B1',
      content: {
        type: 'form_completion',
        stem: 'Questions 1–6. Complete the form below. Write ONE WORD AND/OR A NUMBER for each answer.',
        title: 'Fernley Bay Holiday Cottages – Booking form',
        media: ONCE,
        word_limit: { max_words: 1, allow_number: true },
        fields: [
          { label: 'Name', value: 'Laura {{1}}' },
          { label: 'Number of guests', value: '{{2}}' },
          { label: 'Arrival date', value: '14th {{3}}' },
          { label: 'Length of stay', value: 'one week' },
          { label: 'Cottage', value: '{{4}} Cottage' },
          { label: 'Extra item needed', value: 'a {{5}} for the baby' },
          { label: 'Deposit', value: '£{{6}}' },
        ],
        answer_key: {
          gaps: {
            '1': { accepted: ['Penhallow'] },
            '2': { accepted: ['5', 'five'] },
            '3': { accepted: ['July'] },
            '4': { accepted: ['Heron'] },
            '5': { accepted: ['cot'] },
            '6': { accepted: ['120'] },
          },
        },
        explanation: {
          vi: '1: đánh vần P-E-N-H-A-L-L-O-W; 2: ban đầu 4 người nhưng thêm em gái → 5; 3: không phải 7/6 mà 14/7; 4: Kestrel đã kín → Heron; 5: cần nôi (cot), không cần ghế ăn; 6: tổng 480 nhưng đặt cọc 120.',
          en: '1: spelled P-E-N-H-A-L-L-O-W; 2: four plus her sister = five; 3: not June, 14th July; 4: Kestrel is taken, so Heron; 5: a cot (not a high chair); 6: the total is £480 but the deposit is £120.',
        },
        evidence: linesOf(P1, 4, 6, 8, 9, 12, 15),
        tags: ['ielts:listening', 'form_completion'],
      },
    },
    {
      key: 'ielts-l01-q07-10-notes',
      difficulty: 'B1',
      content: {
        type: 'note_completion',
        stem: 'Questions 7–10. Complete the notes below. Write ONE WORD ONLY for each answer.',
        title: 'Information for guests',
        media: ONCE,
        word_limit: { max_words: 1 },
        lines: [
          { text: 'Getting around', level: 0, heading: true },
          { text: 'Parking: free car park next to the {{7}}', level: 1 },
          { text: 'Boat trips: leave every morning from the old {{8}}', level: 1 },
          { text: 'Shopping and walking', level: 0, heading: true },
          { text: "Farmers' market: held every {{9}}", level: 1 },
          { text: 'Coastal path: wear boots – can be very {{10}} after rain', level: 1 },
        ],
        answer_key: { gaps: { '7': { accepted: ['church'] }, '8': { accepted: ['harbour'] }, '9': { accepted: ['Saturday'] }, '10': { accepted: ['muddy'] } }, spelling_variants: true },
        explanation: { vi: '7: bãi xe cạnh nhà thờ (bãi sau bưu điện chỉ cho cư dân); 8: "the old harbour"; 9: trước là thứ Sáu, nay thứ Bảy; 10: "can be very muddy after rain".', en: '7: next to the church (not the post office); 8: the old harbour; 9: now Saturday, not Friday; 10: muddy after rain.' },
        evidence: linesOf(P1, 17, 19, 21, 23),
        tags: ['ielts:listening', 'note_completion'],
      },
    },
  ],
};

// --------------------------------------------------------------------------- Part 2

export const LISTENING_01_P2_SCRIPT: readonly IeltsScriptSegment[] = [
  { speaker: 'N', accent: 'us', name: 'Narrator', text: 'Part 2. You will hear a guide welcoming visitors to Thornbury Wetland Centre. Listen and answer questions 11 to 20.' },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "Good morning, everyone, and welcome to Thornbury Wetland Centre. My name's Claire, and I'll be your guide this morning. Before we set off, I'd like to tell you a little about the centre and how to find your way around." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: 'Many visitors assume that this land was always farmland, but in fact it was a sand quarry until the late nineteen-nineties. When the quarry closed, the pits filled with water, and that is how our lakes were created.' },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "We're always developing the site. Last year we opened the café by the lake, and this year we've added something visitors have asked for many times: a new bird hide with live cameras, so you can watch nesting birds on a screen without disturbing them." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "Now, a few requests. Dogs aren't allowed on the reserve at all, apart from assistance dogs, and we ask you not to feed the ducks bread. Most importantly, please stay on the boardwalks at all times, because the ground around the reed beds is softer than it looks." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "People often ask about our otters. They're shy animals, and you're unlikely to see them in the middle of the day. Some guides will tell you to come at dawn, but in our experience the late evening, just before the centre closes, gives you the best chance." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "Right, let's look at the map. We're standing at the main entrance, at the bottom of the map. Just inside the entrance, on the path straight ahead of you, is the first aid point, so if anyone feels unwell, that's the place to go." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "If you turn left as you come in and follow the hedge, you'll reach the picnic area in the bottom left-hand corner of the site. There are plenty of tables there." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "On the opposite side, in the bottom right-hand corner beside the car park fence, you'll find the bicycle racks, so cyclists can leave their bikes there." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: 'The pond-dipping platform, where children can look for insects and frogs, is on the western side of the large lake, about halfway up the map on the left.' },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: 'Our new bird hide is right at the top of the map, in the middle of the northern shore, looking south across the water.' },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "And finally, if you're hoping to see otters, take the path to the top right-hand corner. The otter viewing point is there, beside the stream where it enters the lake." },
  { speaker: 'W2', accent: 'ca', name: 'Guide', text: "Right, if everyone's ready, let's head off towards the lake." },
];
const P2 = LISTENING_01_P2_SCRIPT;

const marker = (key: string, x: number, y: number) =>
  `<circle cx="${x * 8}" cy="${y * 6}" r="20" fill="#0b3ba7"/><text x="${x * 8}" y="${y * 6 + 8}" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#fff">${key}</text>`;

const MAP_MARKERS = [
  { key: 'A', x: 20, y: 22, description: 'A: top-left corner' },
  { key: 'B', x: 50, y: 14, description: 'B: top of the map, middle of the northern shore of the lake' },
  { key: 'C', x: 82, y: 20, description: 'C: top-right corner, where the stream enters the lake' },
  { key: 'D', x: 18, y: 50, description: 'D: left side, halfway up, on the western shore of the lake' },
  { key: 'E', x: 50, y: 48, description: 'E: small island in the centre of the lake' },
  { key: 'F', x: 84, y: 52, description: 'F: right side, halfway up, east of the lake' },
  { key: 'G', x: 15, y: 84, description: 'G: bottom-left corner, along the hedge from the entrance' },
  { key: 'H', x: 86, y: 84, description: 'H: bottom-right corner, beside the car park fence' },
  { key: 'I', x: 50, y: 76, description: 'I: on the path straight ahead, just inside the main entrance' },
] as const;

export const LISTENING_P2_MAP: IeltsFullImage = {
  key: 'ielts-listening-01:map',
  placeholder_id: ieltsFullImageId(2),
  alt: { vi: 'Bản đồ Thornbury Wetland Centre: hồ lớn ở giữa, cổng chính giữa cạnh dưới, suối chảy vào hồ ở góc trên phải; chín chữ A–I', en: 'Map of Thornbury Wetland Centre: large lake in the centre, main entrance in the middle of the bottom edge, stream entering the lake at the top right; nine letters A–I' },
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img"><rect width="800" height="600" fill="#eef5e6"/>' +
    '<rect x="30" y="30" width="740" height="540" fill="none" stroke="#4d6b33" stroke-width="6"/>' +
    '<ellipse cx="400" cy="290" rx="230" ry="150" fill="#9fd0ea" stroke="#3b7ea1" stroke-width="4"/>' +
    '<ellipse cx="400" cy="288" rx="40" ry="24" fill="#c9e3a8"/>' +
    '<path d="M770 70 Q700 120 620 180" stroke="#3b7ea1" stroke-width="10" fill="none"/>' +
    '<rect x="360" y="558" width="80" height="24" fill="#eef5e6"/><text x="400" y="594" font-size="20" text-anchor="middle" font-family="sans-serif" fill="#33461f">Main entrance</text>' +
    '<line x1="400" y1="560" x2="400" y2="440" stroke="#a08a5a" stroke-width="8"/>' +
    '<line x1="40" y1="560" x2="40" y2="420" stroke="#4d6b33" stroke-width="10"/>' +
    MAP_MARKERS.map((m) => marker(m.key, m.x, m.y)).join('') +
    '</svg>',
};

export const LISTENING_01_P2: IeltsFullSection = {
  section_code: 'listening_p2',
  group_key: 'ielts-l01-p2',
  topic: 'travel',
  passage: { kind: 'audio_script', title: 'A guided visit to Thornbury Wetland Centre', segments: P2 },
  questions: [
    {
      key: 'ielts-l01-q11-mcq',
      difficulty: 'B1',
      content: {
        type: 'mcq_single',
        stem: 'Question 11. What was the land used for before the wetland centre opened?',
        media: ONCE,
        options: [
          { key: 'A', text: 'farming' },
          { key: 'B', text: 'a sand quarry' },
          { key: 'C', text: 'an airfield' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: '"Many visitors assume that this land was always farmland, but in fact it was a sand quarry" – farmland là bẫy.', en: 'Visitors assume farmland, but it was a sand quarry.' },
        evidence: linesOf(P2, 2),
        tags: ['ielts:listening', 'mcq_single'],
      },
    },
    {
      key: 'ielts-l01-q12-mcq',
      difficulty: 'B1',
      content: {
        type: 'mcq_single',
        stem: 'Question 12. What is new at the centre this year?',
        media: ONCE,
        options: [
          { key: 'A', text: 'a café by the lake' },
          { key: 'B', text: 'a play area for children' },
          { key: 'C', text: 'a bird hide with cameras' },
        ],
        answer_key: { correct: 'C' },
        explanation: { vi: 'Quán café mở năm ngoái; năm nay thêm "a new bird hide with live cameras".', en: 'The café opened last year; this year there is a new bird hide with live cameras.' },
        evidence: linesOf(P2, 3),
        tags: ['ielts:listening', 'mcq_single'],
      },
    },
    {
      key: 'ielts-l01-q13-mcq',
      difficulty: 'B1',
      content: {
        type: 'mcq_single',
        stem: 'Question 13. What does the guide say is most important for visitors?',
        media: ONCE,
        options: [
          { key: 'A', text: 'keeping dogs on a lead' },
          { key: 'B', text: 'staying on the boardwalks' },
          { key: 'C', text: 'feeding the ducks only seeds' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: 'Chó không được vào khu bảo tồn; "Most importantly, please stay on the boardwalks".', en: 'Dogs are not allowed at all; most importantly, stay on the boardwalks.' },
        evidence: linesOf(P2, 4),
        tags: ['ielts:listening', 'mcq_single'],
      },
    },
    {
      key: 'ielts-l01-q14-mcq',
      difficulty: 'B2',
      content: {
        type: 'mcq_single',
        stem: 'Question 14. According to the guide, when is the best time to see otters?',
        media: ONCE,
        options: [
          { key: 'A', text: 'at dawn' },
          { key: 'B', text: 'in the middle of the day' },
          { key: 'C', text: 'in the late evening' },
        ],
        answer_key: { correct: 'C' },
        explanation: { vi: 'Một số hướng dẫn viên nói bình minh, nhưng theo trung tâm "the late evening… gives you the best chance".', en: 'Some say dawn, but in their experience the late evening is best.' },
        evidence: linesOf(P2, 5),
        tags: ['ielts:listening', 'mcq_single'],
      },
    },
    {
      key: 'ielts-l01-q15-20-map',
      difficulty: 'B2',
      content: {
        type: 'plan_map_labelling',
        stem: 'Questions 15–20. Label the map below. Choose the correct letter, A–I, for each place.',
        kind: 'map',
        title: 'Thornbury Wetland Centre',
        media: ONCE,
        image_asset_id: LISTENING_P2_MAP.placeholder_id,
        image_alt:
          'Map of a rectangular nature reserve. The main entrance is in the middle of the bottom edge, with a path leading straight up towards a large lake in the centre. A hedge runs up the left edge from the bottom-left corner. A stream enters the lake from the top-right corner. Nine letters are marked: A top-left corner; B top of the map on the northern shore; C top-right corner by the stream; D left side halfway up on the western shore; E a small island in the lake; F right side halfway up; G bottom-left corner; H bottom-right corner; I just inside the entrance on the path.',
        markers: MAP_MARKERS.map((m) => ({ ...m })),
        items: [
          { key: '15', text: 'First aid point' },
          { key: '16', text: 'Picnic area' },
          { key: '17', text: 'Bicycle racks' },
          { key: '18', text: 'Pond-dipping platform' },
          { key: '19', text: 'Bird hide' },
          { key: '20', text: 'Otter viewing point' },
        ],
        answer_key: { values: { '15': 'I', '16': 'G', '17': 'H', '18': 'D', '19': 'B', '20': 'C' } },
        explanation: {
          vi: '15: ngay trong cổng trên lối thẳng (I); 16: rẽ trái theo hàng rào tới góc dưới trái (G); 17: góc dưới phải cạnh bãi xe (H); 18: bờ tây hồ, giữa bản đồ bên trái (D); 19: giữa bờ bắc (B); 20: góc trên phải cạnh suối (C).',
          en: '15: I (just inside the entrance); 16: G (bottom left); 17: H (bottom right); 18: D (western shore); 19: B (northern shore); 20: C (top right by the stream).',
        },
        evidence: linesOf(P2, 6, 7, 8, 9, 10, 11),
        tags: ['ielts:listening', 'plan_map_labelling'],
      },
    },
  ],
};
