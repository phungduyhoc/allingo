import { sentenceOf, type IeltsFullSection } from './types.js';

/** Reading Academic 01 – Passage 3 (Questions 27–40): bài nghị luận về sự nhàm chán (tự biên soạn; nhà nghiên cứu hư cấu) */

const TITLE = 'In Defence of Boredom';

const BODY = [
  'Few states of mind have as poor a reputation as boredom. Parents worry when their children complain of it, employers treat it as a sign of a badly designed job, and most of us now reach for a phone the instant a queue slows down or a conversation falters. Yet a growing body of research suggests that boredom may be less a problem to be eliminated than a signal worth listening to. I would go further: a society that has learned to avoid boredom completely may be losing something it does not know it needs.',
  'Psychologists generally define boredom as the uncomfortable feeling of wanting to engage in a satisfying activity but being unable to do so. This definition is important, because it separates boredom from simple rest or relaxation. A person lying contentedly in a hammock is not bored; a person forced to wait in a dull office with nothing to do almost certainly is. The discomfort, according to the cognitive scientist Dr Ruth Calloway, has a function. In her view, boredom tells us that our current situation is not giving us what we need, and it pushes us to look for something more rewarding.',
  'Some of the most frequently quoted evidence for the benefits of boredom comes from studies of creativity. In a typical experiment, one group of volunteers is given a tedious task, such as copying numbers from a telephone directory, while a second group goes straight to a creative challenge, for example thinking of as many uses as possible for a paper cup. In several such studies, the bored group produced more ideas, and more original ones. The usual interpretation is that boredom encourages the mind to wander, and that wandering allows unexpected connections to form. I find these results encouraging, but they should not be overstated. The effects are often small, and they have not always been reproduced when other teams have repeated the experiments.',
  'A stronger case, in my view, rests on what boredom makes us do rather than on what it makes us think. Because it is unpleasant, boredom motivates change. Bored students may begin to ask questions; bored employees may propose new ways of working; bored children frequently invent games far more complex than any they are given. Each of these responses requires the person to tolerate the discomfort long enough for it to do its work. The difficulty today is that this period of tolerance has almost disappeared. When a moment of emptiness can be filled instantly with news, messages or short videos, the signal is switched off before it can be acted upon.',
  'It would be easy to blame technology alone for this, but I think the problem is older and more cultural. Long before smartphones, modern societies had come to regard every unfilled hour as wasted. Schools filled timetables to the last minute, holidays became programmes of activities, and children’s free afternoons were replaced with organised clubs. Devices have simply made the same habit more efficient. The sociologist Ivan Morrow has described this as the industrialisation of attention: time that once belonged to no one has been turned into something that can be measured, sold and filled.',
  'None of this means that all boredom is good. Chronic boredom, the kind experienced by people trapped for long periods in unchanging circumstances, is associated with poor health and low mood, and it deserves to be taken seriously. Nor am I suggesting that we abandon our devices. The aim should be to recover the ability to remain briefly with an uncomfortable feeling and to ask what it is telling us. A few minutes without distraction each day is unlikely to transform anyone’s life, but it may allow a useful signal to be heard again.',
  'Perhaps the best evidence for this is the simplest. Ask a group of adults where they had their last good idea, and few will say at their desks. Most will mention a walk, a shower or a long journey: moments when there was little to do and nothing to look at. Boredom, it seems, has been doing quiet work for us all along. We would be wise not to silence it entirely.',
].join('\n\n');

const ev = (...snippets: string[]) => snippets.map((s) => sentenceOf(BODY, s)).join('\n');

export const READING_ACADEMIC_01_P3: IeltsFullSection = {
  section_code: 'reading_p3',
  group_key: 'ielts-ra01-p3',
  topic: 'health',
  passage: { kind: 'reading_passage', title: TITLE, body: BODY },
  questions: [
    {
      key: 'ielts-ra01-q27-30-ynng',
      difficulty: 'C1',
      content: {
        type: 'tfng',
        variant: 'ynng',
        stem: 'Do the following statements agree with the claims of the writer in Reading Passage 3? Choose YES if the statement agrees with the claims of the writer, NO if the statement contradicts the claims of the writer, or NOT GIVEN if it is impossible to say what the writer thinks about this.',
        statements: [
          { key: '27', text: 'Avoiding boredom altogether may have hidden costs for society.' },
          { key: '28', text: 'The results of creativity experiments on boredom are completely reliable.' },
          { key: '29', text: 'Smartphones are the main reason people find it hard to tolerate boredom.' },
          { key: '30', text: 'Schools should teach pupils how to manage boredom.' },
        ],
        answer_key: { values: { '27': 'true', '28': 'false', '29': 'false', '30': 'not_given' } },
        explanation: {
          vi: '27: YES – "may be losing something it does not know it needs"; 28: NO – "should not be overstated… not always been reproduced"; 29: NO – "easy to blame technology alone… the problem is older"; 30: NOT GIVEN – trường học chỉ được nhắc khi lấp kín thời khoá biểu.',
          en: '27: YES (losing something it needs); 28: NO (should not be overstated); 29: NO (the problem is older and cultural); 30: NOT GIVEN.',
        },
        evidence: ev('may be losing something it does not know it needs', 'they should not be overstated', 'It would be easy to blame technology alone'),
        tags: ['ielts:reading', 'ynng'],
      },
    },
    {
      key: 'ielts-ra01-q31-33-endings',
      difficulty: 'C1',
      content: {
        type: 'matching_sentence_endings',
        stem: 'Complete each sentence with the correct ending, A–F.',
        items: [
          { key: '31', text: 'According to Dr Calloway, boredom' },
          { key: '32', text: 'In the creativity experiments, the bored volunteers' },
          { key: '33', text: 'Ivan Morrow believes that free time' },
        ],
        options: [
          { key: 'A', text: 'tended to produce a larger number of ideas.' },
          { key: 'B', text: 'were unable to complete the tedious task.' },
          { key: 'C', text: 'encourages people to search for a more rewarding activity.' },
          { key: 'D', text: 'should be reduced by careful job design.' },
          { key: 'E', text: 'has become something that can be measured and sold.' },
          { key: 'F', text: 'is less common than it was in the past.' },
        ],
        answer_key: { pairs: { '31': 'C', '32': 'A', '33': 'E' } },
        explanation: { vi: '31: "pushes us to look for something more rewarding"; 32: "the bored group produced more ideas"; 33: "turned into something that can be measured, sold and filled".', en: '31: look for something more rewarding; 32: produced more ideas; 33: measured, sold and filled.' },
        evidence: ev('pushes us to look for something more rewarding', 'the bored group produced more ideas', 'the industrialisation of attention'),
        tags: ['ielts:reading', 'matching_sentence_endings'],
      },
    },
    {
      key: 'ielts-ra01-q34-36-word-bank',
      difficulty: 'C1',
      content: {
        type: 'summary_word_bank',
        stem: 'Complete the summary using the list of words, A–H, below.',
        title: 'Why boredom matters',
        text: 'The writer believes that boredom is most valuable because of the {{34}} it leads to, rather than the thoughts it produces. Since the feeling is unpleasant, people are motivated to make a {{35}}. This only works if the discomfort is tolerated for long enough, and nowadays any moment of emptiness is quickly filled. However, the writer accepts that {{36}} boredom, which continues for long periods, can be harmful to health.',
        bank: [
          { key: 'A', text: 'action' },
          { key: 'B', text: 'change' },
          { key: 'C', text: 'chronic' },
          { key: 'D', text: 'creativity' },
          { key: 'E', text: 'occasional' },
          { key: 'F', text: 'relaxation' },
          { key: 'G', text: 'technology' },
          { key: 'H', text: 'habit' },
        ],
        answer_key: { gaps: { '34': 'A', '35': 'B', '36': 'C' } },
        explanation: { vi: '34: "what boredom makes us do rather than… think" → action; 35: "boredom motivates change"; 36: "Chronic boredom… associated with poor health".', en: '34: what it makes us do (action); 35: motivates change; 36: chronic boredom harms health.' },
        evidence: ev('rests on what boredom makes us do', 'boredom motivates change', 'Chronic boredom, the kind experienced'),
        tags: ['ielts:reading', 'summary_word_bank'],
      },
    },
    {
      key: 'ielts-ra01-q37-39-sentence',
      difficulty: 'B2',
      content: {
        type: 'sentence_completion',
        stem: 'Complete the sentences below. Choose NO MORE THAN TWO WORDS from the passage for each answer.',
        word_limit: { max_words: 2 },
        sentences: [
          { key: '37', text: 'In one experiment, the tedious task involved copying numbers from a {{37}}.' },
          { key: '38', text: 'The creative challenge asked volunteers to think of uses for a {{38}}.' },
          { key: '39', text: 'Many adults say their last good idea came during a walk, a shower or a long {{39}}.' },
        ],
        answer_key: { gaps: { '37': { accepted: ['telephone directory'] }, '38': { accepted: ['paper cup'] }, '39': { accepted: ['journey'] } } },
        explanation: { vi: 'Đoạn 3: "copying numbers from a telephone directory", "uses… for a paper cup"; đoạn cuối: "a walk, a shower or a long journey".', en: 'Telephone directory; paper cup; a long journey.' },
        evidence: ev('copying numbers from a telephone directory', 'a walk, a shower or a long journey'),
        tags: ['ielts:reading', 'sentence_completion'],
      },
    },
    {
      key: 'ielts-ra01-q40-purpose',
      difficulty: 'C1',
      content: {
        type: 'mcq_single',
        stem: 'Question 40. What is the writer’s main purpose in Reading Passage 3?',
        options: [
          { key: 'A', text: 'to show that technology has made people less creative' },
          { key: 'B', text: 'to argue that boredom has a useful role that is being lost' },
          { key: 'C', text: 'to report the results of recent psychological experiments' },
          { key: 'D', text: 'to recommend ways for employers to reduce boredom at work' },
        ],
        answer_key: { correct: 'B' },
        explanation: { vi: 'Tác giả lập luận sự nhàm chán là "tín hiệu đáng lắng nghe" và xã hội đang đánh mất nó; thí nghiệm chỉ là một phần dẫn chứng, công nghệ không phải nguyên nhân duy nhất.', en: 'The writer argues boredom is a useful signal that modern habits silence; experiments are only part of the evidence.' },
        evidence: ev('a signal worth listening to', 'We would be wise not to silence it entirely'),
        tags: ['ielts:reading', 'mcq_single'],
      },
    },
  ],
};
