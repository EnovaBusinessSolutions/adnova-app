import { useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { formatNumber } from '../utils/formatters';
import { CHANNEL_COLORS, CHANNEL_LABELS } from '../utils/channelColors';
import type { AnalyticsResponse } from '../types';
import type { Ga4ChannelsResponse } from '../api/attribution';

type ViewKey = 'adray' | 'ga4';

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
  ga4?: Ga4ChannelsResponse;
  ga4Loading?: boolean;
}

function buildEntries(
  channels: Record<string, { orders: number }>,
): PieEntry[] {
  return Object.entries(channels)
    .filter(([, stats]) => stats.orders > 0)
    .map(([key, stats]) => ({
      name: key,
      label: CHANNEL_LABELS[key] ?? key,
      value: stats.orders,
      color: CHANNEL_COLORS[key] ?? '#6B7280',
    }))
    .sort((a, b) => b.value - a.value);
}

function buildNarrative(
  adray: PieEntry[],
  ga4: PieEntry[] | null,
): string {
  const adrayTotal = adray.reduce((s, e) => s + e.value, 0);
  if (!ga4 || ga4.length === 0) {
    return adrayTotal > 0
      ? `Adray attributed ${formatNumber(adrayTotal)} orders across ${adray.length} channels using stitched journey data. Connect GA4 to compare against last-non-direct-click attribution.`
      : 'No attributed orders for this period yet.';
  }
  const ga4Total = ga4.reduce((s, e) => s + e.value, 0);

  const adrayMap = Object.fromEntries(adray.map((e) => [e.name, e.value]));
  const ga4Map   = Object.fromEntries(ga4.map((e) => [e.name, e.value]));

  const sentences: string[] = [];
  sentences.push(
    `Adray attributed ${formatNumber(adrayTotal)} orders; GA4 (last-non-direct-click) sees ${formatNumber(ga4Total)} conversions for the same period.`,
  );

  const channelOrder = ['meta', 'google', 'organic', 'unattributed', 'other'];
  for (const key of channelOrder) {
    const a = adrayMap[key] || 0;
    const g = ga4Map[key]   || 0;
    if (a === 0 && g === 0) continue;
    const label = CHANNEL_LABELS[key] ?? key;
    if (a > g) {
      const diff = a - g;
      sentences.push(
        `${label}: Adray credits ${formatNumber(a)} vs GA4's ${formatNumber(g)} — ${formatNumber(diff)} assisted journeys GA4 collapses into other touchpoints.`,
      );
    } else if (g > a) {
      const diff = g - a;
      sentences.push(
        `${label}: GA4 credits ${formatNumber(g)} vs Adray's ${formatNumber(a)} — GA4 over-credits ${label} on ${formatNumber(diff)} orders that Adray maps to earlier touchpoints.`,
      );
    }
    if (sentences.length >= 4) break;
  }
  return sentences.join(' ');
}

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
        active
          ? 'bg-[var(--adray-purple)]/20 text-[var(--adray-purple)] ring-1 ring-[var(--adray-purple)]/40'
          : 'text-white/40 hover:text-white/65'
      }`}
    >
      {children}
    </button>
  );
}

export function AttributionPieChart({ channels, ga4, ga4Loading }: AttributionPieChartProps) {
  const [view, setView] = useState<ViewKey>('adray');

  const adrayEntries = buildEntries(channels);
  const ga4Entries   = ga4?.available && ga4.channels ? buildEntries(ga4.channels) : null;

  const ga4Available = !!ga4?.available && (ga4Entries?.length ?? 0) > 0;
  const activeView: ViewKey = view;
  const data = activeView === 'ga4' ? (ga4Entries ?? []) : adrayEntries;
  const totalOrders = data.reduce((sum, e) => sum + e.value, 0);

  const narrative = buildNarrative(adrayEntries, ga4Entries);

  return (
    <div className="futuristic-surface flex h-full flex-col rounded-2xl p-4">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">Distribution</p>
          <p className="text-xs font-semibold text-white/70">
            Attributed Orders {activeView === 'ga4' ? '(GA4)' : '(Adray)'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
          <ToggleButton active={activeView === 'adray'} onClick={() => setView('adray')}>
            Adray
          </ToggleButton>
          <ToggleButton active={activeView === 'ga4'} onClick={() => setView('ga4')}>
            GA4{ga4Loading ? ' …' : ''}
          </ToggleButton>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/25">
            {activeView === 'ga4' ? 'No GA4 channel data available' : 'No attributed orders'}
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
          {/* Donut + Legend */}
          <div className="flex min-w-0 flex-[3] items-center gap-3">
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
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-lg font-bold tracking-tight text-white/90 sm:text-xl">
                  {formatNumber(totalOrders)}
                </p>
                <p className="text-[9px] font-medium uppercase tracking-wider text-white/40">
                  {activeView === 'ga4' ? 'conversions' : 'attributed'}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 flex-col gap-2">
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
                    <p className="text-[10px] text-white/35">{formatNumber(entry.value)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Narrative */}
          <div className="flex flex-[2] flex-col justify-center border-l border-white/[0.06] pl-4">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
              {ga4Available ? 'Adray vs GA4' : "Adray's view"}
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">{narrative}</p>
          </div>
        </div>
      )}
    </div>
  );
}
