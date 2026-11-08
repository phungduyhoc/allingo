'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AccuracyRow, ScorePoint } from './stats-model';

/**
 * Biểu đồ thống kê (S10) – recharts, CHỈ nạp bằng `next/dynamic` (ssr: false) từ dashboard/thống kê để không tăng JS trang đầu.
 * Màu theo token `--chart-*` (navy/gold, sáng/tối). Mỗi biểu đồ có bảng số liệu tương đương ở thẻ cha cho trình đọc màn hình.
 */

const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)', fontSize: 12 };
const tick = { fontSize: 11, fill: 'var(--muted-foreground)' };

export function ScoreChart({ data, target, max }: { data: ScorePoint[]; target: number | null; max: number }) {
  const locale = useLocale();
  const t = useTranslations('stats');
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  const hasLr = data.some((p) => p.listening !== null || p.reading !== null);
  return (
    <div className="h-56 w-full" aria-hidden data-testid="chart-score">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="at" tickFormatter={fmt} tick={tick} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis domain={[0, max]} tick={tick} axisLine={false} tickLine={false} width={44} />
          <Tooltip labelFormatter={(d) => (typeof d === 'string' ? fmt(d) : '')} contentStyle={tooltipStyle} />
          {target ? <ReferenceLine y={target} stroke="var(--chart-2)" strokeDasharray="6 4" label={{ value: t('target', { score: target }), fill: 'var(--muted-foreground)', fontSize: 11, position: 'insideTopRight' }} /> : null}
          <Line name={t('seriesTotal')} type="monotone" dataKey="score" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--chart-1)' }} isAnimationActive={false} connectNulls />
          {hasLr ? <Line name={t('seriesListening')} type="monotone" dataKey="listening" stroke="var(--chart-3)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls /> : null}
          {hasLr ? <Line name={t('seriesReading')} type="monotone" dataKey="reading" stroke="var(--chart-4)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls /> : null}
          {hasLr ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AccuracyChart({ rows, label }: { rows: AccuracyRow[]; label: (key: string) => string }) {
  const t = useTranslations('stats');
  const data = rows.map((r) => ({ name: label(r.key), current: r.current, previous: r.previous }));
  return (
    <div className="h-56 w-full" aria-hidden data-testid="chart-accuracy">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} interval={0} />
          <YAxis domain={[0, 100]} unit="%" tick={tick} axisLine={false} tickLine={false} width={44} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v) => (v === null || v === undefined ? '—' : `${String(v)}%`)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar name={t('periodCurrent')} dataKey="current" fill="var(--chart-1)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar name={t('periodPrevious')} dataKey="previous" fill="var(--chart-4)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MinutesChart({ data }: { data: Array<{ week: string; minutes: number }> }) {
  const locale = useLocale();
  const t = useTranslations('stats');
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return (
    <div className="h-44 w-full" aria-hidden data-testid="chart-minutes">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="week" tickFormatter={fmt} tick={tick} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={tick} axisLine={false} tickLine={false} width={40} />
          <Tooltip labelFormatter={(d) => (typeof d === 'string' ? t('weekOf', { date: fmt(d) }) : '')} contentStyle={tooltipStyle} formatter={(v) => t('minutesValue', { count: Number(v) })} />
          <Bar name={t('minutesLabel')} dataKey="minutes" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
