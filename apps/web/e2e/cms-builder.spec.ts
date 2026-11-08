import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * A26 + B5 (CMS thật): trình dựng bộ đề `/admin/test-set-builder` – ↑/↓ đổi thứ tự khối câu, bớt câu, blueprint chặn xuất bản,
 * lưu qua REST collection (sortOrder 1…n); passage nhiều văn bản – `body` gộp tự sinh từ "Các văn bản".
 * Chỉ chạy khi có CMS + API thật: E2E_REAL_API=1 E2E_CMS_URL=http://localhost:3001 (tài khoản seed CMS), desktop.
 */
const CMS = process.env.E2E_CMS_URL;
const CMS_PASSWORD = process.env.E2E_CMS_PASSWORD ?? 'Allingo@2026';
const TAG = `e2e${Date.now().toString(36)}`;

async function cmsLogin(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post(`${CMS}/api/users/login`, { data: { email, password: CMS_PASSWORD } });
  expect(r.ok()).toBeTruthy();
  return ((await r.json()) as { token: string }).token;
}

test('CMS trình dựng bộ đề: ↑/↓ khối câu, bớt câu, blueprint chặn xuất bản, lưu; passage nhiều văn bản gộp body', async ({ page, request, isMobile }) => {
  test.skip(!CMS || process.env.E2E_REAL_API !== '1', 'cần E2E_CMS_URL + E2E_REAL_API=1');
  test.skip(isMobile, 'CMS admin – desktop');
  test.setTimeout(120_000);
  const token = await cmsLogin(request, 'admin@allingo.dev');
  const auth = { Authorization: `JWT ${token}` };

  // B5: passage 2 văn bản → body gộp `[Tiêu đề]\n…` (catalog nhận parts qua /internal/content/passages/sync)
  const p = await request.post(`${CMS}/api/passages`, {
    headers: auth,
    data: { title: `Bộ đôi ${TAG}`, program: 'toeic', kind: 'reading_passage', status: 'ready', parts: [{ title: 'Notice', body: `Open 9 to 5 ${TAG}.` }, { title: 'E-mail', body: 'Can I visit at 8?' }] },
  });
  expect(p.ok(), await p.text()).toBeTruthy();
  const passage = ((await p.json()) as { doc: { id: string; body: string } }).doc;
  expect(passage.body).toBe(`[Notice]\nOpen 9 to 5 ${TAG}.\n\n[E-mail]\nCan I visit at 8?`);

  // Bộ đề nháp 3 câu Part 5 đã phát hành
  const qs = await request.get(`${CMS}/api/questions?limit=3&depth=0&where[status][equals]=published&where[sectionCode][equals]=part5&sort=-updatedAt`, { headers: auth });
  const ids = ((await qs.json()) as { docs: Array<{ id: string }> }).docs.map((d) => d.id);
  expect(ids).toHaveLength(3);
  const ts = await request.post(`${CMS}/api/test_sets`, {
    headers: auth,
    data: {
      program: 'toeic',
      code: `e2e-builder-${TAG}`,
      kind: 'part_drill',
      title: { vi: `Bộ dựng thử ${TAG}` },
      status: 'draft',
      sections: [{ sectionCode: 'part5' }],
      items: ids.map((id, i) => ({ question: id, sectionCode: 'part5', sortOrder: i + 1, points: 1 })),
    },
  });
  expect(ts.ok(), await ts.text()).toBeTruthy();
  const setId = ((await ts.json()) as { doc: { id: string } }).doc.id;

  try {
    await page.context().addCookies([{ name: 'payload-token', value: token, url: CMS! }]);
    await page.goto(`${CMS}/admin/test-set-builder?id=${setId}`);
    const builder = page.getByTestId('test-set-builder');
    await expect(builder).toBeVisible({ timeout: 30_000 });
    const questions = builder.getByTestId('builder-units-part5').getByTestId('builder-question');
    await expect(questions).toHaveCount(3);
    const order = () => questions.evaluateAll((els) => els.map((e) => e.getAttribute('data-question')));
    expect(await order()).toEqual(ids);

    // ↓ trên khối đầu → đổi chỗ với khối 2; đánh dấu có thay đổi
    await builder.getByTestId('builder-unit-down').first().click();
    expect(await order()).toEqual([ids[1], ids[0], ids[2]]);
    await expect(builder).toHaveAttribute('data-dirty', 'true');
    // Bớt câu cuối
    await questions.nth(2).getByTestId('builder-remove').click();
    await expect(questions).toHaveCount(2);

    // Blueprint mini 60 → lệch số câu → lỗi + nút xuất bản bị khoá; bỏ blueprint → hết lỗi
    await page.getByRole('button', { name: 'TOEIC mini 60 câu' }).click();
    await expect(builder.getByTestId('builder-blueprint-error').first()).toBeVisible();
    await expect(builder.getByTestId('builder-bp-part5')).toHaveAttribute('data-ok', 'false');
    await expect(page.getByRole('button', { name: 'Lưu và xuất bản' })).toBeDisabled();
    await page.getByRole('button', { name: 'Bỏ blueprint' }).click();
    await expect(builder.getByTestId('builder-blueprint-error')).toHaveCount(0);

    // Lưu → REST: thứ tự mới, sortOrder 1…n, vẫn nháp
    await page.getByRole('button', { name: 'Lưu', exact: true }).click();
    await expect(builder).toHaveAttribute('data-dirty', 'false', { timeout: 20_000 });
    const saved = (await (await request.get(`${CMS}/api/test_sets/${setId}?depth=0`, { headers: auth })).json()) as { status: string; items: Array<{ question: string; sortOrder: number }> };
    expect(saved.status).toBe('draft');
    expect(saved.items.map((i) => [i.question, i.sortOrder])).toEqual([
      [ids[1], 1],
      [ids[0], 2],
    ]);
  } finally {
    await request.delete(`${CMS}/api/test_sets/${setId}`, { headers: auth });
    await request.delete(`${CMS}/api/passages/${passage.id}`, { headers: auth });
  }
});
