/**
 * Seed marketing & blog (Sprint 10, idempotent theo slug): 3 chuyên mục, 1 tác giả (ban biên tập), 3 bài blog tự viết, 2 trang
 * blocks (`home` = /, `toeic` = /toeic) – tất cả ở trạng thái published. Đã có slug → giữ nguyên (không ghi đè chỉnh sửa của
 * biên tập viên). Chạy:  cd apps/cms && pnpm exec tsx scripts/seed-marketing.ts   (cần DATABASE_URL, PAYLOAD_SECRET)
 * Không chạy trên production trừ khi SEED_MARKETING_ALLOW_PROD=1.
 */
import { getPayload, type Payload } from 'payload';
import config from '../src/payload.config';
import { lexical, readingMinutes } from '../src/lib/lexical';
import { SEED_AUTHOR, SEED_CATEGORIES, SEED_PAGES, SEED_POSTS } from './marketing-content';

export const LEGACY_CTA = '"/register?next=/diagnostic"';
export const FIXED_CTA = '"/register?next=/toeic/diagnostic"';

async function findBySlug(payload: Payload, collection: 'categories' | 'authors' | 'posts' | 'pages', slug: string) {
  const r = await payload.find({ collection, where: { slug: { equals: slug } }, limit: 1, depth: 0, draft: true, overrideAccess: true });
  return r.docs[0] ?? null;
}

export async function seedMarketing(payload: Payload): Promise<{ created: number; kept: number }> {
  let created = 0;
  let kept = 0;
  const catIds = new Map<string, string>();
  for (const c of SEED_CATEGORIES) {
    const found = await findBySlug(payload, 'categories', c.slug);
    if (found) {
      kept++;
      catIds.set(c.slug, String(found.id));
      continue;
    }
    const doc = await payload.create({ collection: 'categories', data: { slug: c.slug, name: { ...c.name }, description: { ...c.description } }, overrideAccess: true });
    catIds.set(c.slug, String(doc.id));
    created++;
  }
  let author = await findBySlug(payload, 'authors', SEED_AUTHOR.slug);
  if (!author) {
    author = await payload.create({ collection: 'authors', data: { slug: SEED_AUTHOR.slug, name: SEED_AUTHOR.name, bio: SEED_AUTHOR.bio }, overrideAccess: true });
    created++;
  } else kept++;
  for (const p of SEED_POSTS) {
    if (await findBySlug(payload, 'posts', p.slug)) {
      kept++;
      continue;
    }
    await payload.create({
      collection: 'posts',
      draft: false,
      overrideAccess: true,
      data: {
        _status: 'published',
        slug: p.slug,
        title: p.title,
        excerpt: p.excerpt,
        content: { vi: lexical(p.content.vi), en: lexical(p.content.en) },
        category: catIds.get(p.category),
        authors: [String(author.id)],
        program: 'toeic',
        publishedAt: p.publishedAt,
        readingMinutes: readingMinutes(p.content.vi),
        schemaType: 'BlogPosting',
        faq: p.faq ?? [],
        seo: { title: p.seo.title, description: p.seo.description, noindex: false },
      },
    });
    created++;
  }
  for (const pg of SEED_PAGES) {
    const existing = await findBySlug(payload, 'pages', pg.slug);
    if (existing) {
      kept++;
      // S12 (fix web S10): sửa CTA cũ `/register?next=/diagnostic` → `/register?next=/toeic/diagnostic` (chỉ đúng chuỗi seed cũ –
      // nội dung biên tập viên đã đổi khác thì giữ nguyên)
      const json = JSON.stringify((existing as { layout?: unknown }).layout ?? []);
      if (json.includes(LEGACY_CTA)) await payload.update({ collection: 'pages', id: existing.id, data: { layout: JSON.parse(json.split(LEGACY_CTA).join(FIXED_CTA)) as never }, overrideAccess: true });
      continue;
    }
    await payload.create({ collection: 'pages', draft: false, overrideAccess: true, data: { _status: 'published', slug: pg.slug, title: pg.title, layout: pg.layout as never, seo: { ...pg.seo, noindex: false } } });
    created++;
  }
  return { created, kept };
}

async function main() {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV;
  if (env === 'production' && process.env.SEED_MARKETING_ALLOW_PROD !== '1') {
    console.error('Không seed marketing trên production (đặt SEED_MARKETING_ALLOW_PROD=1 nếu thật sự cần).');
    process.exit(2);
  }
  const payload = await getPayload({ config });
  const r = await seedMarketing(payload);
  console.warn(`[seed:marketing] tạo mới ${r.created}, giữ nguyên ${r.kept}`);
  process.exit(0);
}

if (process.argv[1] && /seed-marketing\.ts$/.test(process.argv[1])) void main();
