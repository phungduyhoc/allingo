'use client';

import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface SectionDatum {
  code: string;
  label: string;
  correct: number;
  wrong: number;
}

/** Biểu đồ đúng/sai theo Part (stacked) – nạp bằng dynamic import */
export default function SectionChart({ data }: { data: SectionDatum[] }) {
  const t = useTranslations('result');
  return (
    <div className="h-56 w-full" role="img" aria-label={t('bySection')}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={24} maxBarSize={72}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={40} />
          <Tooltip cursor={{ fill: 'var(--muted)' }} contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)', fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="correct" name={t('chartCorrect')} stackId="a" fill="var(--chart-1)" radius={[0, 0, 4, 4]} isAnimationActive={false} />
          <Bar dataKey="wrong" name={t('chartWrong')} stackId="a" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
