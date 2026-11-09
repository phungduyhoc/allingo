/**
 * C2 – chuẩn hoá chính tả Anh/Mỹ cho câu điền từ IELTS (chỉ áp dụng khi nội dung khai báo `answer_key.spelling_variants = true`).
 * Cách làm: đưa mỗi từ về dạng "Mỹ" chuẩn rồi so sánh – người học viết `colour` hay `color` đều khớp đáp án `colour`.
 * Bảng từ + quy tắc hậu tố do Allingo tự tổng hợp (không phải danh sách của đơn vị tổ chức thi); quy tắc chỉ áp dụng cho từ
 * không nằm trong danh sách ngoại lệ để tránh khớp nhầm (`exercise`, `hour`, `metre` ≠ `meter` của đồng hồ đo vẫn coi là một).
 */

/** Cặp Anh → Mỹ không suy được bằng quy tắc hậu tố */
const UK_US_WORDS: Readonly<Record<string, string>> = {
  aeroplane: 'airplane',
  aluminium: 'aluminum',
  catalogue: 'catalog',
  catalogues: 'catalogs',
  dialogue: 'dialog',
  analogue: 'analog',
  cheque: 'check',
  cheques: 'checks',
  cosy: 'cozy',
  defence: 'defense',
  offence: 'offense',
  pretence: 'pretense',
  licence: 'license',
  draught: 'draft',
  enrol: 'enroll',
  enrolment: 'enrollment',
  fulfil: 'fulfill',
  fulfilment: 'fulfillment',
  instalment: 'installment',
  skilful: 'skillful',
  wilful: 'willful',
  grey: 'gray',
  jewellery: 'jewelry',
  kerb: 'curb',
  mould: 'mold',
  moulds: 'molds',
  moulded: 'molded',
  moulding: 'molding',
  mouldy: 'moldy',
  moustache: 'mustache',
  plough: 'plow',
  programme: 'program',
  programmes: 'programs',
  pyjamas: 'pajamas',
  sceptical: 'skeptical',
  storey: 'story',
  storeys: 'stories',
  tyre: 'tire',
  tyres: 'tires',
  practise: 'practice',
  practised: 'practiced',
  practising: 'practicing',
  manoeuvre: 'maneuver',
  encyclopaedia: 'encyclopedia',
  paediatric: 'pediatric',
  anaemia: 'anemia',
  oestrogen: 'estrogen',
  foetus: 'fetus',
  mum: 'mom',
  ageing: 'aging',
  judgement: 'judgment',
  acknowledgement: 'acknowledgment',
  axe: 'ax',
  doughnut: 'donut',
  pedlar: 'peddler',
  sulphur: 'sulfur',
  annexe: 'annex',
};

/** Gốc -our (colour, flavour…) – áp cho cả từ phái sinh (colourful, favourite, neighbourhood) */
const OUR_STEMS = ['colour', 'flavour', 'favour', 'honour', 'labour', 'neighbour', 'behaviour', 'humour', 'harbour', 'rumour', 'vapour', 'odour', 'armour', 'savour', 'endeavour', 'splendour', 'vigour', 'rigour', 'tumour', 'valour', 'parlour', 'saviour', 'clamour', 'fervour', 'ardour', 'candour', 'demeanour', 'glamour'];

/** Gốc -re (centre, theatre…) – áp cho cả số nhiều/phái sinh (centres, kilometre) */
const RE_STEMS = ['centre', 'theatre', 'metre', 'litre', 'fibre', 'calibre', 'sombre', 'spectre', 'lustre', 'meagre', 'sabre', 'mitre', 'lacklustre'];

/** Động từ có phụ âm l nhân đôi trước -ed/-ing/-er ở chính tả Anh (travelled → traveled) */
const DOUBLE_L_STEMS = ['travel', 'cancel', 'label', 'model', 'fuel', 'level', 'signal', 'marvel', 'counsel', 'dial', 'equal', 'jewel', 'tunnel', 'channel', 'quarrel', 'shovel', 'total', 'yodel', 'pedal', 'panel', 'parcel', 'rival', 'snorkel', 'channel'];

/**
 * Từ kết thúc -ise/-yse KHÔNG có biến thể -ize ở chính tả Mỹ (giữ nguyên). Danh sách các từ thông dụng; từ ≤ 5 ký tự (rise,
 * wise, noise…) cũng được giữ nguyên bằng điều kiện độ dài.
 */
const ISE_EXCEPTIONS = new Set([
  'advertise', 'advise', 'apprise', 'arise', 'chastise', 'circumcise', 'compromise', 'comprise', 'concise', 'demise', 'despise', 'devise', 'disguise', 'enterprise', 'excise', 'exercise', 'expertise', 'franchise', 'improvise', 'incise', 'merchandise', 'otherwise', 'precise', 'premise', 'promise', 'revise', 'supervise', 'surmise', 'surprise', 'televise', 'treatise', 'paradise', 'reprise', 'clockwise', 'likewise', 'sunrise', 'moonrise', 'cerise', 'noise', 'poise', 'raise', 'praise', 'cruise', 'bruise', 'braise', 'chemise', 'valise', 'anise', 'mortise', 'tortoise', 'porpoise', 'purpose', 'expense',
]);

const lc = (w: string) => w.toLocaleLowerCase();

/** Bỏ hậu tố biến tố thường gặp để tra gốc: s, es, ed, ing, er, ers, ful, ite, ites, hood, able … */
const SUFFIXES = ['', 's', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ful', 'fully', 'ite', 'ites', 'hood', 'hoods', 'able', 'ably', 'less', 'ist', 'ists', 'ism', 'ed', 'ly'];

function swapStem(word: string, stems: readonly string[], fromEnd: string, toEnd: string): string | null {
  for (const stem of stems) {
    const base = stem.slice(0, stem.length - fromEnd.length);
    if (!word.startsWith(base + fromEnd)) continue;
    const rest = word.slice(stem.length);
    if (SUFFIXES.includes(rest)) return base + toEnd + rest;
    // favourite → favorite, colourful → colorful (hậu tố bất kỳ sau gốc -our)
    if (fromEnd === 'our' && /^[a-z]{0,6}$/.test(rest)) return base + toEnd + rest;
  }
  return null;
}

/** Đưa một từ (đã viết thường) về dạng chính tả Mỹ chuẩn; từ không có biến thể giữ nguyên */
export function usSpelling(word: string): string {
  const w = lc(word);
  if (!/^[a-z]+$/.test(w)) return w;
  const dict = UK_US_WORDS[w];
  if (dict) return dict;
  const our = swapStem(w, OUR_STEMS, 'our', 'or');
  if (our) return our;
  // centre → center, centres → centers, kilometre → kilometer (gốc -re nằm cuối từ ghép)
  for (const stem of RE_STEMS) {
    const i = w.indexOf(stem);
    if (i < 0) continue;
    const rest = w.slice(i + stem.length);
    if (rest === '' || rest === 's') return `${w.slice(0, i)}${stem.slice(0, -2)}er${rest}`;
    // centred → centered
    if (rest === 'd') return `${w.slice(0, i)}${stem.slice(0, -2)}ered`;
  }
  // travelled/travelling/traveller → traveled/traveling/traveler
  for (const stem of DOUBLE_L_STEMS) {
    if (w.startsWith(`${stem}l`)) {
      const rest = w.slice(stem.length + 1);
      if (['ed', 'ing', 'er', 'ers', 'ous'].includes(rest)) return stem + rest;
    }
  }
  // -isation/-isations → -ization; -ise/-ised/-ises/-ising → -ize (trừ ngoại lệ); -yse → -yze (analyse, paralyse)
  const isation = /^([a-z]{3,})isation(s?)$/.exec(w);
  if (isation) return `${isation[1]}ization${isation[2]}`;
  const yse = /^([a-z]{2,})ys(e|ed|es|ing)$/.exec(w);
  if (yse && ['anal', 'paral', 'catal', 'dial', 'electrol', 'hydrol'].includes(yse[1]!)) return `${yse[1]}yz${yse[2]}`;
  const ise = /^([a-z]{3,})is(e|ed|es|ing|er|ers)$/.exec(w);
  if (ise && w.length > 5 && !ISE_EXCEPTIONS.has(`${ise[1]}ise`)) return `${ise[1]}iz${ise[2]}`;
  return w;
}

/** Chuỗi nhiều từ → mỗi từ chữ cái về chính tả Mỹ (giữ nguyên số, dấu nối) */
export function usSpellingText(text: string): string {
  return text.replace(/[a-z]+/gi, (m) => usSpelling(m));
}
