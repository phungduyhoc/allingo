import { sentenceOf, type IeltsFullSection } from './types.js';

/** Reading Academic 01 – Passage 2 (Questions 14–26): niên đại học vòng cây (tự biên soạn; Đại học Castlebrook, các nhà khoa học hư cấu) */

const TITLE = 'What Trees Remember';

const PARAGRAPHS = [
  'Cut through the trunk of an old oak and you will see a pattern of concentric circles, each representing a single year of growth. In spring, when water is plentiful, a tree produces large, thin-walled cells that appear pale; as the season ends, growth slows and the cells become smaller and darker. The contrast between the late wood of one year and the early wood of the next creates a visible boundary, and counting these boundaries gives the age of the tree. This much has been understood for centuries. What is newer is the realisation that the rings record far more than age.',
  'The width of each ring depends on the conditions the tree experienced in that year. In a warm, wet summer a tree may lay down a wide band of new wood; in a year of drought, the ring may be barely visible. Because trees of the same species growing in the same region respond to the weather in similar ways, they share a recognisable sequence of wide and narrow rings. Dr Helena Varga, who leads the tree-ring laboratory at the University of Castlebrook, compares this sequence to a barcode. “No two runs of fifty years look exactly alike,” she says, “so a short sample can be matched against a master record and dated to the precise year.”',
  'Building such master records is slow work. Researchers begin with living trees, whose outermost ring is known to belong to the current year, and then look for older timber whose inner rings overlap with them: beams from historic buildings, wood preserved in bogs, or posts recovered from riverbeds. By linking these overlapping sequences, laboratories in several countries have produced continuous records stretching back thousands of years. The process depends on large numbers of samples. A single piece of wood can be misleading, since a local event such as an insect attack may produce an unusually narrow ring that has nothing to do with the climate.',
  'The applications of this work have spread well beyond botany. Historians use tree rings to date buildings, ships and wooden panel paintings, sometimes overturning long-accepted accounts. When a barn on the Ashby estate was sampled, its roof timbers turned out to have been felled some ninety years later than the date carved above its door. Art experts have also found that a number of panel paintings were produced on wood cut after the death of the artist they had been credited to. According to the historian Marcus Leigh, such findings are uncomfortable but valuable: “A date that cannot be argued with forces us to re-examine everything else we thought we knew.”',
  'Climate scientists have perhaps gained the most. Instrument records of temperature and rainfall rarely go back more than 150 years, but tree rings can extend those records over many centuries, revealing droughts and cold periods that left no written trace. Dr Samuel Osei, a climatologist who works with the Castlebrook laboratory, points out that knowing how often severe droughts happened in the past helps water planners judge the risks of the future. He is careful, however, to stress the limits of the method. Trees respond to several factors at once, and a narrow ring may reflect cold, dryness or both, so tree-ring data must always be checked against other evidence such as ice cores or lake sediments.',
  'The field now faces an unexpected problem: the trees themselves are changing. In some northern forests, the close link between summer temperature and ring width that held for centuries appears to have weakened since the middle of the twentieth century, a puzzle known as the divergence problem. Possible explanations include increased drought stress, pollution and changes in the timing of snowmelt, but none has been confirmed. Varga believes the answer matters both for science and for forest management. “If we do not understand why trees are responding differently now,” she argues, “we cannot be confident about how they will cope with the conditions ahead.”',
];
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const BODY = PARAGRAPHS.map((p, i) => `${LETTERS[i]}  ${p}`).join('\n\n');

const ev = (...snippets: string[]) => snippets.map((s) => sentenceOf(BODY, s)).join('\n');
const paragraphOptions = LETTERS.map((k) => ({ key: k, text: `Paragraph ${k}` }));

export const READING_ACADEMIC_01_P2: IeltsFullSection = {
  section_code: 'reading_p2',
  group_key: 'ielts-ra01-p2',
  topic: 'technology',
  passage: { kind: 'reading_passage', title: TITLE, body: BODY },
  questions: [
    {
      key: 'ielts-ra01-q14-18-headings',
      difficulty: 'B2',
      content: {
        type: 'matching_headings',
        stem: 'Reading Passage 2 has six paragraphs, A–F. Choose the correct heading for paragraphs B–F from the list of headings below.',
        options_title: 'List of Headings',
        items: LETTERS.map((k) => ({ key: k, text: `Paragraph ${k}` })),
        options: [
          { key: 'i', text: 'How rings form and what they were first used for' },
          { key: 'ii', text: 'A shared pattern that allows exact dating' },
          { key: 'iii', text: 'Joining many samples into one long record' },
          { key: 'iv', text: 'Surprising corrections to accepted dates' },
          { key: 'v', text: 'Looking further back at past weather' },
          { key: 'vi', text: 'A recent change that has not been explained' },
          { key: 'vii', text: 'The rising cost of laboratory equipment' },
          { key: 'viii', text: 'Why some tree species cannot be studied' },
        ],
        example: { item: 'A', option: 'i' },
        answer_key: { pairs: { B: 'ii', C: 'iii', D: 'iv', E: 'v', F: 'vi' } },
        explanation: {
          vi: 'B: chuỗi vân rộng/hẹp chung như mã vạch → định niên đại chính xác; C: nối các mẫu chồng lấn thành chuỗi dài; D: kho thóc và tranh bị định lại niên đại; E: mở rộng dữ liệu khí hậu quá khứ; F: "divergence problem" chưa được giải thích. vii, viii không được nhắc tới.',
          en: 'B: shared barcode-like sequence; C: overlapping samples linked; D: barn and paintings re-dated; E: extending climate records; F: the unexplained divergence problem. vii and viii are not discussed.',
        },
        evidence: ev('compares this sequence to a barcode', 'By linking these overlapping sequences', 'sometimes overturning long-accepted accounts', 'tree rings can extend those records over many centuries', 'a puzzle known as the divergence problem'),
        tags: ['ielts:reading', 'matching_headings'],
      },
    },
    {
      key: 'ielts-ra01-q19-21-information',
      difficulty: 'B2',
      content: {
        type: 'matching_information',
        stem: 'Reading Passage 2 has six paragraphs, A–F. Which paragraph contains the following information? You may use any letter more than once.',
        items: [
          { key: '19', text: 'an example of a local event that could lead to a false conclusion' },
          { key: '20', text: 'a comparison with a code used to identify things' },
          { key: '21', text: 'a reference to works of art being linked to the wrong person' },
        ],
        options: paragraphOptions,
        allow_reuse: true,
        answer_key: { pairs: { '19': 'C', '20': 'B', '21': 'D' } },
        explanation: { vi: '19: C – "an insect attack may produce an unusually narrow ring"; 20: B – "compares this sequence to a barcode"; 21: D – tranh vẽ trên gỗ đốn sau khi hoạ sĩ được ghi tên đã mất.', en: '19: C (insect attack); 20: B (barcode); 21: D (paintings credited to the wrong artist).' },
        evidence: ev('a local event such as an insect attack', 'compares this sequence to a barcode', 'wood cut after the death of the artist'),
        tags: ['ielts:reading', 'matching_information'],
      },
    },
    {
      key: 'ielts-ra01-q22-24-features',
      difficulty: 'C1',
      content: {
        type: 'matching_features',
        stem: 'Look at the following statements and the list of people below. Match each statement with the correct person, A, B or C. You may use any letter more than once.',
        options_title: 'List of People',
        items: [
          { key: '22', text: 'Tree-ring evidence should be compared with data from other sources.' },
          { key: '23', text: 'An exact date can make us question other information we had accepted.' },
          { key: '24', text: 'We need to understand changes in tree growth today in order to predict the future.' },
        ],
        options: [
          { key: 'A', text: 'Helena Varga' },
          { key: 'B', text: 'Marcus Leigh' },
          { key: 'C', text: 'Samuel Osei' },
        ],
        allow_reuse: true,
        answer_key: { pairs: { '22': 'C', '23': 'B', '24': 'A' } },
        explanation: { vi: '22: Osei – "must always be checked against other evidence"; 23: Leigh – "forces us to re-examine everything else"; 24: Varga – "we cannot be confident about how they will cope".', en: '22: Osei (check against other evidence); 23: Leigh (re-examine everything else); 24: Varga (understand present changes).' },
        evidence: ev('must always be checked against other evidence', 'forces us to re-examine everything else', 'we cannot be confident about how they will cope'),
        tags: ['ielts:reading', 'matching_features'],
      },
    },
    {
      key: 'ielts-ra01-q25-26-choose-two',
      difficulty: 'B2',
      content: {
        type: 'mcq_multi',
        stem: 'Questions 25–26. Choose TWO letters, A–E. Which TWO possible causes of the divergence problem are mentioned in the passage?',
        select_count: 2,
        options: [
          { key: 'A', text: 'attacks by insects' },
          { key: 'B', text: 'pollution' },
          { key: 'C', text: 'forest fires' },
          { key: 'D', text: 'changes in when snow melts' },
          { key: 'E', text: 'the felling of older trees' },
        ],
        answer_key: { correct: ['B', 'D'], scoring: 'partial', penalize_extra: false },
        explanation: { vi: '"Possible explanations include increased drought stress, pollution and changes in the timing of snowmelt" – côn trùng (A) chỉ nhắc ở đoạn C về mẫu đơn lẻ.', en: 'Pollution and the timing of snowmelt are listed; insect attacks are mentioned only in paragraph C.' },
        evidence: ev('Possible explanations include increased drought stress'),
        tags: ['ielts:reading', 'mcq_multi', 'choose_two'],
      },
    },
  ],
};
