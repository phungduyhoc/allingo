import { describe, expect, it } from 'vitest';
import {
  AUTO_GRADABLE_TYPES,
  PROGRAM_REGISTRY,
  QUESTION_FIXTURES_ALL,
  QUESTION_FIXTURE_LIST,
  RL_QUESTION_TYPE_CODES,
  autoSectionCodes,
  clampTarget,
  countWords,
  describeQuestion,
  expandAccepted,
  grade,
  hasSecretFields,
  isProgramCode,
  isSpokenSection,
  keyAnswerOf,
  markCount,
  marksOf,
  matchesAccepted,
  normalizeGapAnswer,
  programLaunched,
  questionContentSchema,
  runAutoChecks,
  skillOfSection,
  toPublicContent,
  usSpelling,
  usSpellingText,
  withinWordLimit,
  wordLimitInstruction,
  type QuestionContent,
} from '../src/index.js';

const parse = (raw: unknown) => questionContentSchema.parse(raw);
const fx = (type: keyof typeof QUESTION_FIXTURES_ALL, i = 0) => QUESTION_FIXTURES_ALL[type][i]!;

describe('C2 – normalizeGapAnswer (từng quy tắc chuẩn hoá)', () => {
  it('1. khoảng trắng (kể cả NBSP, xuống dòng) gộp một và cắt hai đầu', () => {
    expect(normalizeGapAnswer('  main   entrance \n')).toBe('main entrance');
  });
  it('1. gạch nối/ngang các kiểu → "-" và bỏ khoảng trắng quanh gạch nối', () => {
    expect(normalizeGapAnswer('self – service')).toBe('self-service');
    expect(normalizeGapAnswer('self‐service')).toBe('self-service');
  });
  it('1. nháy cong → nháy thẳng', () => {
    expect(normalizeGapAnswer('visitors’ centre')).toBe("visitors' centre");
  });
  it('2. bỏ dấu câu bao quanh câu trả lời và dấu câu cuối từ', () => {
    expect(normalizeGapAnswer('"library."')).toBe('library');
    expect(normalizeGapAnswer('(cabinet)')).toBe('cabinet');
    expect(normalizeGapAnswer('seeds, soil')).toBe('seeds soil');
  });
  it('3. không phân biệt hoa thường trừ khi case_sensitive', () => {
    expect(normalizeGapAnswer('Cabinet')).toBe('cabinet');
    expect(normalizeGapAnswer('XK-42b', { caseSensitive: true })).toBe('XK-42b');
  });
  it('4. bỏ dấu phân cách hàng nghìn giữa chữ số (không đụng số thập phân, giờ)', () => {
    expect(normalizeGapAnswer('£1,500')).toBe('£1500');
    expect(normalizeGapAnswer('12,345,678')).toBe('12345678');
    expect(normalizeGapAnswer('7.30')).toBe('7.30');
    expect(normalizeGapAnswer('1,5')).toBe('1,5');
  });
  it('5. chính tả Anh/Mỹ chỉ khi khai báo spelling_variants', () => {
    expect(normalizeGapAnswer('Colour')).toBe('colour');
    expect(normalizeGapAnswer('Colour', { spellingVariants: true })).toBe('color');
    expect(normalizeGapAnswer('city centre', { spellingVariants: true })).toBe(normalizeGapAnswer('city center', { spellingVariants: true }));
  });
  it('NFC: chữ có dấu tổ hợp = chữ dựng sẵn', () => {
    expect(normalizeGapAnswer('café')).toBe('café');
  });
});

describe('C2 – expandAccepted (phần tuỳ chọn trong ngoặc)', () => {
  it('"(the) main entrance" → có và không có "the"', () => {
    expect(expandAccepted('(the) main entrance').sort()).toEqual(['main entrance', 'the main entrance']);
  });
  it('hai cụm tuỳ chọn → 4 biến thể; ngoặc không cân → giữ nguyên', () => {
    expect(expandAccepted('(the) (old) bridge')).toHaveLength(4);
    expect(expandAccepted('bridge (old')).toEqual(['bridge (old']);
    expect(expandAccepted('library')).toEqual(['library']);
  });
});

describe('C2 – giới hạn từ (NO MORE THAN N WORDS AND/OR A NUMBER)', () => {
  it('đếm từ: từ có gạch nối là một từ; số tách riêng', () => {
    expect(countWords('well-known café')).toEqual({ words: 2, numbers: 0, tokens: 2 });
    expect(countWords('25 kilometres')).toEqual({ words: 1, numbers: 1, tokens: 2 });
    expect(countWords('£1,500')).toEqual({ words: 0, numbers: 1, tokens: 1 });
  });
  it('max_words: vượt → false; rỗng/không giới hạn → true', () => {
    expect(withinWordLimit('monthly workshops', { max_words: 2 })).toBe(true);
    expect(withinWordLimit('the monthly workshops', { max_words: 2 })).toBe(false);
    expect(withinWordLimit('', { max_words: 1 })).toBe(true);
    expect(withinWordLimit('anything at all here', undefined)).toBe(true);
  });
  it('allow_number: số không tính vào max_words nhưng chỉ một số', () => {
    expect(withinWordLimit('25 kilometres', { max_words: 1, allow_number: true })).toBe(true);
    expect(withinWordLimit('twenty five kilometres', { max_words: 1, allow_number: true })).toBe(false);
    expect(withinWordLimit('7.30 15/8', { max_words: 1, allow_number: true })).toBe(false);
  });
  it('number_only: đúng một số', () => {
    expect(withinWordLimit('1500', { number_only: true })).toBe(true);
    expect(withinWordLimit('21st', { number_only: true })).toBe(true);
    expect(withinWordLimit('about 1500', { number_only: true })).toBe(false);
  });
  it('word_limit cần max_words hoặc number_only', () => {
    expect(() => parse({ ...fx('sentence_completion').content, word_limit: { allow_number: true } })).toThrow();
  });
  it('hướng dẫn đề theo cách viết IELTS', () => {
    expect(wordLimitInstruction({ max_words: 2, allow_number: true })).toBe('Write NO MORE THAN TWO WORDS AND/OR A NUMBER');
    expect(wordLimitInstruction({ max_words: 1 })).toBe('Write ONE WORD ONLY');
    expect(wordLimitInstruction({ max_words: 1, allow_number: true })).toBe('Write ONE WORD AND/OR A NUMBER');
    expect(wordLimitInstruction({ number_only: true })).toBe('Write A NUMBER');
    expect(wordLimitInstruction(undefined)).toBeNull();
  });
});

describe('C2 – matchesAccepted (nhiều đáp án chấp nhận)', () => {
  it('khớp bất kỳ cách viết nào + phần tuỳ chọn', () => {
    expect(matchesAccepted('25 km', ['25 kilometres', '25 km'])).toBe(true);
    expect(matchesAccepted('Main Entrance.', ['(the) main entrance'])).toBe(true);
    expect(matchesAccepted('the main entrance', ['(the) main entrance'])).toBe(true);
    expect(matchesAccepted('a main entrance', ['(the) main entrance'])).toBe(false);
    expect(matchesAccepted('   ', ['x'])).toBe(false);
  });
  it('UK/US chỉ khi khai báo', () => {
    expect(matchesAccepted('color', ['colour'])).toBe(false);
    expect(matchesAccepted('color', ['colour'], { spellingVariants: true })).toBe(true);
  });
  it('case_sensitive', () => {
    expect(matchesAccepted('xk42', ['XK42'], { caseSensitive: true })).toBe(false);
    expect(matchesAccepted('XK42', ['XK42'], { caseSensitive: true })).toBe(true);
  });
});

describe('C2 – usSpelling (UK → US)', () => {
  it.each([
    ['colour', 'color'],
    ['colourful', 'colorful'],
    ['neighbours', 'neighbors'],
    ['centre', 'center'],
    ['centres', 'centers'],
    ['kilometres', 'kilometers'],
    ['theatre', 'theater'],
    ['organise', 'organize'],
    ['organised', 'organized'],
    ['organisation', 'organization'],
    ['analyse', 'analyze'],
    ['travelled', 'traveled'],
    ['travelling', 'traveling'],
    ['catalogue', 'catalog'],
    ['programme', 'program'],
  ])('%s → %s', (uk, us) => {
    expect(usSpelling(uk)).toBe(us);
  });
  it('ngoại lệ -ise và từ không biến thể giữ nguyên', () => {
    for (const w of ['exercise', 'advertise', 'surprise', 'promise', 'rise', 'wise', 'library', 'our', 'tour', 'four', 'hour']) expect(usSpelling(w)).toBe(w);
  });
  it('chuỗi nhiều từ: chỉ đổi từ chữ cái, giữ số và dấu', () => {
    expect(usSpellingText('25 kilometres of colourful harbour-side')).toBe('25 kilometers of colorful harbor-side');
  });
});

describe('C2 – chấm dạng gõ đáp án / nối / ngân hàng từ / bản đồ', () => {
  it('vượt giới hạn từ = sai dù chứa đáp án', () => {
    const c = fx('sentence_completion').content;
    const r = grade(c, { type: 'sentence_completion', gaps: { '1': 'the cabinet near', '2': 'workshops' } });
    expect(r.details).toMatchObject({ '1': false, '2': true });
  });
  it('partial: điểm theo tỷ lệ chỗ trống đúng; all_or_nothing: 0 nếu sai một', () => {
    const c = fx('sentence_completion').content as Extract<QuestionContent, { type: 'sentence_completion' }>;
    expect(grade(c, { type: 'sentence_completion', gaps: { '1': 'cabinet' } }).score).toBe(0.5);
    const strict = parse({ ...c, answer_key: { ...c.answer_key, scoring: 'all_or_nothing' } });
    expect(grade(strict, { type: 'sentence_completion', gaps: { '1': 'cabinet' } }).score).toBe(0);
  });
  it('matching_headings: dòng ví dụ không tính; dùng lại tiêu đề khi không cho phép → mục trùng sai', () => {
    const c = fx('matching_headings').content as Extract<QuestionContent, { type: 'matching_headings' }>;
    const key = keyAnswerOf(c)!;
    expect(grade(c, key).is_correct).toBe(true);
    const items = c.items.filter((i) => i.key !== c.example?.item).map((i) => i.key);
    const first = c.answer_key.pairs[items[0]!]!;
    const dup = { type: 'matching_headings' as const, pairs: { ...c.answer_key.pairs, [items[1]!]: first } };
    const r = grade(c, dup);
    expect(r.is_correct).toBe(false);
    expect(r.details?.[items[1]!]).toBe(false);
    if (c.example) expect(Object.keys(r.details ?? {})).not.toContain(c.example.item);
  });
  it('matching_features: mặc định cho dùng lại lựa chọn', () => {
    const c = fx('matching_features').content as Extract<QuestionContent, { type: 'matching_features' }>;
    expect(c.allow_reuse).toBe(true);
  });
  it('summary_word_bank: chọn đúng chữ cái; ô trống → sai', () => {
    const c = fx('summary_word_bank').content;
    const key = keyAnswerOf(c) as { type: 'summary_word_bank'; gaps: Record<string, string> };
    expect(grade(c, key).score).toBe(1);
    const [firstId] = Object.keys(key.gaps);
    const { [firstId!]: _omit, ...rest } = key.gaps;
    expect(grade(c, { type: 'summary_word_bank', gaps: rest }).details?.[firstId!]).toBe(false);
  });
  it('plan_map_labelling: chữ cái vị trí', () => {
    const c = fx('plan_map_labelling').content;
    expect(grade(c, keyAnswerOf(c)).is_correct).toBe(true);
    expect(grade(c, { type: 'plan_map_labelling', values: {} }).score).toBe(0);
  });
  it('schema từ chối đáp án lệch chỗ trống/mục/lựa chọn', () => {
    const sc = fx('sentence_completion').content as Extract<QuestionContent, { type: 'sentence_completion' }>;
    expect(() => parse({ ...sc, answer_key: { ...sc.answer_key, gaps: { '1': { accepted: ['x'] } } } })).toThrow(/2/);
    expect(() => parse({ ...sc, answer_key: { ...sc.answer_key, gaps: { ...sc.answer_key.gaps, '9': { accepted: ['x'] } } } })).toThrow();
    const mh = fx('matching_headings').content as Extract<QuestionContent, { type: 'matching_headings' }>;
    const item = mh.items.find((i) => i.key !== mh.example?.item)!.key;
    expect(() => parse({ ...mh, answer_key: { ...mh.answer_key, pairs: { ...mh.answer_key.pairs, [item]: 'zz' } } })).toThrow();
    const pm = fx('plan_map_labelling').content as Extract<QuestionContent, { type: 'plan_map_labelling' }>;
    expect(() => parse({ ...pm, answer_key: { ...pm.answer_key, values: { ...pm.answer_key.values, [pm.items[0]!.key]: 'Q' } } })).toThrow();
  });
});

describe('C2 – markCount / marksOf (đếm câu hỏi theo mục đánh số)', () => {
  it('TFNG n mệnh đề = n; "Choose TWO" partial = 2; điền 2 chỗ trống = 2; TOEIC per_question = 1', () => {
    const tf = fx('tfng').content as Extract<QuestionContent, { type: 'tfng' }>;
    expect(markCount(tf)).toBe(tf.statements.length);
    const two = QUESTION_FIXTURES_ALL.mcq_multi.find((f) => f.content.type === 'mcq_multi' && f.content.select_count !== undefined)!.content;
    expect(markCount(two)).toBe(2);
    expect(markCount(fx('sentence_completion').content)).toBe(2);
    expect(marksOf(two, { score: 0.5, is_correct: false }, 'per_item')).toEqual({ earned: 1, max: 2 });
    expect(marksOf(two, { score: 0.5, is_correct: false }, 'per_question')).toEqual({ earned: 0, max: 1 });
    expect(marksOf(fx('essay').content, { score: null, is_correct: null }, 'per_item').earned).toBe(0);
  });
  it('matching_headings không đếm dòng ví dụ', () => {
    const mh = fx('matching_headings').content as Extract<QuestionContent, { type: 'matching_headings' }>;
    expect(markCount(mh)).toBe(mh.items.length - (mh.example ? 1 : 0));
  });
});

describe('C2 – keyAnswerOf / describeQuestion (xem trước, prompt AI)', () => {
  it.each(QUESTION_FIXTURE_LIST.filter((f) => AUTO_GRADABLE_TYPES.has(f.content.type)).map((f) => [f.id, f] as const))('%s: grade(keyAnswerOf) = đúng hoàn toàn', (_id, f) => {
    const key = keyAnswerOf(f.content);
    expect(key).not.toBeNull();
    expect(grade(f.content, key).score).toBe(1);
  });
  it('dạng chấm thủ công → null', () => {
    expect(keyAnswerOf(fx('essay').content)).toBeNull();
  });
  it.each(RL_QUESTION_TYPE_CODES.map((t) => [t] as const))('%s: mô tả có mục đánh số = markCount, kèm đáp án đúng và câu trả lời', (t) => {
    const f = fx(t);
    const d = describeQuestion(f.content, f.correct_answer);
    expect(d.format).toBe(t);
    expect(d.items.length).toBe(markCount(f.content));
    for (const it of d.items) expect(it.correct.length).toBeGreaterThan(0);
    expect(d.chosen_text).not.toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/@|user_id/);
  });
  it('dạng gõ đáp án có hướng dẫn giới hạn từ; MCQ một đáp án không có mục', () => {
    expect(describeQuestion(fx('sentence_completion').content).instructions).toContain('NO MORE THAN TWO WORDS');
    const m = describeQuestion(fx('mcq_single').content, { type: 'mcq_single', selected: 'B' });
    expect(m.items).toEqual([]);
    expect(m.chosen_text).toBe('B');
  });
});

describe('S163 – fill_blank không lộ đáp án chấp nhận ra client', () => {
  it('toPublicContent bỏ blanks[].accepted; hasSecretFields phát hiện', () => {
    const c = fx('fill_blank').content;
    const pub = toPublicContent(c) as unknown as { blanks: Array<Record<string, unknown>> };
    expect(pub.blanks.length).toBeGreaterThan(0);
    for (const b of pub.blanks) expect(b).not.toHaveProperty('accepted');
    expect(hasSecretFields(pub)).toBe(false);
    expect(hasSecretFields({ blanks: [{ id: '1', accepted: ['x'] }] })).toBe(true);
  });
  it.each(RL_QUESTION_TYPE_CODES.map((t) => [t] as const))('%s: nội dung công khai không còn answer_key', (t) => {
    const pub = toPublicContent(fx(t).content);
    expect(hasSecretFields(pub)).toBe(false);
    expect(JSON.stringify(pub)).not.toContain('accepted');
  });
});

describe('C2 – kiểm tra tự động (B2) cho dạng IELTS', () => {
  const base = { program: 'ielts', section_code: 'reading_p1', has_passage: true, section_rules: {} };
  const codes = (content: QuestionContent, type = content.type) => runAutoChecks({ ...base, question_type: type, content }).map((r) => r.code);

  it('fixture hợp lệ → không lỗi chặn', () => {
    for (const t of RL_QUESTION_TYPE_CODES) {
      const levels = runAutoChecks({ ...base, question_type: t, content: fx(t).content }).filter((r) => r.level === 'error');
      expect(levels, t).toEqual([]);
    }
  });
  it('thiếu giới hạn từ → cảnh báo; đáp án chấp nhận vượt giới hạn → lỗi', () => {
    const c = fx('sentence_completion').content as Extract<QuestionContent, { type: 'sentence_completion' }>;
    expect(codes({ ...c, word_limit: undefined })).toContain('word_limit_missing');
    // "(monthly) workshops" còn biến thể 1 từ → hợp lệ; "monthly workshops" (2 từ) với giới hạn ONE WORD → không ai làm đúng được
    expect(codes(parse({ ...c, word_limit: { max_words: 1 } }))).not.toContain('accepted_exceeds_word_limit');
    const over = parse({ ...c, word_limit: { max_words: 1 }, answer_key: { ...c.answer_key, gaps: { ...c.answer_key.gaps, '2': { accepted: ['monthly workshops'] } } } });
    expect(runAutoChecks({ ...base, question_type: c.type, content: over }).find((r) => r.code === 'accepted_exceeds_word_limit')).toMatchObject({ level: 'error', params: { gaps: '2' } });
  });
  it('"Choose TWO" nhưng đáp án 3 → select_count_mismatch', () => {
    const two = QUESTION_FIXTURES_ALL.mcq_multi.find((f) => f.content.type === 'mcq_multi' && f.content.select_count !== undefined)!.content as Extract<QuestionContent, { type: 'mcq_multi' }>;
    const keys = two.options.map((o) => o.key);
    expect(codes({ ...two, answer_key: { ...two.answer_key, correct: keys.slice(0, 3) } })).toContain('select_count_mismatch');
  });
  it('nối không dùng lại lựa chọn nhưng số lựa chọn ≤ số mục → too_few_options', () => {
    const c = fx('matching_sentence_endings').content as Extract<QuestionContent, { type: 'matching_sentence_endings' }>;
    const used = new Set(Object.values(c.answer_key.pairs));
    expect(codes({ ...c, options: c.options.filter((o) => used.has(o.key)) })).toContain('too_few_options');
  });
});

describe('C1 – registry chương trình', () => {
  it('mã chương trình, kỹ năng theo phần thi, phần thi đọc trong audio', () => {
    expect(isProgramCode('ielts')).toBe(true);
    expect(isProgramCode('foo')).toBe(false);
    expect(skillOfSection('toeic', 'part3')).toBe('listening');
    expect(skillOfSection('ielts', 'reading_p2')).toBe('reading');
    expect(skillOfSection('ielts', 'part3')).toBeNull();
    expect(isSpokenSection('toeic', 'part2')).toBe(true);
    expect(isSpokenSection('ielts', 'listening_p1')).toBe(false);
    expect(autoSectionCodes('ielts')).toEqual(['listening_p1', 'listening_p2', 'listening_p3', 'listening_p4', 'reading_p1', 'reading_p2', 'reading_p3']);
    expect(autoSectionCodes('toeic')).toEqual(['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7']);
  });
  it('cờ ra mắt: TOEIC luôn mở; IELTS theo cờ; mã lạ → false', () => {
    expect(programLaunched('toeic', () => false)).toBe(true);
    expect(programLaunched('ielts', () => false)).toBe(false);
    expect(programLaunched('ielts', (k) => k === 'ff.catalog.program.ielts')).toBe(true);
    expect(programLaunched('foo', () => true)).toBe(false);
  });
  it('mục tiêu làm tròn theo bước và cắt biên', () => {
    expect(clampTarget('ielts', 6.7)).toBe(6.5);
    expect(clampTarget('ielts', 6.8)).toBe(7);
    expect(clampTarget('ielts', 2)).toBe(4);
    expect(clampTarget('toeic', 652)).toBe(650);
    expect(clampTarget('toeic', 2000)).toBe(990);
  });
  it('IELTS hỗ trợ mọi dạng C2; mọi chương trình đều có ≥ 1 phần thi tự chấm', () => {
    for (const t of RL_QUESTION_TYPE_CODES) expect(PROGRAM_REGISTRY.ielts.question_types).toContain(t);
    for (const def of Object.values(PROGRAM_REGISTRY)) expect(def.sections.some((s) => s.auto)).toBe(true);
  });
});
