'use client';

import type { AnswerInput, PublicQuestionContent } from '@/lib/types';
import { McqSingle } from './renderers/mcq-single';
import { McqMulti } from './renderers/mcq-multi';
import { FillBlank } from './renderers/fill-blank';
import { Tfng } from './renderers/tfng';
import { Unsupported } from './renderers/unsupported';
import { Completion, COMPLETION_TYPES } from './renderers/completion';
import { Matching, MATCHING_TYPES } from './renderers/matching';
import { WordBank } from './renderers/word-bank';
import { PlanMap } from './renderers/plan-map';
import type { ReviewInfo } from './renderers/types';

export interface QuestionRendererProps {
  questionId: string;
  content: PublicQuestionContent;
  answer: AnswerInput | null;
  onChange: (answer: AnswerInput) => void;
  disabled?: boolean;
  review?: ReviewInfo;
  /** C2: URL ảnh nội dung (sơ đồ/bản đồ) theo asset id */
  resolveImage?: (assetId: string) => string | null;
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
    // C2 – IELTS Reading/Listening
    case 'matching':
    case 'matching_headings':
    case 'matching_information':
    case 'matching_features':
    case 'matching_sentence_endings':
      return <Matching content={content} answer={answer && answer.type === content.type ? (answer) : null} onChange={rest.onChange} questionId={rest.questionId} disabled={rest.disabled} review={rest.review} />;
    case 'sentence_completion':
    case 'summary_completion':
    case 'note_completion':
    case 'table_completion':
    case 'flow_chart_completion':
    case 'form_completion':
    case 'short_answer':
    case 'diagram_labelling':
      return <Completion content={content} answer={answer && answer.type === content.type ? (answer) : null} onChange={rest.onChange} questionId={rest.questionId} disabled={rest.disabled} review={rest.review} resolveImage={rest.resolveImage} />;
    case 'summary_word_bank':
      return <WordBank content={content} answer={answer?.type === 'summary_word_bank' ? answer : null} {...rest} />;
    case 'plan_map_labelling':
      return <PlanMap content={content} answer={answer?.type === 'plan_map_labelling' ? answer : null} {...rest} />;
    default:
      return <Unsupported type={content.type} />;
  }
}

/** Dạng câu render được (các dạng khác vẫn hiển thị stem + thông báo) – C2 thêm 14 dạng IELTS + matching chung */
export const SUPPORTED_TYPES: ReadonlySet<string> = new Set(['mcq_single', 'mcq_multi', 'fill_blank', 'tfng', 'summary_word_bank', 'plan_map_labelling', ...MATCHING_TYPES, ...COMPLETION_TYPES]);

/** Dạng tự vẽ ảnh nội dung (sơ đồ/bản đồ có ghim) – khung câu không lặp lại ảnh */
export const SELF_IMAGE_TYPES: ReadonlySet<string> = new Set(['diagram_labelling', 'plan_map_labelling']);
