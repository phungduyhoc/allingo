'use client';

import { useTranslations } from 'next-intl';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@allingo/ui';
import { formatBand, type BandView } from './ielts-band';

/**
 * C3 – thẻ band IELTS ở màn kết quả (thay thẻ "điểm quy đổi" TOEIC): band từng kỹ năng có trong bài, overall chỉ khi đủ 4 kỹ năng,
 * hình thức Reading, số câu đúng /40 từng kỹ năng; luôn ghi "ước tính".
 */
export function IeltsBandCard({ view }: { view: BandView }) {
  const t = useTranslations('result.ielts');
  const ts = useTranslations('sections');
  const tc = useTranslations('common');
  return (
    <Card className="bg-navy text-navy-foreground" data-testid="ielts-band-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm font-medium text-white/70">{t('title')}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {view.module ? (
            <Badge variant="secondary" data-testid="ielts-module">
              {t(`module.${view.module}`)}
            </Badge>
          ) : null}
          <Badge variant="gold">{tc('estimated')}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2">
          {view.bands.map((b) => (
            <div key={b.skill} className="rounded-lg bg-white/10 p-3" data-testid={`ielts-band-${b.skill}`}>
              <dt className="text-xs font-semibold tracking-wide text-white/75 uppercase">{ts(b.skill as never)}</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="tabular text-4xl font-extrabold tracking-tight text-accent" data-testid={`ielts-band-value-${b.skill}`}>
                  {formatBand(b.band)}
                </span>
                {b.correct !== null && b.total !== null ? (
                  <span className="tabular text-sm text-white/85" data-testid={`ielts-band-raw-${b.skill}`}>
                    {t('correctOf', { correct: b.correct, total: b.total })}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-white/90" data-testid="ielts-overall">
          {view.overall !== null ? t('overall', { band: formatBand(view.overall) }) : t('overallPartial')}
        </p>
        <p className="text-xs leading-relaxed text-white/70">{t('note')}</p>
      </CardContent>
    </Card>
  );
}
