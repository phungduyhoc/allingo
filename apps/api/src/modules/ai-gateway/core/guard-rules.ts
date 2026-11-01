/**
 * Luật guard cục bộ (S6) – lớp phòng thủ đầu tiên trước `guard_classify`, chạy cả khi model guard lỗi:
 * 1) che PII (email, số điện thoại, số thẻ/CCCD) TRƯỚC khi văn bản tới bất kỳ model nào (CLAUDE.md §5.4);
 * 2) chặn mẫu prompt-injection / xin đáp án đề đang thi phổ biến (EN + VI, có/không dấu) mà không tốn lời gọi model.
 * Không thay model guard (ngữ nghĩa); chỉ bắt mẫu rõ ràng để KHÔNG gọi model chính.
 */
import type { GuardClassifyOutput, RefusalCode } from '@allingo/schemas';

export type GuardCategory = GuardClassifyOutput['category'];

/** Bỏ dấu tiếng Việt + chữ thường + gộp khoảng trắng – để so mẫu "bo qua huong dan" lẫn "bỏ qua hướng dẫn" */
export function foldText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const INJECTION: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass)\b(\s+\w+){0,3}?\s+(previous|prior|above|earlier|preceding|system|your|initial)\s+(\w+\s+)?(instructions?|prompts?|rules|directions|guidelines|messages?)\b/,
  /\b(system|developer|hidden|initial|original)\s+(prompt|message|instructions?)\b/,
  /\b(reveal|show|print|repeat|output|display|leak)\b(\s+\w+){0,3}?\s+(your|the)\s+(\w+\s+)?(prompt|instructions|system message)\b/,
  /\byou are now\b|\bact as (an? )?(unrestricted|jailbroken|dan)\b|\bjailbreak\b|\bdeveloper mode\b|\bdo anything now\b/,
  /<\/?(system|assistant|developer)>|\[\/?(system|inst)\]|<\|im_start\|>|<\/?user_input>|<\/?data>/,
  /\b(give|award)\s+me\s+(a\s+)?(band\s*9|full marks|990|max(imum)? score)\b/,
  // Tiếng Việt (đã bỏ dấu): "bỏ qua mọi hướng dẫn trước đó", "lộ prompt hệ thống"
  /\b(bo qua|phot lo|quen di|quen|vo hieu hoa)\s+(\w+\s+){0,2}?(huong dan|chi dan|quy tac|lenh|chi thi)\s+(\w+\s+)?(truoc( do)?|o tren|tren|he thong|cua ban|ban dau)\b/,
  /\b(lo|tiet lo|in ra|hien thi|cho (toi|em|minh) xem)\s+(\w+\s+){0,2}?(prompt|loi nhac|chi dan|huong dan)\s+(he thong|goc|ban dau)\b/,
  /\bprompt he thong\b|\bsystem prompt\b/,
];

const ANSWER_LEAK: RegExp[] = [
  /\b(answers?|answer key|solutions?)\s+(for|to|of)\s+(the|my|this)\s+(current|ongoing|live)\s+(test|exam)\b/,
  /\banswers?\b.{0,40}\b(test|exam)\s+(that\s+)?i\s*('?m|am)\s+(currently\s+|now\s+)?(taking|doing|sitting)\b/,
  // "đáp án đề đang thi", "đáp án bài thi đang làm", "đáp án của đề thi hiện tại", "đề đang thi … đáp án"
  /\bdap an\s+(cua\s+|cho\s+)?(de|bai)(\s+thi)?\s+(dang\s+(thi|lam)|hien tai)\b/,
  /\b(de|bai)\s+(thi\s+)?dang\s+(thi|lam)\b.{0,30}\bdap an\b/,
];

const UNSAFE: RegExp[] = [/\b(how to (make|build) (a )?(bomb|weapon)|kill (myself|yourself)|child sexual)\b/];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Số điện thoại VN/quốc tế 9–12 chữ số (cho phép khoảng trắng, dấu chấm, gạch) */
const PHONE = /(?<![\w])(?:\+?84|0)(?:[\s.-]?\d){8,10}(?![\w])/g;
/** Dãy 12–19 chữ số (CCCD 12 số, số thẻ) */
const LONG_DIGITS = /(?<![\w])(?:\d[\s-]?){11,18}\d(?![\w])/g;

/** Che PII; trả văn bản đã che và cờ có che hay không */
export function redactPii(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  const mark = (tag: string) => () => {
    redacted = true;
    return `[${tag}]`;
  };
  const out = text.replace(EMAIL, mark('email')).replace(LONG_DIGITS, mark('number')).replace(PHONE, mark('phone'));
  return { text: out, redacted };
}

export interface LocalGuardResult {
  category: GuardCategory;
  rule: string | null;
}

/** Luật cục bộ: injection → answer_leak → unsafe; còn lại ok (model guard quyết định tiếp) */
export function localGuard(text: string): LocalGuardResult {
  const f = foldText(text);
  const hit = (list: RegExp[], cat: GuardCategory): LocalGuardResult | null => {
    const i = list.findIndex((r) => r.test(f));
    return i >= 0 ? { category: cat, rule: `${cat}#${i}` } : null;
  };
  return hit(INJECTION, 'injection') ?? hit(ANSWER_LEAK, 'answer_leak') ?? hit(UNSAFE, 'unsafe') ?? { category: 'ok', rule: null };
}

/**
 * Ánh xạ quyết định guard → hành động: ok/pii → cho qua (pii dùng bản đã che); injection/off_topic/answer_leak/unsafe → từ chối
 * với `refusal_code` cùng tên (web dịch i18n `tutor.refusal.<code>`).
 */
export function refusalCodeOf(category: GuardCategory): RefusalCode | null {
  switch (category) {
    case 'ok':
    case 'pii':
      return null;
    case 'injection':
    case 'off_topic':
    case 'answer_leak':
    case 'unsafe':
      return category;
    default:
      return 'unsafe';
  }
}
