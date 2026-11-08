import type { Rule } from 'eslint';

/** Kiểu cho quy tắc ESLint cục bộ viết bằng JS (eslint.config.js nạp trực tiếp, không biên dịch) */
export declare const noJsxLiteralText: Rule.RuleModule;
declare const plugin: { rules: Record<string, Rule.RuleModule> };
export default plugin;
