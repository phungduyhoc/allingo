import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import { noJsxLiteralText } from './no-jsx-literal-text.js';

// RuleTester dùng describe/it của vitest
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });
const allow = [{ allow: ['TOEIC', 'Allingo', 'Pro'] }];

tester.run('allingo/no-jsx-literal-text (S11 i18n lint)', noJsxLiteralText, {
  valid: [
    // next-intl, biến, số, dấu câu/ký hiệu, khoảng trắng
    { code: "const A = () => <p>{t('title')} · {count} — {pct}% → {a}/{b}</p>;" },
    { code: 'const A = () => <p>   </p>;' },
    { code: 'const A = () => <p>{1234} {"·"} {`—`} ( ) : 100%</p>;' },
    // nhãn phương án một chữ cái, tên riêng trong danh sách cho phép
    { code: 'const A = () => <span>A</span>;', options: allow },
    { code: 'const A = () => <span>TOEIC · Pro</span>;', options: allow },
    { code: 'const A = () => <span>{"Allingo"}</span>;', options: allow },
    // nội dung mã/phím tắt
    { code: 'const A = () => <p><kbd>Esc</kbd> <code>npm run dev</code></p>;' },
    // thuộc tính không hiển thị + thuộc tính hiển thị đã dịch
    { code: "const A = () => <div className=\"flex gap-2\" data-testid=\"explain-button\" aria-label={t('x')} id=\"main\" type=\"button\" />;" },
    // chuỗi trong biểu thức có logic (không phải literal tĩnh) – để code review
    { code: "const A = () => <p>{ok ? t('a') : t('b')}</p>;" },
    // bỏ qua có chủ đích
    { code: 'const A = () => (\n  <p>\n    {/* i18n-ignore – định dạng CSV kỹ thuật */}\n    <input placeholder="provider_txn_id,amount" />\n  </p>\n);' },
  ],
  invalid: [
    { code: 'const A = () => <p>Xin chào</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const A = () => <p>Hello world</p>;', errors: [{ messageId: 'text' }] },
    { code: "const A = () => <p>{'Đang tải…'}</p>;", errors: [{ messageId: 'text' }] },
    { code: 'const A = () => <p>{`Thử lại`}</p>;', errors: [{ messageId: 'text' }] },
    { code: 'const A = () => <><b>{t("a")}</b> credit</>;', errors: [{ messageId: 'text' }] },
    { code: 'const A = () => <button aria-label="Đóng" title="Close" />;', errors: [{ messageId: 'attr' }, { messageId: 'attr' }] },
    { code: 'const A = () => <input placeholder={"Tìm kiếm"} />;', errors: [{ messageId: 'attr' }] },
    { code: 'const A = () => <img alt="Ảnh minh hoạ" />;', errors: [{ messageId: 'attr' }] },
    // chữ không phải Latin cũng bị bắt (ja/ko/th)
    { code: 'const A = () => <p>こんにちは</p>;', errors: [{ messageId: 'text' }] },
    // tên riêng lẫn chữ cần dịch
    { code: 'const A = () => <p>Luyện TOEIC</p>;', options: allow, errors: [{ messageId: 'text' }] },
  ],
});
