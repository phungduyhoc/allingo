'use client';

import { useLocale } from 'next-intl';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/** Biểu đồ xu hướng 30 ngày – nạp bằng dynamic import để không vào bundle landing */
export default function TrendChart({ data }: { data: { date: string; score: number }[] }) {
  const locale = useLocale();
  const fmt = (d: string) => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
  return (
    <div className="h-44 w-full" role="img">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            labelFormatter={(d) => (typeof d === 'string' ? fmt(d) : '')}
            contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--foreground)', fontSize: 12 }}
          />
          <Line type="monotone" dataKey="score" stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--chart-2)', stroke: 'var(--chart-1)' }} activeDot={{ r: 5 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
