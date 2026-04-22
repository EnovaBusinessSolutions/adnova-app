import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { DailyPoint } from '../types';

interface CustomTooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ value: number; name: string }>;
}

function CustomTooltip({ active, label, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.10] bg-[#0f0f14] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-white/40">{label}</p>
      <p className="font-semibold text-white">{payload[0].value} orders</p>
    </div>
  );
}

function formatXLabel(date: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', { month: 'short', day: 'numeric' }).format(
      new Date(date + 'T12:00:00'),
    );
  } catch { return date; }
}

interface TrendChartProps {
  daily: DailyPoint[];
}

export function TrendChart({ daily }: TrendChartProps) {
  const tickStyle = { fill: 'rgba(255,255,255,0.3)', fontSize: 10 };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="mb-3 text-xs font-semibold text-white/60">Orders Trend</p>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatXLabel}
            interval="preserveStartEnd"
          />
          <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(79,227,193,0.2)', strokeWidth: 1 }} />
          <Line
            type="monotone"
            dataKey="orders"
            stroke="#4FE3C1"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: '#4FE3C1', strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
