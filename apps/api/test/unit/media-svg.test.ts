import { describe, expect, it } from 'vitest';
import { inspectSvg, looksLikeSvg, MAX_SVG_BYTES } from '../../src/modules/speech/media/svg.js';
import { assetIdsOfContent, normalizeTranscript } from '../../src/modules/catalog/index.js';

const ok = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 640 480"><defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><use xlink:href="#g"/><image href="data:image/png;base64,iVBORw0KGgo="/><text>Meeting data: 9 am, on time</text></svg>';

describe('SVG nội dung (Sprint 4 – ảnh Part 1)', () => {
  it('nhận diện ứng viên SVG (BOM, <?xml, comment) và bỏ qua nhị phân', () => {
    expect(looksLikeSvg(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(true);
    expect(looksLikeSvg(Buffer.from('﻿  <?xml version="1.0"?><svg>'))).toBe(true);
    expect(looksLikeSvg(Buffer.from('<!-- drawn by hand --><svg>'))).toBe(true);
    expect(looksLikeSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(looksLikeSvg(Buffer.from('#EXTM3U'))).toBe(false);
  });

  it('chấp nhận SVG tĩnh (gradient nội bộ, href #id, ảnh data:image/png) và lấy kích thước từ viewBox / width-height', () => {
    expect(inspectSvg(ok)).toEqual({ ok: true, width: 640, height: 480 });
    expect(inspectSvg('<svg width="320px" height="200" viewBox="0 0 10 10"></svg>')).toEqual({ ok: true, width: 320, height: 200 });
    expect(inspectSvg('<svg width="100%"></svg>')).toEqual({ ok: true, width: null, height: null });
  });

  it.each([
    ['<svg><script>alert(1)</script></svg>', 'script'],
    ['<svg onload="alert(1)"></svg>', 'event handler'],
    ['<svg><a href="javascript:alert(1)"><text>x</text></a></svg>', 'script URL'],
    ['<svg><foreignObject><div/></foreignObject></svg>', 'foreignObject'],
    ['<svg><image href="https://evil.example/track.png"/></svg>', 'external href'],
    ['<svg><use xlink:href="http://x/y.svg#a"/></svg>', 'external href'],
    ['<svg><style>@import url(https://x/a.css);</style></svg>', '@import'],
    ['<svg><rect style="fill:url(https://x/p)"/></svg>', 'url()'],
    ['<svg><image href="data:text/html;base64,PHNjcmlwdD4="/></svg>', 'data URL'],
    ['<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>', 'entity'],
    ['<?xml version="1.0"?><!DOCTYPE svg [ ]><svg></svg>', 'DOCTYPE'],
    ['<svg><iframe src="x"/></svg>', 'embedded'],
    ['<html><body>no svg</body></html>', 'no <svg>'],
  ])('từ chối %s', (svg, reason) => {
    const r = inspectSvg(svg);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain(reason);
  });

  it('từ chối SVG quá 2 MB', () => {
    expect(inspectSvg(Buffer.alloc(MAX_SVG_BYTES + 1, 0x20)).reason).toBe('SVG too large');
  });
});

describe('catalog helpers (Sprint 4)', () => {
  it('assetIdsOfContent: media câu, ảnh đề, lựa chọn audio/ảnh', () => {
    const ids = assetIdsOfContent({
      type: 'mcq_single',
      stem: '',
      options: [
        { key: 'A', text: '', audio_asset_id: '00000000-0000-4000-8000-00000000000a' },
        { key: 'B', text: '', image_asset_id: '00000000-0000-4000-8000-00000000000b' },
      ],
      answer_key: { correct: 'A' },
      media: { audio_asset_id: '00000000-0000-4000-8000-000000000001', image_asset_id: '00000000-0000-4000-8000-000000000002', listen_policy: 'once' },
      tags: [],
    });
    expect(ids.sort()).toEqual(['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b']);
  });

  it('normalizeTranscript: mảng mốc thời gian, {text} cũ, chuỗi, rỗng', () => {
    expect(normalizeTranscript([{ start_ms: 0, end_ms: 1000.4, text: 'Hello', speaker: 'W' }, { text: 'there' }])).toEqual({
      text: 'Hello there',
      segments: [
        { start_ms: 0, end_ms: 1000, text: 'Hello', speaker: 'W' },
        { start_ms: null, end_ms: null, text: 'there', speaker: null },
      ],
    });
    expect(normalizeTranscript({ text: ' Q: Where? ' })).toEqual({ text: 'Q: Where?' });
    expect(normalizeTranscript('abc')).toEqual({ text: 'abc' });
    expect(normalizeTranscript(null)).toBeNull();
    expect(normalizeTranscript([])).toBeNull();
  });
});
