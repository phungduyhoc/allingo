/**
 * Quy tắc ESLint cục bộ `allingo/no-jsx-literal-text` (S11, CLAUDE.md §5.11 – "không chuỗi cứng trong UI"):
 * báo chuỗi người dùng nhìn thấy viết thẳng trong JSX của apps/web thay vì đi qua next-intl.
 *
 *  - JSXText có chữ cái (mọi ngôn ngữ – `\p{L}`) → báo; khoảng trắng, số, dấu câu, ký hiệu (·, —, %, ×, →…) được phép.
 *  - `{'chuỗi'}` / `{`chuỗi`}` (không biểu thức) làm con của phần tử JSX → báo.
 *  - Thuộc tính hiển thị (`aria-label`, `title`, `placeholder`, `alt`, `label`…) là chuỗi literal có chữ → báo.
 *  - Bỏ qua: nội dung `<code>`, `<kbd>`, `<pre>`, `<samp>` (phím tắt, mã), chuỗi trong tuỳ chọn `allow` (tên riêng/thương hiệu:
 *    TOEIC, Allingo…), một chữ cái Latin đơn (nhãn phương án A–D, M/W/N người nói), và dòng có / ngay dưới dòng có
 *    `i18n-ignore` (trong JSX dùng chú thích khối có chữ `i18n-ignore – lý do`).
 */

const LETTER = /\p{L}/u;
const DEFAULT_ATTRS = ['aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'title', 'placeholder', 'alt', 'label'];
const RAW_ELEMENTS = new Set(['code', 'kbd', 'pre', 'samp']);

/** Chuỗi có cần dịch không (có chữ cái, không thuộc danh sách cho phép, không phải một chữ Latin đơn) */
function needsTranslation(raw, allow) {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text || !LETTER.test(text)) return false;
  if (allow.has(text)) return false;
  if (/^[A-Za-z]$/.test(text)) return false;
  // Mọi "từ" có chữ đều thuộc danh sách cho phép (vd "TOEIC ·", "Pro")
  const words = text.split(/[\s·•|/()\-–—:,.+]+/).filter((w) => LETTER.test(w));
  if (words.length && words.every((w) => allow.has(w) || /^[A-Za-z]$/.test(w))) return false;
  return true;
}

function elementName(node) {
  const n = node && node.openingElement && node.openingElement.name;
  if (!n) return null;
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return n.property.name;
  return null;
}

function insideRawElement(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'JSXElement' && RAW_ELEMENTS.has(elementName(p))) return true;
  }
  return false;
}

/** Chuỗi literal tĩnh của một biểu thức (Literal string hoặc TemplateLiteral không có biểu thức) */
function staticString(expr) {
  if (!expr) return null;
  if (expr.type === 'Literal' && typeof expr.value === 'string') return expr.value;
  if (expr.type === 'TemplateLiteral' && expr.expressions.length === 0) return expr.quasis.map((q) => q.value.cooked ?? '').join('');
  return null;
}

function ignoredByComment(context, node) {
  const src = context.sourceCode ?? context.getSourceCode();
  const line = node.loc.start.line;
  const lines = src.lines;
  return /i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '');
}

/** @type {import('eslint').Rule.RuleModule} */
export const noJsxLiteralText = {
  meta: {
    type: 'problem',
    docs: { description: 'Chuỗi hiển thị trong JSX phải dùng next-intl (useTranslations/getTranslations)' },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
          attributes: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      text: 'Chuỗi cứng trong JSX "{{text}}" – dùng next-intl (t(...)) và thêm khoá vào packages/i18n.',
      attr: 'Thuộc tính {{name}}="{{text}}" là chuỗi cứng – dùng next-intl (t(...)).',
    },
  },
  create(context) {
    const opts = context.options[0] ?? {};
    const allow = new Set(opts.allow ?? []);
    const attrs = new Set(opts.attributes ?? DEFAULT_ATTRS);
    const short = (s) => {
      const t = s.replace(/\s+/g, ' ').trim();
      return t.length > 40 ? `${t.slice(0, 40)}…` : t;
    };
    return {
      JSXText(node) {
        if (!needsTranslation(node.value, allow) || insideRawElement(node) || ignoredByComment(context, node)) return;
        context.report({ node, messageId: 'text', data: { text: short(node.value) } });
      },
      JSXExpressionContainer(node) {
        if (!node.parent || (node.parent.type !== 'JSXElement' && node.parent.type !== 'JSXFragment')) return;
        const s = staticString(node.expression);
        if (s === null || !needsTranslation(s, allow) || insideRawElement(node) || ignoredByComment(context, node)) return;
        context.report({ node, messageId: 'text', data: { text: short(s) } });
      },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !attrs.has(node.name.name) || !node.value) return;
        const s = node.value.type === 'Literal' ? (typeof node.value.value === 'string' ? node.value.value : null) : node.value.type === 'JSXExpressionContainer' ? staticString(node.value.expression) : null;
        if (s === null || !needsTranslation(s, allow) || ignoredByComment(context, node)) return;
        context.report({ node, messageId: 'attr', data: { name: node.name.name, text: short(s) } });
      },
    };
  },
};

export default { rules: { 'no-jsx-literal-text': noJsxLiteralText } };
