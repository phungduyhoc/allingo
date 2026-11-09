import { ieltsFullImageId, sentenceOf, type IeltsFullImage, type IeltsFullSection } from './types.js';

/** Reading Academic 01 – Passage 1 (Questions 1–13): lịch sử nhà chứa băng (tự biên soạn, điền trang Harrowmere hư cấu) */

const TITLE = 'Keeping Winter: The Rise and Fall of the Ice House';

const BODY = [
  'For most of human history, cold was a seasonal luxury. In regions with harsh winters, lakes and rivers froze for several months each year, yet by early summer the ice had melted and food began to spoil within days. The ice house, a building designed to store frozen water from one winter until the next, was an attempt to stretch the cold season across the whole year. Although simple ice pits had been dug in many cultures for centuries, the purpose-built ice house reached its greatest popularity on the country estates of northern Europe between the seventeenth and nineteenth centuries.',
  'The basic principle was insulation rather than refrigeration. Ice could not be made colder by any means available before the age of machines; it could only be protected from heat. Builders therefore placed most ice houses partly or entirely underground, where the surrounding earth stays at a steady, cool temperature throughout the year. Many were cut into the north-facing side of a hill, so that the entrance received as little direct sunlight as possible, and trees were often planted nearby to provide further shade.',
  'A typical ice house had two main parts. Below ground was a deep chamber, usually shaped like an egg or an upturned cone, with walls made of brick or stone up to a metre thick. Above it sat a domed roof, which was frequently covered with a thick layer of soil and grass. Visitors entered through a narrow passage fitted with two or even three doors, one after the other; this arrangement trapped pockets of still air that acted as a barrier against warm air from outside. At the very bottom of the chamber, a drain allowed meltwater to escape, because standing water would have melted the remaining ice far more quickly.',
  'Filling the ice house was hard, cold work. On the Harrowmere estate, whose records survive almost complete, the job was done in January by up to twenty labourers. They broke ice from the estate’s ornamental lake with long poles, dragged it to the ice house on wooden sledges and crushed it into small pieces before packing it into the chamber. Crushing mattered: small pieces could be pressed tightly together, leaving fewer gaps through which air could circulate. Between layers of ice the workers spread straw, which was cheap, easy to obtain and an effective insulator. The Harrowmere accounts show that in a good year the chamber held around sixty tonnes of ice, of which roughly half was still usable by the following September.',
  'What was all this ice actually for? Modern visitors often assume that it was used mainly to preserve meat and fish, but estate records suggest otherwise. At Harrowmere, the largest single use of ice was in the kitchen, where it chilled desserts, cooled drinks and set the elaborate jellies served at formal dinners. Ice was also sent to the estate’s small hospital, where it was used to reduce fevers. Preserving food was certainly one function, but for wealthy households the ice house was as much a sign of status as a practical store: being able to offer guests iced cream in August demonstrated that a family could afford both the building and the labour needed to fill it.',
  'In the nineteenth century the ice trade became an international business. Merchants began shipping blocks of lake ice across oceans in insulated ships, and towns built large commercial ice stores from which ice was delivered to homes and shops by cart. Ice was no longer the privilege of the rich, and the private ice house started to look unnecessary. The final blow came with mechanical refrigeration. Once machines could produce ice at any time of year, the effort of harvesting a frozen lake made little economic sense, and most estate ice houses had been abandoned by the early twentieth century.',
  'Today, the surviving ice houses are often overgrown and easy to miss. Some have been restored by heritage organisations and opened to the public, while others have found new occupants: their cool, dark and stable interiors make ideal winter roosts for bats. For engineers interested in low-energy building design, they also offer a lesson. The ice house kept its contents cold for months without using any power at all, relying only on careful choice of site, thick walls and the insulating properties of earth, straw and still air.',
].join('\n\n');

const ev = (...snippets: string[]) => snippets.map((s) => sentenceOf(BODY, s)).join('\n');

export const READING_P1_DIAGRAM: IeltsFullImage = {
  key: 'ielts-reading-academic-01:ice-house',
  placeholder_id: ieltsFullImageId(1),
  alt: { vi: 'Mặt cắt nhà chứa băng: mái vòm phủ đất trên cùng, lối vào bên trái có các cửa nối tiếp, buồng chứa hình quả trứng dưới đất, ống thoát nước ở đáy; nhãn 11–13', en: 'Cross-section of an ice house: earth-covered dome at the top, entrance passage on the left with doors in a row, egg-shaped chamber underground, drain at the bottom; labels 11–13' },
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img"><rect width="800" height="600" fill="#f6f4ee"/>' +
    '<rect x="0" y="230" width="800" height="370" fill="#d9c9a8"/><text x="700" y="260" font-size="20" font-family="sans-serif" fill="#5a4a2a">ground</text>' +
    '<path d="M260 230 Q400 40 540 230 Z" fill="#8fb36b" stroke="#4d6b33" stroke-width="5"/>' +
    '<ellipse cx="400" cy="370" rx="130" ry="170" fill="#eef3f7" stroke="#6b5b3e" stroke-width="16"/>' +
    '<rect x="90" y="250" width="180" height="60" fill="#c8b48c" stroke="#6b5b3e" stroke-width="4"/>' +
    '<rect x="120" y="250" width="10" height="60" fill="#6b4226"/><rect x="170" y="250" width="10" height="60" fill="#6b4226"/><rect x="220" y="250" width="10" height="60" fill="#6b4226"/>' +
    '<rect x="390" y="535" width="20" height="50" fill="#555"/>' +
    '<circle cx="175" cy="210" r="22" fill="#0b3ba7"/><text x="175" y="218" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#fff">11</text>' +
    '<circle cx="400" cy="90" r="22" fill="#0b3ba7"/><text x="400" y="98" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#fff">12</text>' +
    '<circle cx="470" cy="565" r="22" fill="#0b3ba7"/><text x="470" y="573" font-size="22" text-anchor="middle" font-family="sans-serif" fill="#fff">13</text>' +
    '</svg>',
};

export const READING_ACADEMIC_01_P1: IeltsFullSection = {
  section_code: 'reading_p1',
  group_key: 'ielts-ra01-p1',
  topic: 'education',
  passage: { kind: 'reading_passage', title: TITLE, body: BODY },
  questions: [
    {
      key: 'ielts-ra01-q01-06-tfng',
      difficulty: 'B2',
      content: {
        type: 'tfng',
        variant: 'tfng',
        stem: 'Do the following statements agree with the information given in Reading Passage 1? Choose TRUE if the statement agrees with the information, FALSE if the statement contradicts the information, or NOT GIVEN if there is no information on this.',
        statements: [
          { key: '1', text: 'Simple ice pits were in use before purpose-built ice houses became popular.' },
          { key: '2', text: 'Ice houses were usually built on the side of a hill that faced south.' },
          { key: '3', text: 'The walls of the underground chamber were always made of stone.' },
          { key: '4', text: 'The Harrowmere estate employed more labourers than any other estate in the region.' },
          { key: '5', text: 'About half of the ice stored at Harrowmere could still be used in September.' },
          { key: '6', text: 'At Harrowmere, more ice was used for medical purposes than in the kitchen.' },
        ],
        answer_key: { values: { '1': 'true', '2': 'false', '3': 'false', '4': 'not_given', '5': 'true', '6': 'false' } },
        explanation: {
          vi: '1: "simple ice pits had been dug… for centuries" trước thời kỳ thịnh hành; 2: "north-facing side of a hill" (hướng bắc); 3: "brick or stone" (không phải luôn là đá); 4: bài không so sánh với điền trang khác; 5: "roughly half was still usable by the following September"; 6: "the largest single use of ice was in the kitchen".',
          en: '1: simple ice pits existed for centuries; 2: they faced north; 3: walls were brick or stone; 4: no comparison with other estates; 5: roughly half was usable in September; 6: the kitchen was the largest use.',
        },
        evidence: ev('simple ice pits had been dug', 'north-facing side of a hill', 'walls made of brick or stone', 'roughly half was still usable', 'largest single use of ice was in the kitchen'),
        tags: ['ielts:reading', 'tfng'],
      },
    },
    {
      key: 'ielts-ra01-q07-10-table',
      difficulty: 'B2',
      content: {
        type: 'table_completion',
        stem: 'Complete the table below. Choose ONE WORD ONLY from the passage for each answer.',
        title: 'Filling the ice house at Harrowmere',
        word_limit: { max_words: 1 },
        columns: ['Stage', 'Details'],
        rows: [
          ['Timing', 'carried out in {{7}} by up to twenty labourers'],
          ['Transport', 'ice dragged to the ice house on wooden {{8}}'],
          ['Preparation', 'ice crushed so that pieces left fewer {{9}} for air to pass through'],
          ['Insulation', '{{10}} spread between the layers of ice'],
        ],
        answer_key: { gaps: { '7': { accepted: ['January'] }, '8': { accepted: ['sledges', 'sledge'] }, '9': { accepted: ['gaps'] }, '10': { accepted: ['straw'] } } },
        explanation: { vi: 'Đoạn 4: "done in January", "on wooden sledges", "leaving fewer gaps", "the workers spread straw".', en: 'Paragraph 4: done in January; wooden sledges; fewer gaps; straw between layers.' },
        evidence: ev('the job was done in January', 'dragged it to the ice house on wooden sledges', 'leaving fewer gaps', 'the workers spread straw'),
        tags: ['ielts:reading', 'table_completion'],
      },
    },
    {
      key: 'ielts-ra01-q11-13-diagram',
      difficulty: 'B2',
      content: {
        type: 'diagram_labelling',
        stem: 'Label the diagram below. Choose NO MORE THAN TWO WORDS from the passage for each answer.',
        title: 'Cross-section of a typical ice house',
        image_asset_id: READING_P1_DIAGRAM.placeholder_id,
        image_alt: 'Cross-section of an ice house. Label 11 points to the narrow entrance passage on the left, which contains several barriers placed one after another. Label 12 points to the curved structure at the top, covered with earth and grass. Label 13 points to an opening at the very bottom of the underground chamber.',
        word_limit: { max_words: 2 },
        labels: [
          { id: '11', x: 22, y: 35, description: '11: barriers in the entrance passage, one after the other' },
          { id: '12', x: 50, y: 15, description: '12: the curved structure at the top, covered with soil and grass' },
          { id: '13', x: 59, y: 94, description: '13: opening at the bottom of the chamber that lets water out' },
        ],
        answer_key: { gaps: { '11': { accepted: ['doors'] }, '12': { accepted: ['(domed) roof', 'dome'] }, '13': { accepted: ['drain'] } } },
        explanation: { vi: 'Đoạn 3: lối vào có "two or even three doors"; phía trên là "a domed roof"; đáy có "a drain".', en: 'Paragraph 3: two or three doors in the passage; a domed roof above; a drain at the bottom.' },
        evidence: ev('fitted with two or even three doors', 'Above it sat a domed roof', 'a drain allowed meltwater to escape'),
        tags: ['ielts:reading', 'diagram_labelling'],
      },
    },
  ],
};
