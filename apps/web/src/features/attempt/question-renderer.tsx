'use client';

import type { AnswerInput, PublicQuestionContent } from '@/lib/types';
import { McqSingle } from './renderers/mcq-single';
import { McqMulti } from './renderers/mcq-multi';
import { FillBlank } from './renderers/fill-blank';
import { Tfng } from './renderers/tfng';
import { Unsupported } from './renderers/unsupported';
import type { ReviewInfo } from './renderers/types';

export interface QuestionRendererProps {
  questionId: string;
  content: PublicQuestionContent;
  answer: AnswerInput | null;
  onChange: (answer: AnswerInput) => void;
  disabled?: boolean;
  review?: ReviewInfo;
}

/** Chọn renderer theo content.type; dạng chưa hỗ trợ hiển thị thông báo "sắp hỗ trợ" */
export function QuestionRenderer({ content, answer, ...rest }: QuestionRendererProps) {
  switch (content.type) {
    case 'mcq_single':
      return <McqSingle content={content} answer={answer?.type === 'mcq_single' ? answer : null} {...rest} />;
    case 'mcq_multi':
      return <McqMulti content={content} answer={answer?.type === 'mcq_multi' ? answer : null} {...rest} />;
    case 'fill_blank':
      return <FillBlank content={content} answer={answer?.type === 'fill_blank' ? answer : null} {...rest} />;
    case 'tfng':
      return <Tfng content={content} answer={answer?.type === 'tfng' ? answer : null} {...rest} />;
    default:
      return <Unsupported type={content.type} />;
  }
}

/** Dạng câu UI Sprint 0 render được (các dạng khác vẫn hiển thị stem + thông báo) */
export const SUPPORTED_TYPES: ReadonlySet<string> = new Set(['mcq_single', 'mcq_multi', 'fill_blank', 'tfng']);
