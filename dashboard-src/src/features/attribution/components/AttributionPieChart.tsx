import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '../utils/formatters';
import { CHANNEL_COLORS, CHANNEL_LABELS } from '../utils/channelColors';
import type { AnalyticsResponse } from '../types';
import { ADRAY_PURPLE, ADRAY_CYAN } from '../utils/adrayColors';

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
      <p className="font-semibold text-white">{formatNumber(value)} orders</p>
    </div>
  );
}

interface AttributionPieChartProps {
  channels: AnalyticsResponse['channels'];
}

export function AttributionPieChart({ channels }: AttributionPieChartProps) {
  const data: PieEntry[] = Object.entries(channels)
    .filter(([, stats]) => stats.orders > 0)
    .map(([key, stats]) => ({
      name: key,
      label: CHANNEL_LABELS[key] ?? key,
      value: stats.orders,
      color: CHANNEL_COLORS[key] ?? '#6B7280',
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="futuristic-surface flex h-full flex-col rounded-2xl p-4">
      {/* Header */}
      <div className="mb-3">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">Distribution</p>
        <p className="text-xs font-semibold text-white/70">Attributed Orders</p>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/25">No attributed orders</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center gap-4 overflow-hidden">
          {/* Donut */}
          <div className="relative min-w-0 flex-1">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <defs>
                  <filter id="donut-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  outerRadius={82}
                  innerRadius={50}
                  dataKey="value"
                  nameKey="label"
                  paddingAngle={3}
                  filter="url(#donut-glow)"
                >
                  {/* Cell fill uses hex + "2E" (≈18% opacity) for the outline-dominant look.
                      Works because all CHANNEL_COLORS values are 6-digit hex strings. */}
                  {data.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={`${entry.color}2E`}
                      stroke={entry.color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-lg font-bold tracking-tight text-white/90 sm:text-xl">
                {formatNumber(data.reduce((sum, e) => sum + e.value, 0))}
              </p>
              <p className="text-[9px] font-medium uppercase tracking-wider text-white/40">
                attributed
              </p>
            </div>
          </div>

          {/* Legend */}
          <div className="flex shrink-0 flex-col gap-3">
            {data.map((entry) => (
              <div key={entry.name} className="flex items-start gap-2">
                <span
                  className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-offset-0"
                  style={{ background: entry.color, boxShadow: `0 0 8px ${entry.color}66` }}
                />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-white/65">
                    {entry.label}
                  </p>
                  <p className="text-[10px] text-white/35">{formatNumber(entry.value)} orders</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
