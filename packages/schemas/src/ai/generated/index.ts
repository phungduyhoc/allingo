// ⚠️ Sinh tự động bởi scripts/gen-ai.ts. Không sửa tay.
export * from './explain_mcq.js';
export * from './tutor_chat.js';
export * from './diagnose_rl.js';
export * from './summarize_attempt.js';
export * from './grade_writing_ielts.js';
export * from './grade_writing_toeic.js';
export * from './grade_speaking_ielts.js';
export * from './grade_speaking_toeic.js';
export * from './upgrade_phrasing.js';
export * from './generate_questions.js';
export * from './generate_item_set.js';
export * from './check_question.js';
export * from './segment_translate.js';
export * from './plan_adjust.js';
export * from './guard_classify.js';

import type { z } from 'zod';
import { explainMcqOutputSchema } from './explain_mcq.js';
import { tutorChatOutputSchema } from './tutor_chat.js';
import { diagnoseRlOutputSchema } from './diagnose_rl.js';
import { summarizeAttemptOutputSchema } from './summarize_attempt.js';
import { gradeWritingIeltsOutputSchema } from './grade_writing_ielts.js';
import { gradeWritingToeicOutputSchema } from './grade_writing_toeic.js';
import { gradeSpeakingIeltsOutputSchema } from './grade_speaking_ielts.js';
import { gradeSpeakingToeicOutputSchema } from './grade_speaking_toeic.js';
import { upgradePhrasingOutputSchema } from './upgrade_phrasing.js';
import { generateQuestionsOutputSchema } from './generate_questions.js';
import { generateItemSetOutputSchema } from './generate_item_set.js';
import { checkQuestionOutputSchema } from './check_question.js';
import { segmentTranslateOutputSchema } from './segment_translate.js';
import { planAdjustOutputSchema } from './plan_adjust.js';
import { guardClassifyOutputSchema } from './guard_classify.js';

/** Bản đồ task_code → Zod schema đầu ra */
export const AI_OUTPUT_SCHEMAS = {
  explain_mcq: explainMcqOutputSchema,
  tutor_chat: tutorChatOutputSchema,
  diagnose_rl: diagnoseRlOutputSchema,
  summarize_attempt: summarizeAttemptOutputSchema,
  grade_writing_ielts: gradeWritingIeltsOutputSchema,
  grade_writing_toeic: gradeWritingToeicOutputSchema,
  grade_speaking_ielts: gradeSpeakingIeltsOutputSchema,
  grade_speaking_toeic: gradeSpeakingToeicOutputSchema,
  upgrade_phrasing: upgradePhrasingOutputSchema,
  generate_questions: generateQuestionsOutputSchema,
  generate_item_set: generateItemSetOutputSchema,
  check_question: checkQuestionOutputSchema,
  segment_translate: segmentTranslateOutputSchema,
  plan_adjust: planAdjustOutputSchema,
  guard_classify: guardClassifyOutputSchema,
} as const satisfies Record<string, z.ZodTypeAny>;
export type AiOutputSchemas = typeof AI_OUTPUT_SCHEMAS;
export type AiOutputOf<K extends keyof AiOutputSchemas> = z.infer<AiOutputSchemas[K]>;

/** Metadata prompt từ spec (credits, policy, cache_key) để seed & kiểm tra chéo */
export const AI_PROMPT_META = {
  "explain_mcq": {
    "credits_cost": 1,
    "program": null,
    "cache_key": [
      "question_version_id",
      "chosen_option",
      "explain_locale"
    ],
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "openai:gpt-mini",
        "anthropic:claude-haiku"
      ],
      "temperature": 0.3,
      "top_p": 0.9,
      "max_tokens": 700
    }
  },
  "tutor_chat": {
    "credits_cost": 2,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "anthropic:claude-haiku"
      ],
      "temperature": 0.5,
      "top_p": 0.9,
      "max_tokens": 600
    }
  },
  "diagnose_rl": {
    "credits_cost": 10,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "anthropic:claude-sonnet"
      ],
      "temperature": 0.3,
      "top_p": 0.9,
      "max_tokens": 900
    }
  },
  "summarize_attempt": {
    "credits_cost": 5,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "openai:gpt-mini"
      ],
      "temperature": 0.2,
      "top_p": 0.9,
      "max_tokens": 500
    }
  },
  "grade_writing_ielts": {
    "credits_cost": 60,
    "program": "ielts",
    "cache_key": null,
    "model_policy": {
      "primary": "anthropic:claude-sonnet",
      "fallbacks": [
        "openai:gpt",
        "google:gemini-pro"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 3500
    }
  },
  "grade_writing_toeic": {
    "credits_cost": 40,
    "program": "toeic",
    "cache_key": null,
    "model_policy": {
      "primary": "anthropic:claude-sonnet",
      "fallbacks": [
        "openai:gpt"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 1800
    }
  },
  "grade_speaking_ielts": {
    "credits_cost": 80,
    "program": "ielts",
    "cache_key": null,
    "model_policy": {
      "primary": "anthropic:claude-sonnet",
      "fallbacks": [
        "openai:gpt"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 3000
    }
  },
  "grade_speaking_toeic": {
    "credits_cost": 80,
    "program": "toeic",
    "cache_key": null,
    "model_policy": {
      "primary": "anthropic:claude-sonnet",
      "fallbacks": [
        "openai:gpt"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 1600
    }
  },
  "upgrade_phrasing": {
    "credits_cost": 2,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "openai:gpt-mini"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 300
    }
  },
  "generate_questions": {
    "credits_cost": 0,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-pro",
      "fallbacks": [
        "anthropic:claude-sonnet"
      ],
      "temperature": 0.8,
      "top_p": 0.95,
      "max_tokens": 6000
    }
  },
  "generate_item_set": {
    "credits_cost": 0,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-pro",
      "fallbacks": [
        "anthropic:claude-sonnet"
      ],
      "temperature": 0.8,
      "top_p": 0.95,
      "max_tokens": 8000
    }
  },
  "check_question": {
    "credits_cost": 0,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "openai:gpt",
      "fallbacks": [
        "google:gemini-pro"
      ],
      "temperature": 0.1,
      "top_p": 0.9,
      "max_tokens": 1200
    }
  },
  "segment_translate": {
    "credits_cost": 0,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "openai:gpt-mini"
      ],
      "temperature": 0.2,
      "top_p": 0.9,
      "max_tokens": 4000
    }
  },
  "plan_adjust": {
    "credits_cost": 3,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "anthropic:claude-sonnet"
      ],
      "temperature": 0.2,
      "top_p": 0.9,
      "max_tokens": 1200
    }
  },
  "guard_classify": {
    "credits_cost": 0,
    "program": null,
    "cache_key": null,
    "model_policy": {
      "primary": "google:gemini-flash",
      "fallbacks": [
        "openai:gpt-mini"
      ],
      "temperature": 0,
      "top_p": 1,
      "max_tokens": 200
    }
  }
} as const;
