'use client';

import { ArrowRight, Clock3, Lightbulb, Stethoscope, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Progress } from '@allingo/ui';
import { Link } from '@/i18n/navigation';
import { useSectionLabel } from '@/features/attempt/section-label';
import { knownFlags, recommendationHref, toPercent, type Diagnosis, type WeakArea } from './diagnosis';

/** Mỗi nhóm điểm yếu chỉ hiện 5 mục yếu nhất (API đã sắp theo độ chính xác tăng dần) */
const MAX_WEAK_ITEMS = 5;

/** Hiển thị mã kỹ năng con/chủ đề: có nhãn i18n thì dùng, không thì làm đẹp mã (dữ liệu, không phải chuỗi UI cứng) */
function useCodeLabel(group: 'subskills' | 'topics'): (code: string) => string {
  const t = useTranslations('result');
  return (code) => {
    const key = `${group}.${code}`;
    if (t.has(key as never)) return t(key as never);
    const bare = code.replace(/^[a-z]+:/, '').replace(/[-_]+/g, ' ');
    return bare.charAt(0).toUpperCase() + bare.slice(1);
  };
}

/**
 * Khối "Chẩn đoán" (Sprint 3, theo quy tắc – không AI): Part/kỹ năng con/chủ đề yếu kèm %, cờ thành câu nhận xét,
 * gợi ý luyện → /toeic/practice?section=…
 */
export function DiagnosisCard({ diagnosis }: { diagnosis: Diagnosis }) {
  const t = useTranslations('result');
  const sectionLabel = useSectionLabel();
  const subskillLabel = useCodeLabel('subskills');
  const topicLabel = useCodeLabel('topics');
  const flags = knownFlags(diagnosis);
  const overall = toPercent(diagnosis.overall_accuracy);
  const hasWeak = diagnosis.weak_sections.length + diagnosis.weak_subskills.length + diagnosis.weak_topics.length > 0;

  const weakList = (title: string, items: WeakArea[], label: (code: string) => string, testId: string) =>
    items.length ? (
      <div className="space-y-2" data-testid={testId}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <ul className="space-y-2">
          {items.slice(0, MAX_WEAK_ITEMS).map((w) => (
            <li key={w.code} className="space-y-1">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{label(w.code)}</span>
                <span className="tabular shrink-0 font-semibold text-destructive">{t('weakItemStat', { correct: w.correct, total: w.total, percent: toPercent(w.accuracy) })}</span>
              </div>
              <Progress value={toPercent(w.accuracy)} tone="gold" label={`${label(w.code)}: ${t('percent', { value: toPercent(w.accuracy) })}`} className="h-1.5" />
            </li>
          ))}
        </ul>
        {items.length > MAX_WEAK_ITEMS ? <p className="text-xs text-muted-foreground">{t('moreItems', { count: items.length - MAX_WEAK_ITEMS })}</p> : null}
      </div>
    ) : null;

  return (
    <Card data-testid="diagnosis-card">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Stethoscope className="size-5 text-primary" aria-hidden />
              {t('diagnosisTitle')}
            </CardTitle>
            <CardDescription>{t('diagnosisSubtitle')}</CardDescription>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t('overallAccuracy')}</p>
            <p className="tabular text-2xl font-bold" data-testid="diagnosis-accuracy">
              {t('percent', { value: overall })}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {flags.length || diagnosis.slow_wrong_question_ids.length ? (
          <ul className="space-y-2" data-testid="diagnosis-flags">
            {flags.map((f) => (
              <li
                key={f}
                className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-sm', f === 'strong_performance' ? 'bg-success/10 text-foreground' : 'bg-accent/15 text-foreground')}
                data-flag={f}
              >
                {f === 'strong_performance' ? <Lightbulb className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : f === 'time_pressure' ? <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden /> : <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />}
                <span>{t(`flags.${f}`, { count: diagnosis.timeout_wrong })}</span>
              </li>
            ))}
            {diagnosis.slow_wrong_question_ids.length && !flags.includes('slow_reading') ? (
              <li className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{t('slowWrong', { count: diagnosis.slow_wrong_question_ids.length })}</span>
              </li>
            ) : null}
          </ul>
        ) : null}

        {hasWeak ? (
          <div className="grid gap-6 md:grid-cols-3">
            {weakList(t('weakSections'), diagnosis.weak_sections, (c) => sectionLabel(c), 'diagnosis-weak-sections')}
            {weakList(t('weakSubskills'), diagnosis.weak_subskills, subskillLabel, 'diagnosis-weak-subskills')}
            {weakList(t('weakTopics'), diagnosis.weak_topics, topicLabel, 'diagnosis-weak-topics')}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noWeakAreas')}</p>
        )}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('recommendationsTitle')}</h3>
          {diagnosis.recommendations.length ? (
            <ul className="flex flex-wrap gap-2" data-testid="diagnosis-recommendations">
              {diagnosis.recommendations.map((rec, i) => {
                const section = sectionLabel(rec.section_code, { short: true });
                const focus = rec.subskill_code ? subskillLabel(rec.subskill_code) : rec.topic_code ? topicLabel(rec.topic_code) : null;
                return (
                  <li key={`${rec.section_code}-${rec.subskill_code ?? rec.topic_code ?? i}`}>
                    <Link href={recommendationHref(rec)} className={buttonVariants({ variant: 'outline', size: 'sm' })} data-testid="diagnosis-recommendation">
                      {focus ? t('recommendDrillFocus', { section, focus }) : t('recommendDrill', { section })}
                      <ArrowRight aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noRecommendations')}</p>
          )}
        </div>
        {diagnosis.method !== 'rules' ? <Badge variant="muted">{diagnosis.method}</Badge> : null}
      </CardContent>
    </Card>
  );
}
