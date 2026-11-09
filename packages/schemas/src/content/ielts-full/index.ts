import { LISTENING_01_P1, LISTENING_01_P2, LISTENING_P2_MAP } from './listening-01-p1-p2.js';
import { LISTENING_01_P3, LISTENING_01_P4 } from './listening-01-p3-p4.js';
import { READING_ACADEMIC_01_P1, READING_P1_DIAGRAM } from './reading-academic-01-p1.js';
import { READING_ACADEMIC_01_P2 } from './reading-academic-01-p2.js';
import { READING_ACADEMIC_01_P3 } from './reading-academic-01-p3.js';
import type { IeltsFullTest } from './types.js';

/**
 * C3 – hai đề IELTS đầy đủ tự biên soạn (định dạng thi trên máy tính, IELTS_CBT):
 * - `ielts-reading-academic-01`: Reading Academic, 3 passage – 13/13/14 câu = 40, 60 phút; phủ TFNG, YNNG, 4 dạng nối, bảng, sơ đồ,
 *   câu/tóm tắt/ngân hàng từ, trắc nghiệm một đáp án và "Choose TWO".
 * - `ielts-listening-01`: Listening 4 part × 10 câu = 40 (~30 phút audio sinh qua SpeechProvider bởi seed:media), nhiều giọng
 *   us/uk/au/ca; biểu mẫu, ghi chú, trắc nghiệm, bản đồ, nối, "Choose TWO", trả lời ngắn, sơ đồ quy trình, tóm tắt.
 * Seed demo và web mock đọc cùng module này (mã đề, khoá câu giống nhau).
 */

export const IELTS_READING_ACADEMIC_01_CODE = 'ielts-reading-academic-01';
export const IELTS_LISTENING_01_CODE = 'ielts-listening-01';

export const IELTS_READING_ACADEMIC_01: IeltsFullTest = {
  code: IELTS_READING_ACADEMIC_01_CODE,
  skill: 'reading',
  level: 'academic',
  title: { vi: 'IELTS Reading Academic – Đề đầy đủ 01 (40 câu, 60 phút)', en: 'IELTS Academic Reading – Full test 01 (40 questions, 60 minutes)' },
  duration_sec: 60 * 60,
  sections: [READING_ACADEMIC_01_P1, READING_ACADEMIC_01_P2, READING_ACADEMIC_01_P3],
  images: [READING_P1_DIAGRAM],
};

export const IELTS_LISTENING_01: IeltsFullTest = {
  code: IELTS_LISTENING_01_CODE,
  skill: 'listening',
  level: null,
  title: { vi: 'IELTS Listening – Đề đầy đủ 01 (40 câu, ~30 phút)', en: 'IELTS Listening – Full test 01 (40 questions, ~30 minutes)' },
  // ~30 phút audio + đọc trước 4 × 30 s + 2 phút xem lại (IELTS_CBT) – hạn chung của attempt; luồng phát do client/server điều khiển
  duration_sec: 34 * 60,
  sections: [LISTENING_01_P1, LISTENING_01_P2, LISTENING_01_P3, LISTENING_01_P4],
  images: [LISTENING_P2_MAP],
};

export const IELTS_FULL_TESTS: readonly IeltsFullTest[] = [IELTS_LISTENING_01, IELTS_READING_ACADEMIC_01];

export * from './types.js';
export { LISTENING_01_P1_SCRIPT, LISTENING_01_P2_SCRIPT } from './listening-01-p1-p2.js';
export { LISTENING_01_P3_SCRIPT, LISTENING_01_P4_SCRIPT } from './listening-01-p3-p4.js';
