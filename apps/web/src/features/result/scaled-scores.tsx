'use client';

import { Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toeicScaledSchema } from '@allingo/schemas/api/attempt';
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@allingo/ui';
import type { AttemptResult, ToeicScaled } from '@/lib/types';

/** Đọc an toàn `AttemptResult.scaled` (TOEIC L&R, v1.1 – Sprint 4); sai dạng/không có → null */
export function parseScaled(raw: unknown): ToeicScaled | null {
  if (!raw) return null;
  const r = toeicScaledSchema.safeParse(raw);
  return r.success && (r.data.listening !== null || r.data.reading !== null) ? r.data : null;
}

const secs = (ms: number | null | undefined) => (typeof ms === 'number' ? Math.round(ms / 100) / 10 : null);

/**
 * Điểm quy đổi Listening / Reading / Tổng + khoảng ước tính (±25, cắt trong 5–495 / 10–990). Luôn ghi rõ là ƯỚC TÍNH của
 * Allingo, không phải điểm chính thức ETS. Kỹ năng không có trong bài → "—".
 */
export function ScaledScores({ result }: { result: AttemptResult }) {
  const t = useTranslations('result');
  const scaled = parseScaled(result.scaled);
  if (!scaled) return null;
  const skill = (k: 'listening' | 'reading') => result.by_skill?.[k];
  const tiles = [
    { key: 'listening' as const, label: t('skillListening'), score: scaled.listening, range: scaled.ranges?.listening ?? null, max: 495, stats: skill('listening') },
    { key: 'reading' as const, label: t('skillReading'), score: scaled.reading, range: scaled.ranges?.reading ?? null, max: 495, stats: skill('reading') },
    { key: 'total' as const, label: t('skillTotal'), score: scaled.total, range: scaled.total !== null ? scaled.range : null, max: 990, stats: undefined },
  ];
  return (
    <Card data-testid="scaled-scores">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('lrTitle')}</CardTitle>
        <Badge variant="gold">{t('estimatedBadge')}</Badge>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          {tiles.map((tile) => (
            <div key={tile.key} className={cn('rounded-xl border p-4', tile.key === 'total' ? 'border-navy/30 bg-navy/5 dark:bg-navy/40' : 'border-border bg-background')} data-testid={`scaled-${tile.key}`} data-score={tile.score ?? ''}>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{tile.label}</p>
              <p className="mt-1 flex items-baseline gap-1">
                <span className="tabular text-3xl font-extrabold tracking-tight">{tile.score ?? '—'}</span>
                <span className="tabular text-sm text-muted-foreground">/ {tile.max}</span>
              </p>
              {tile.range ? (
                <p className="tabular mt-1 text-sm" data-testid={`scaled-${tile.key}-range`}>
                  {t('rangeEstimate', { low: tile.range.low, high: tile.range.high })}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">{tile.key === 'total' ? t('totalNeedsBoth') : t('skillNotInAttempt')}</p>
              )}
              {tile.stats ? (
                <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  <p className="tabular">{t('skillRaw', { correct: tile.stats.correct, total: tile.stats.total })}</p>
                  {secs(tile.stats.avg_time_ms) !== null ? (
                    <p className="tabular inline-flex items-center gap-1">
                      <Clock className="size-3" aria-hidden />
                      {secs(tile.stats.community_avg_time_ms) !== null
                        ? t('avgTimeVsCommunity', { mine: secs(tile.stats.avg_time_ms)!, community: secs(tile.stats.community_avg_time_ms)! })
                        : t('avgTime', { mine: secs(tile.stats.avg_time_ms)! })}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground" data-testid="scaled-note">
          {t('estimatedNotOfficial')}
        </p>
      </CardContent>
    </Card>
  );
}
