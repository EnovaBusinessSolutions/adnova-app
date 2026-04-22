import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '../utils/formatters';
import { CHANNEL_COLORS, CHANNEL_LABELS } from '../utils/channelColors';
import type { AnalyticsResponse } from '../types';

interface PieEntry {
  name: string;
  label: string;
  value: number;
  color: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PieEntry }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const { label, value } = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/[0.10] bg-[#0f0f14] px-3 py-2 text-xs shadow-lg">
      <p className="text-white/40">{label}</p>
      <p className="font-semibold text-white">{formatCurrency(value)}</p>
    </div>
  );
}

function renderLegend(props: { payload?: Array<{ color: string; value: string }> }) {
  return (
    <ul className="flex flex-wrap justify-center gap-x-3 gap-y-1 pt-2">
      {(props.payload ?? []).map((entry) => (
        <li key={entry.value} className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-[10px] text-white/40">{entry.value}</span>
        </li>
      ))}
    </ul>
  );
}

interface AttributionPieChartProps {
  channels: AnalyticsResponse['channels'];
}

export function AttributionPieChart({ channels }: AttributionPieChartProps) {
  const data: PieEntry[] = Object.entries(channels)
    .filter(([, stats]) => stats.revenue > 0)
    .map(([key, stats]) => ({
      name: key,
      label: CHANNEL_LABELS[key] ?? key,
      value: stats.revenue,
      color: CHANNEL_COLORS[key] ?? '#6B7280',
    }));

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <p className="mb-1 text-xs font-semibold text-white/60">Revenue by Channel</p>
      {data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/25">No attributed revenue</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="45%"
              outerRadius={72}
              innerRadius={36}
              dataKey="value"
              nameKey="label"
              strokeWidth={0}
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend content={renderLegend} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
