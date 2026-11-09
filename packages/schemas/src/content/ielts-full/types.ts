import type { QuestionContentInput } from '../../question/content.js';

/**
 * C3 – cấu trúc nội dung đề IELTS đầy đủ tự biên soạn (source = 'human'): dùng chung cho seed demo (`db/seed/demo/ielts-full.seed.ts`)
 * và web mock (`apps/web/src/mock/ielts-fixtures.ts`) – một nguồn nội dung, mã đề giống nhau để E2E chạy cả mock lẫn API thật.
 * Tên người/địa danh/tổ chức hư cấu; KHÔNG sao chép đề Cambridge/IDP/British Council (CLAUDE.md §10).
 */

export type IeltsAccent = 'us' | 'uk' | 'au' | 'ca';
/** Khớp `Speaker` của seed:media (giọng TTS theo accent × vai) – N = người dẫn */
export type IeltsSpeaker = 'N' | 'M1' | 'M2' | 'W1' | 'W2';

export interface IeltsScriptSegment {
  speaker: IeltsSpeaker;
  accent: IeltsAccent;
  /** Tên hiển thị trong transcript ("Receptionist", "Laura") */
  name: string;
  text: string;
}

export interface IeltsFullQuestion {
  /** Khoá ổn định (seed_key) – không đổi giữa các lần seed */
  key: string;
  difficulty: 'B1' | 'B2' | 'C1';
  content: QuestionContentInput;
}

/** Ảnh tự vẽ (SVG) – nội dung câu trỏ `placeholder_id`; seed thay bằng id media thật, web mock dùng data URI */
export interface IeltsFullImage {
  key: string;
  placeholder_id: string;
  svg: string;
  alt: { vi: string; en: string };
}

export interface IeltsFullSection {
  /** listening_p1..p4 | reading_p1..p3 */
  section_code: string;
  /** Nhóm câu = một passage (đoạn văn Reading hoặc lời thoại một part Listening) */
  group_key: string;
  /** catalog.topics.code */
  topic: string;
  passage:
    | { kind: 'reading_passage'; title: string; body: string }
    | { kind: 'audio_script'; title: string; segments: readonly IeltsScriptSegment[] };
  questions: readonly IeltsFullQuestion[];
}

export interface IeltsFullTest {
  code: string;
  skill: 'reading' | 'listening';
  /** catalog.test_sets.level – hình thức Reading (Listening = null) */
  level: 'academic' | 'general_training' | null;
  title: { vi: string; en: string };
  duration_sec: number;
  sections: readonly IeltsFullSection[];
  images: readonly IeltsFullImage[];
}

/** UUID giả ổn định cho ảnh trong nội dung (seed thay bằng asset thật) */
export const ieltsFullImageId = (n: number) => `00000000-0000-4000-8000-${String(3000 + n).padStart(12, '0')}`;

/**
 * Câu đầy đủ trong `body` chứa `snippet` (dùng làm `evidence` – trích nguyên văn đoạn văn). Ném lỗi khi không tìm thấy: nội dung
 * sửa lệch bị phát hiện ngay lúc nạp module/test, không lọt vào seed.
 */
export function sentenceOf(body: string, snippet: string): string {
  const at = body.indexOf(snippet);
  if (at < 0) throw new Error(`[ielts-full] không tìm thấy trích đoạn: ${snippet}`);
  const before = body.slice(0, at);
  const after = (i: number, len: number) => (i < 0 ? 0 : i + len);
  const start = Math.max(after(before.lastIndexOf('. '), 2), after(before.lastIndexOf('? '), 2), after(before.lastIndexOf('! '), 2), after(before.lastIndexOf('\n'), 1));
  const tail = body.slice(at);
  const m = /[.?!](?=\s|$)|\n/.exec(tail);
  const end = m ? at + m.index + (m[0] === '\n' ? 0 : 1) : body.length;
  return body.slice(start, end).trim();
}

/** Văn bản lời thoại (transcript – body của passage audio_script): "Tên: lời" mỗi dòng một lượt */
export const scriptBody = (segments: readonly IeltsScriptSegment[]) => segments.map((s) => `${s.name}: ${s.text}`).join('\n');

/** `evidence` của câu Listening: nguyên văn các lượt thoại chứa đáp án, mỗi lượt một dòng (server so khớp từng dòng với segment) */
export const linesOf = (segments: readonly IeltsScriptSegment[], ...indexes: number[]) =>
  indexes.map((i) => {
    const s = segments[i];
    if (!s) throw new Error(`[ielts-full] thiếu lượt thoại ${i}`);
    return s.text;
  }).join('\n');
