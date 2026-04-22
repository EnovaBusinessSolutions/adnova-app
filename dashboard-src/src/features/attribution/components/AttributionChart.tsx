import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatCurrency, formatCompact } from '../utils/formatters';
import type { DailyPoint } from '../types';

interface TooltipPayloadItem {
  value: number;
  name: string;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  label?: string;
  payload?: TooltipPayloadItem[];
}

function CustomTooltip({ active, label, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.10] bg-[#0f0f14] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-white/40">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="font-semibold text-white">
          {p.name === 'revenue' ? formatCurrency(p.value) : p.value} {p.name}
        </p>
      ))}
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

interface AttributionChartProps {
  daily: DailyPoint[];
}

export function AttributionChart({ daily }: AttributionChartProps) {
  const tickStyle = { fill: 'rgba(255,255,255,0.3)', fontSize: 10 };

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="mb-3 text-xs font-semibold text-white/60">Revenue by Day</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatXLabel}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={tickStyle}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => formatCompact(v)}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(181,92,255,0.06)' }} />
          <Bar dataKey="revenue" name="revenue" fill="#B55CFF" radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
