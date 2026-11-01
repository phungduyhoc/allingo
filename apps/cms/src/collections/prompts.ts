import type { CollectionConfig } from 'payload';
import { isAdmin, isLoggedIn } from '../lib/access';
import { PROGRAM_OPTIONS } from '../lib/reference';

/**
 * Prompt template/version – CHỈ SOẠN NHÁP trong CMS.
 * Nguồn sự thật là ai.prompt_templates/prompt_versions/model_routes (seed từ docs/spec/allingo-prompts.yaml,
 * quản lý qua API admin). Trạng thái canary/active/retired do API quyết định; CMS không đẩy prompt sang ai.*.
 */
const NOTE = {
  vi: 'Nguồn sự thật là ai.* qua API admin; CMS chỉ soạn nháp để đội nội dung góp ý. Không dùng trực tiếp ở runtime.',
  en: 'Source of truth is ai.* via the admin API; the CMS only holds drafts for review.',
};

export const PromptTemplates: CollectionConfig = {
  slug: 'prompt_templates',
  labels: { singular: { vi: 'Prompt template (nháp)', en: 'Prompt template (draft)' }, plural: { vi: 'Prompt templates (nháp)', en: 'Prompt templates (drafts)' } },
  admin: { useAsTitle: 'code', group: { vi: 'AI (nháp)', en: 'AI (drafts)' }, description: NOTE, defaultColumns: ['code', 'program', 'description'] },
  access: { read: isLoggedIn, create: isAdmin, update: isAdmin, delete: isAdmin },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'code', type: 'text', required: true, unique: true, label: { vi: 'Mã task (vd. explain_mcq)', en: 'Task code' } },
        { name: 'program', type: 'select', options: [...PROGRAM_OPTIONS], label: { vi: 'Chương trình (trống = chung)', en: 'Program (blank = all)' } },
      ],
    },
    { name: 'description', type: 'textarea', label: { vi: 'Mô tả', en: 'Description' } },
  ],
};

export const PromptVersions: CollectionConfig = {
  slug: 'prompt_versions',
  labels: { singular: { vi: 'Prompt version (nháp)', en: 'Prompt version (draft)' }, plural: { vi: 'Prompt versions (nháp)', en: 'Prompt versions (drafts)' } },
  admin: { useAsTitle: 'label', group: { vi: 'AI (nháp)', en: 'AI (drafts)' }, description: NOTE, defaultColumns: ['label', 'template', 'status', 'updatedAt'] },
  access: { read: isLoggedIn, create: isAdmin, update: isAdmin, delete: isAdmin },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'template', type: 'relationship', relationTo: 'prompt_templates', required: true, label: { vi: 'Template', en: 'Template' } },
        { name: 'label', type: 'text', required: true, label: { vi: 'Nhãn (vd. v1-draft-2026-11)', en: 'Label' } },
        {
          name: 'status',
          type: 'select',
          required: true,
          defaultValue: 'draft',
          options: ['draft', 'canary', 'active', 'retired'].map((v) => ({ label: v, value: v })),
          label: { vi: 'Trạng thái (chỉ đọc – do API quyết định)', en: 'Status (read-only, set by API)' },
          admin: { readOnly: true, position: 'sidebar' },
        },
      ],
    },
    { name: 'systemPrompt', type: 'textarea', required: true, label: 'system_prompt', admin: { rows: 10 } },
    { name: 'userTemplate', type: 'textarea', required: true, label: 'user_template (Handlebars)', admin: { rows: 10 } },
    { name: 'outputSchema', type: 'json', label: 'output_schema (JSON Schema)' },
    { name: 'modelPolicy', type: 'json', label: 'model_policy', admin: { description: { vi: '{ primary, fallbacks, temperature, max_output_tokens, ... }', en: '{ primary, fallbacks, temperature, max_output_tokens, ... }' } } },
    { name: 'changeNote', type: 'textarea', label: { vi: 'Ghi chú thay đổi', en: 'Change note' } },
  ],
};
