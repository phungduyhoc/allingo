import type { AnswerInput } from '@/lib/types';

/** Dữ liệu Review (chỉ có sau khi nộp): đáp án đúng + chi tiết từng phần */
export interface ReviewInfo {
  correctAnswer: unknown;
  details: Record<string, boolean> | null;
  isCorrect: boolean | null;
}

export interface RendererProps<C, A extends AnswerInput> {
  content: C;
  answer: A | null;
  onChange: (answer: A) => void;
  disabled?: boolean;
  /** Có → hiển thị trạng thái đúng/sai, không cho sửa */
  review?: ReviewInfo;
  /** Để tạo id a11y ổn định */
  questionId: string;
  /** C2: URL ảnh nội dung theo asset id (sơ đồ/bản đồ) – đã gia hạn URL ký; null khi chưa có */
  resolveImage?: (assetId: string) => string | null;
}
