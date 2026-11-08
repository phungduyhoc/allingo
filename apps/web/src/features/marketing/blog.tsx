import Image from 'next/image';
import { CalendarDays, Clock, UserRound } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { Badge, buttonVariants, cn } from '@allingo/ui';
import { absoluteMediaUrl } from '@/lib/cms/client';
import { lexicalPlainText, renderLexical } from '@/lib/cms/lexical';
import { asMedia, pickText, type CmsAuthor, type CmsPost } from '@/lib/cms/types';
import { localePath } from '@/lib/seo/site';

/**
 * Blog (S10) – server component, không JS client. Danh sách thẻ bài + trang bài: tiêu đề, chuyên mục, tác giả, ngày, phút đọc,
 * ảnh bìa (`next/image` unoptimized – ảnh do CMS phục vụ), nội dung Lexical (renderer an toàn), FAQ, tác giả, CTA đăng ký.
 * Bài chỉ có bản vi → trang en hiển thị bản vi (fallback en → vi theo CLAUDE.md §5.11).
 */

function authorsOf(post: CmsPost): CmsAuthor[] {
  return (post.authors ?? []).filter((a): a is CmsAuthor => typeof a === 'object' && !!a);
}

function readingMinutes(post: CmsPost, locale: string): number {
  if (post.readingMinutes) return post.readingMinutes;
  const words = lexicalPlainText(post.content?.[locale === 'en' ? 'en' : 'vi'] ?? post.content?.vi).split(' ').filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

function Cover({ post, locale, priority = false, className }: { post: CmsPost; locale: string; priority?: boolean; className?: string }) {
  const media = asMedia(post.coverImage);
  const src = absoluteMediaUrl(media?.sizes?.card?.url ?? media?.url);
  if (!media || !src) return null;
  return <Image src={src} alt={pickText(media.alt, locale)} width={media.sizes?.card?.width ?? media.width ?? 640} height={media.sizes?.card?.height ?? media.height ?? 360} unoptimized priority={priority} className={cn('h-auto w-full rounded-xl object-cover', className)} />;
}

export async function BlogIndex({ locale, posts }: { locale: string; posts: CmsPost[] }) {
  const t = await getTranslations({ locale, namespace: 'marketing.blog' });
  const fmt = await getFormatter({ locale });
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16" data-testid="blog-index">
      <header className="max-w-2xl">
        <h1 className="text-4xl font-extrabold tracking-tight text-navy sm:text-5xl dark:text-foreground">{t('title')}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{t('subtitle')}</p>
      </header>
      {posts.length === 0 ? (
        <p className="mt-10 rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground" data-testid="blog-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => {
            const cat = typeof p.category === 'object' && p.category ? pickText(p.category.name, locale) : '';
            const date = p.publishedAt ?? p.updatedAt;
            return (
              <li key={p.id} data-testid="blog-card" data-slug={p.slug}>
                <article className="flex h-full flex-col gap-3 rounded-2xl border border-border bg-card p-5">
                  <Cover post={p} locale={locale} />
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {cat ? <Badge variant="secondary">{cat}</Badge> : null}
                    {date ? <time dateTime={date}>{fmt.dateTime(new Date(date), { dateStyle: 'medium' })}</time> : null}
                    <span>· {t('minutes', { count: readingMinutes(p, locale) })}</span>
                  </div>
                  <h2 className="text-lg leading-snug font-bold">
                    <a href={localePath(locale, `/blog/${p.slug}`)} className="outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40" data-testid="blog-card-link">
                      {pickText(p.title, locale)}
                    </a>
                  </h2>
                  {pickText(p.excerpt, locale) ? <p className="text-sm leading-relaxed text-muted-foreground">{pickText(p.excerpt, locale)}</p> : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export async function PostView({ locale, post }: { locale: string; post: CmsPost }) {
  const t = await getTranslations({ locale, namespace: 'marketing.blog' });
  const fmt = await getFormatter({ locale });
  const content = post.content?.[locale === 'en' ? 'en' : 'vi'] ?? post.content?.vi ?? post.content?.en ?? null;
  const fellBack = locale === 'en' && !post.content?.en && !!post.content?.vi;
  const cat = typeof post.category === 'object' && post.category ? post.category : null;
  const authors = authorsOf(post);
  const date = post.publishedAt ?? post.updatedAt;
  const faq = (post.faq ?? []).filter((f) => pickText(f.question, locale) && pickText(f.answer, locale));
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14" data-testid="blog-post" data-slug={post.slug}>
      <nav aria-label={t('breadcrumb')} className="text-sm text-muted-foreground">
        <a href={localePath(locale, '/blog')} className="hover:underline">
          {t('title')}
        </a>
        {cat ? <span> / {pickText(cat.name, locale)}</span> : null}
      </nav>
      <header className="mt-4 space-y-4">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground" data-testid="blog-post-title">
          {pickText(post.title, locale)}
        </h1>
        {pickText(post.excerpt, locale) ? <p className="text-lg leading-relaxed text-muted-foreground">{pickText(post.excerpt, locale)}</p> : null}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {authors.length ? (
            <span className="inline-flex items-center gap-1.5" data-testid="blog-post-authors">
              <UserRound className="size-4" aria-hidden />
              {authors.map((a) => a.name).join(', ')}
            </span>
          ) : null}
          {date ? (
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              <time dateTime={date}>{fmt.dateTime(new Date(date), { dateStyle: 'long' })}</time>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden />
            {t('minutes', { count: readingMinutes(post, locale) })}
          </span>
        </p>
      </header>
      <Cover post={post} locale={locale} priority className="mt-8" />
      {fellBack ? <p className="mt-6 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{t('fallbackNotice')}</p> : null}
      <div className="prose-blog mt-8" lang={fellBack ? 'vi' : locale} data-testid="blog-post-content">
        {renderLexical(content, { locale })}
      </div>
      {faq.length ? (
        <section aria-labelledby="post-faq" className="mt-12 space-y-3">
          <h2 id="post-faq" className="text-xl font-bold">
            {t('faq')}
          </h2>
          <dl className="space-y-4">
            {faq.map((f, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-4">
                <dt className="font-semibold">{pickText(f.question, locale)}</dt>
                <dd className="mt-1.5 text-muted-foreground">{pickText(f.answer, locale)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {authors.some((a) => pickText(a.bio, locale)) ? (
        <aside className="mt-12 space-y-2 rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">{t('aboutAuthor')}</h2>
          {authors.map((a) => (
            <p key={a.id} className="text-sm">
              <span className="font-semibold">{a.name}</span> – {pickText(a.bio, locale)}
            </p>
          ))}
        </aside>
      ) : null}
      <div className="mt-12 flex flex-col items-start gap-4 rounded-2xl bg-navy px-6 py-8 text-navy-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="text-lg font-semibold">{t('ctaTitle')}</p>
        <a href={localePath(locale, '/register')} className={buttonVariants({ variant: 'gold' })}>
          {t('ctaButton')}
        </a>
      </div>
    </article>
  );
}
