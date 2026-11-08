import { Suspense, type ReactNode } from 'react';
import { BookOpen, ChartLine, Check, FileCheck, Headphones, Image as ImageIcon, Layers, NotebookPen, PencilLine, Quote, Route, Sparkles, type LucideIcon } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Badge, buttonVariants, cn } from '@allingo/ui';
import { normalizeCmsHref } from '@/lib/cms/links';
import { pickText, type CmsBlock, type CmsCta, type CtaBlock, type FaqBlock, type FeaturesBlock, type HeroBlock, type PricingBlock, type TestimonialBlock } from '@/lib/cms/types';

/**
 * Render blocks trang CMS (S10) ở SERVER – không JS client (trừ phần tử truyền vào qua `heroActions`/`heroAside`). Văn bản
 * {vi, en} chọn theo locale (fallback en → vi). Liên kết qua `normalizeCmsHref` (thêm locale, chặn scheme nguy hiểm). Block
 * pricing chỉ là phần giới thiệu – giá thật ở /pricing (billing là nguồn sự thật, ADR-0019). Testimonial chỉ hiện khi có đồng ý.
 */

const ICONS: Record<string, LucideIcon> = { 'file-check': FileCheck, sparkles: Sparkles, route: Route, 'notebook-pen': NotebookPen, layers: Layers, 'chart-line': ChartLine, image: ImageIcon, headphones: Headphones, 'pencil-line': PencilLine, 'book-open': BookOpen };

export interface BlockContext {
  locale: string;
  /** Nút bổ sung đặt TRƯỚC CTA của hero (vd "Luyện thử miễn phí" – tạo khách) */
  heroActions?: ReactNode;
  /** Cột phải của hero (vd câu mẫu tương tác) */
  heroAside?: ReactNode;
  /** Chèn sau hero (vd 4 chương trình) */
  afterHero?: ReactNode;
}

function CtaLink({ cta, locale, variant = 'outline', size = 'lg', testId }: { cta: CmsCta | null | undefined; locale: string; variant?: 'outline' | 'gold' | 'navy' | 'link'; size?: 'lg' | 'default' | 'sm'; testId?: string }) {
  const label = pickText(cta?.label, locale);
  const safe = normalizeCmsHref(cta?.href, locale);
  if (!label || !safe) return null;
  return (
    <a href={safe.href} className={cn(buttonVariants({ variant, size }))} {...(safe.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})} data-testid={testId}>
      {label}
    </a>
  );
}

function Hero({ b, ctx }: { b: HeroBlock; ctx: BlockContext }) {
  const eyebrow = pickText(b.eyebrow, ctx.locale);
  const sub = pickText(b.subheading, ctx.locale);
  return (
    <section className={cn('mx-auto grid max-w-6xl gap-10 px-4 pt-12 pb-14 sm:px-6 lg:items-center lg:gap-16 lg:pt-20 lg:pb-20', ctx.heroAside ? 'lg:grid-cols-[1.05fr_0.95fr]' : '')} data-testid="block-hero">
      <div className="max-w-2xl">
        <h1 className="text-navy dark:text-foreground">
          {eyebrow ? <span className="mb-3 block text-sm font-semibold tracking-wide text-accent-foreground uppercase dark:text-accent">{eyebrow}</span> : null}
          <span className="block text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl">{pickText(b.heading, ctx.locale)}</span>
        </h1>
        {sub ? <p className="mt-5 text-lg leading-relaxed text-muted-foreground sm:text-xl">{sub}</p> : null}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {ctx.heroActions}
          <CtaLink cta={b.primaryCta} locale={ctx.locale} variant={ctx.heroActions ? 'outline' : 'gold'} testId="hero-primary" />
          <CtaLink cta={b.secondaryCta} locale={ctx.locale} variant="link" size="default" testId="hero-secondary" />
        </div>
      </div>
      {ctx.heroAside}
    </section>
  );
}

function Features({ b, locale }: { b: FeaturesBlock; locale: string }) {
  const items = b.items ?? [];
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" data-testid="block-features">
      <h2 className="max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{pickText(b.heading, locale)}</h2>
      <ul className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((f, i) => {
          const Icon = (f.icon && ICONS[f.icon]) || Sparkles;
          return (
            <li key={f.id ?? i} className="border-l-4 border-accent pl-5">
              <Icon className="size-6 text-navy dark:text-accent" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold">{pickText(f.title, locale)}</h3>
              {pickText(f.body, locale) ? <p className="mt-2 leading-relaxed text-muted-foreground">{pickText(f.body, locale)}</p> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

async function Pricing({ b, locale }: { b: PricingBlock; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'marketing.pricing' });
  const free = t.raw('freeItems') as string[];
  const pro = t.raw('proItems') as string[];
  const pricingHref = normalizeCmsHref('/pricing', locale)!.href;
  return (
    <section className="border-y border-border bg-card" data-testid="block-pricing">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pickText(b.heading, locale) || t('heading')}</h2>
        {pickText(b.note, locale) ? <p className="mt-2 max-w-2xl text-muted-foreground">{pickText(b.note, locale)}</p> : null}
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {(
            [
              ['free', free, false],
              ['pro', pro, true],
            ] as const
          ).map(([key, items, highlight]) => (
            <div key={key} className={cn('flex flex-col rounded-2xl border p-6', highlight ? 'border-navy bg-navy text-navy-foreground' : 'border-border bg-background')}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-bold">{t(`${key}Name`)}</h3>
                {highlight ? <Badge variant="gold">{t('popular')}</Badge> : null}
              </div>
              <p className={cn('mt-1 text-sm', highlight ? 'text-white/80' : 'text-muted-foreground')}>{t(`${key}Desc`)}</p>
              <ul className="mt-5 space-y-2 text-sm">
                {items.map((it) => (
                  <li key={it} className="flex items-start gap-2">
                    <Check className={cn('mt-0.5 size-4 shrink-0', highlight ? 'text-accent' : 'text-success')} aria-hidden />
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <a href={pricingHref} className={cn(buttonVariants({ variant: 'gold', size: 'lg' }), 'mt-8')} data-testid="pricing-link">
          {t('cta')}
        </a>
      </div>
    </section>
  );
}

function Faq({ b, locale }: { b: FaqBlock; locale: string }) {
  const items = (b.items ?? []).filter((f) => pickText(f.question, locale) && pickText(f.answer, locale));
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6" data-testid="block-faq">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pickText(b.heading, locale)}</h2>
      <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
        {items.map((f, i) => (
          <details key={f.id ?? i} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
              {pickText(f.question, locale)}
              <span aria-hidden className="text-xl leading-none text-muted-foreground transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 leading-relaxed text-muted-foreground">{pickText(f.answer, locale)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Testimonials({ b, locale }: { b: TestimonialBlock; locale: string }) {
  const items = (b.items ?? []).filter((x) => x.consent === true && pickText(x.quote, locale) && x.name);
  if (!items.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6" data-testid="block-testimonial">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pickText(b.heading, locale)}</h2>
      <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((x, i) => (
          <li key={x.id ?? i}>
            <figure className="h-full rounded-2xl border border-border bg-card p-6">
              <Quote className="size-5 text-accent" aria-hidden />
              <blockquote className="mt-3 leading-relaxed">{pickText(x.quote, locale)}</blockquote>
              <figcaption className="mt-4 text-sm">
                <span className="font-semibold">{x.name}</span>
                {pickText(x.role, locale) ? <span className="text-muted-foreground"> · {pickText(x.role, locale)}</span> : null}
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Cta({ b, locale }: { b: CtaBlock; locale: string }) {
  return (
    <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6" data-testid="block-cta">
      <div className="flex flex-col items-start gap-5 rounded-3xl bg-navy px-6 py-10 text-navy-foreground sm:px-10 md:flex-row md:items-center md:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{pickText(b.heading, locale)}</h2>
          {pickText(b.body, locale) ? <p className="mt-2 text-white/80">{pickText(b.body, locale)}</p> : null}
        </div>
        <CtaLink cta={b.button} locale={locale} variant="gold" testId="cta-button" />
      </div>
    </section>
  );
}

/**
 * Phần dưới hero (thuần server) bọc Suspense: React hydrate ranh giới này SAU, ở độ ưu tiên thấp và chia nhỏ (không chặn luồng
 * chính) – giảm Total Blocking Time của trang marketing; hero (nút client) vẫn hydrate ngay.
 */
export function HydrateLater({ children }: { children: ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>;
}

export function Blocks({ blocks, ctx }: { blocks: CmsBlock[] | null | undefined; ctx: BlockContext }) {
  const list = blocks ?? [];
  const out: ReactNode[] = [];
  for (const [i, b] of list.entries()) {
    const key = b.id ?? `${b.blockType}-${i}`;
    switch (b.blockType) {
      case 'hero':
        out.push(<Hero key={key} b={b} ctx={ctx} />);
        if (ctx.afterHero) out.push(<HydrateLater key={`${key}-after`}>{ctx.afterHero}</HydrateLater>);
        break;
      case 'features':
        out.push(
          <HydrateLater key={key}>
            <Features b={b} locale={ctx.locale} />
          </HydrateLater>,
        );
        break;
      case 'pricing':
        out.push(
          <HydrateLater key={key}>
            <Pricing b={b} locale={ctx.locale} />
          </HydrateLater>,
        );
        break;
      case 'faq':
        out.push(
          <HydrateLater key={key}>
            <Faq b={b} locale={ctx.locale} />
          </HydrateLater>,
        );
        break;
      case 'testimonial':
        out.push(
          <HydrateLater key={key}>
            <Testimonials b={b} locale={ctx.locale} />
          </HydrateLater>,
        );
        break;
      case 'cta':
        out.push(
          <HydrateLater key={key}>
            <Cta b={b} locale={ctx.locale} />
          </HydrateLater>,
        );
        break;
      default:
        break;
    }
  }
  return <>{out}</>;
}

/** Mọi câu hỏi FAQ của trang (JSON-LD FAQPage) */
export function faqItemsOf(blocks: CmsBlock[] | null | undefined): NonNullable<FaqBlock['items']> {
  return (blocks ?? []).filter((b): b is FaqBlock => b.blockType === 'faq').flatMap((b) => b.items ?? []);
}
