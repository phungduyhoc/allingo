import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, Fragment } from 'react';
import { lexicalHeadings, lexicalPlainText, renderLexical } from './lexical';
import { normalizeCmsHref } from './links';
import type { LexicalNode } from './types';

const text = (t: string, format = 0): LexicalNode => ({ type: 'text', text: t, format });
const doc = (...children: LexicalNode[]) => ({ root: { type: 'root', children } });
const html = (d: ReturnType<typeof doc>, locale = 'vi') => renderToStaticMarkup(createElement(Fragment, null, renderLexical(d, { locale })));

describe('Lexical → HTML an toàn', () => {
  it('đoạn, tiêu đề (h1 hạ thành h2), định dạng chữ, danh sách, trích dẫn', () => {
    const out = html(
      doc(
        { type: 'heading', tag: 'h1', children: [text('Tiêu đề')] },
        { type: 'paragraph', children: [text('Đậm', 1), text(' nghiêng', 2), text(' code', 16)] },
        { type: 'list', listType: 'number', children: [{ type: 'listitem', children: [text('Một')] }] },
        { type: 'list', listType: 'bullet', children: [{ type: 'listitem', children: [text('Hai')] }] },
        { type: 'quote', children: [text('Trích')] },
        { type: 'paragraph', children: [] },
      ),
    );
    expect(out).toBe('<h2>Tiêu đề</h2><p><strong>Đậm</strong><em> nghiêng</em><code> code</code></p><ol><li>Một</li></ol><ul><li>Hai</li></ul><blockquote>Trích</blockquote>');
  });

  it('chữ chứa HTML bị escape; nút lạ chỉ render chữ con', () => {
    const out = html(doc({ type: 'paragraph', children: [text('<img src=x onerror=alert(1)>')] }, { type: 'mystery-embed', children: [text('<b>x</b>')], html: '<script>alert(1)</script>' }));
    expect(out).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>&lt;b&gt;x&lt;/b&gt;');
    expect(out).not.toContain('<script');
  });

  it('liên kết: nội bộ thêm locale; ngoài → target/rel; javascript:/data: → chữ thường', () => {
    const link = (url: string): LexicalNode => ({ type: 'link', fields: { url }, children: [text('đây')] });
    expect(html(doc({ type: 'paragraph', children: [link('/blog/meo')] }))).toBe('<p><a href="/vi/blog/meo">đây</a></p>');
    expect(html(doc({ type: 'paragraph', children: [link('/blog/meo')] }), 'en')).toContain('href="/en/blog/meo"');
    expect(html(doc({ type: 'paragraph', children: [link('https://ets.org/toeic')] }))).toBe('<p><a href="https://ets.org/toeic" target="_blank" rel="noopener noreferrer nofollow">đây</a></p>');
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#x09;script:alert(1)', 'data:text/html,<script>', '//evil.example']) expect(html(doc({ type: 'paragraph', children: [link(bad)] }))).toBe('<p>đây</p>');
  });

  it('ảnh upload cần URL hợp lệ; chữ thuần + mục lục', () => {
    expect(html(doc({ type: 'upload', value: { url: 'javascript:alert(1)' } }))).toBe('');
    expect(html(doc({ type: 'upload', value: { url: 'https://cdn.example/a.png', alt: { vi: 'Ảnh' }, width: 10, height: 5 } }))).toContain('<img src="https://cdn.example/a.png" alt="Ảnh" width="10" height="5" loading="lazy" decoding="async"/>');
    const d = doc({ type: 'heading', tag: 'h2', children: [text('Một')] }, { type: 'paragraph', children: [text('a'), { type: 'linebreak' }, text('b')] });
    expect(lexicalPlainText(d)).toBe('Một ab');
    expect(lexicalHeadings(d)).toEqual(['Một']);
  });
});

describe('liên kết CMS', () => {
  it('bí danh đường dẫn + tham số next', () => {
    expect(normalizeCmsHref('/register?next=/diagnostic', 'vi')).toEqual({ href: '/vi/register?next=%2Ftoeic%2Fdiagnostic', external: false });
    expect(normalizeCmsHref('/', 'en')).toEqual({ href: '/en', external: false });
    expect(normalizeCmsHref('/vi/pricing', 'en')).toEqual({ href: '/vi/pricing', external: false });
    expect(normalizeCmsHref('#faq', 'vi')).toEqual({ href: '#faq', external: false });
    expect(normalizeCmsHref('mailto:hotro@allingo.vn', 'vi')).toEqual({ href: 'mailto:hotro@allingo.vn', external: true });
    expect(normalizeCmsHref('ftp://x', 'vi')).toBeNull();
    expect(normalizeCmsHref('', 'vi')).toBeNull();
  });
});
