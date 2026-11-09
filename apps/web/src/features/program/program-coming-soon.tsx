'use client';

import { BellRing, CheckCircle2, Hourglass } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DEFAULT_PROGRAM } from '@allingo/schemas/program/registry';
import type { ProgramCode } from '@allingo/schemas/common';
import { Badge, Button } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { useMe } from '@/lib/queries';
import { WaitlistForm } from '@/features/marketing/waitlist-form';
import { programHref } from './program-context';
import { useSwitchProgram } from './use-switch-program';

/**
 * C1 – khu học của chương trình chưa có nội dung/chưa ra mắt (IELTS tới C3, JLPT/HSK tới GĐ3): giới thiệu ngắn + đăng ký danh sách
 * chờ (POST /waitlist – BETA-02, email điền sẵn từ tài khoản) + nút quay về chương trình đang mở. HTTP vẫn 200 (trang hợp lệ).
 */
export function ProgramComingSoon({ program }: { program: ProgramCode | null }) {
  const t = useTranslations('programArea');
  const tp = useTranslations('programs');
  const tc = useTranslations('marketing.comingSoon');
  const me = useMe();
  const router = useRouter();
  const sw = useSwitchProgram();
  if (!program || program === DEFAULT_PROGRAM)
    return (
      <div className="mx-auto max-w-xl py-16 text-center" data-testid="program-unknown">
        <Hourglass className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-2xl font-bold">{t('unknownTitle')}</h1>
        <Button variant="navy" className="mt-6" onClick={() => router.push(programHref(DEFAULT_PROGRAM, 'dashboard'))}>
          {t('backTo', { program: tp(DEFAULT_PROGRAM) })}
        </Button>
      </div>
    );
  const name = tp(program);
  const points = tc.raw(`points.${program}`) as string[];
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]" data-testid="program-coming-soon" data-program={program}>
      <div className="max-w-xl">
        <Badge variant="gold">{tp('comingSoon')}</Badge>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground">{t('title', { program: name })}</h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">{t('desc', { program: name })}</p>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          className="mt-8"
          disabled={sw.isPending}
          onClick={() => sw.switchTo(DEFAULT_PROGRAM)}
          data-testid="coming-soon-back"
        >
          {t('backTo', { program: tp(DEFAULT_PROGRAM) })}
        </Button>
      </div>
      <section aria-labelledby="program-waitlist-title" className="h-fit rounded-2xl border border-border bg-card p-6">
        <h2 id="program-waitlist-title" className="flex items-center gap-2 text-lg font-bold">
          <BellRing className="size-5 text-accent" aria-hidden />
          {tc('formTitle', { program: name })}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{tc('formDesc')}</p>
        <WaitlistForm program={program} defaultEmail={me.data?.email ?? ''} />
      </section>
    </div>
  );
}
