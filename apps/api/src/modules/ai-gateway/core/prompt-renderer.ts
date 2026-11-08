import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';
import type { ChatMessage, ResolvedTask } from './types.js';

const LOCALE_NAMES: Record<string, string> = { vi: 'Vietnamese', en: 'English', ja: 'Japanese', ko: 'Korean', th: 'Thai' };

/**
 * Render system/user prompt bằng Handlebars với partial `common_system` (lưu trong model_policy.partials khi seed)
 * và helper `json`. Biến người học được template đặt trong <user_input>; không escape HTML (nội dung thô cho model).
 */
@Injectable()
export class PromptRenderer {
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();

  private compile(key: string, source: string): Handlebars.TemplateDelegate {
    let tpl = this.cache.get(key);
    if (!tpl) {
      // nosemgrep: ajinabraham.njsscan.xss.xss_templates.handlebars_noescape – prompt văn bản gửi LLM, không render HTML; nội dung người học bọc <user_input> (CLAUDE.md §5.4)
      tpl = Handlebars.compile(source, { noEscape: true, strict: false });
      this.cache.set(key, tpl);
    }
    return tpl;
  }

  private hb(task: ResolvedTask): typeof Handlebars {
    const env = Handlebars.create();
    env.registerHelper('json', (v: unknown) => JSON.stringify(v ?? null));
    env.registerHelper('default', (v: unknown, d: unknown) => (v === undefined || v === null || v === '' ? d : v));
    const partials = task.modelPolicy.partials ?? {};
    for (const [name, src] of Object.entries(partials)) if (typeof src === 'string') env.registerPartial(name, src);
    return env;
  }

  render(task: ResolvedTask, variables: Record<string, unknown>): ChatMessage[] {
    const env = this.hb(task);
    const locale = (variables.explain_locale as string | undefined) ?? 'vi';
    const vars = { ...variables, explain_locale: locale, explain_locale_name: LOCALE_NAMES[locale] ?? 'Vietnamese' };
    // nosemgrep: ajinabraham.njsscan.xss.xss_templates.handlebars_noescape – prompt văn bản gửi LLM, không render HTML
    const system = env.compile(task.systemPrompt, { noEscape: true })(vars);
    // nosemgrep: ajinabraham.njsscan.xss.xss_templates.handlebars_noescape – prompt văn bản gửi LLM, không render HTML
    const user = env.compile(task.userTemplate, { noEscape: true })(vars);
    const messages: ChatMessage[] = [{ role: 'system', content: system.trim() }];
    for (const shot of task.fewShots) {
      const s = shot as { user?: string; assistant?: string };
      if (s.user) messages.push({ role: 'user', content: s.user });
      if (s.assistant) messages.push({ role: 'assistant', content: s.assistant });
    }
    messages.push({ role: 'user', content: user.trim() });
    void this.compile;
    return messages;
  }
}

/** Bọc nội dung người học trong <user_input> khi caller cần tự xây đoạn văn bản (CLAUDE.md §5.4) */
export function wrapUserInput(text: string): string {
  return `<user_input>\n${text.replace(/<\/?user_input>/gi, '')}\n</user_input>`;
}
export function wrapData(obj: Record<string, unknown>): string {
  return `<data>\n${JSON.stringify(obj)}\n</data>`;
}
