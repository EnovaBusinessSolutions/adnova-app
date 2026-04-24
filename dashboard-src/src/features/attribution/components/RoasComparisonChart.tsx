import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { PaidMedia, AttributionModel } from '../types';
import { ADRAY_PURPLE, ADRAY_CYAN } from '../utils/adrayColors';

const MODEL_LABELS: Record<AttributionModel, string> = {
  last_touch:  'LastClick',
  first_touch: 'FirstClick',
  linear:      'Linear',
};

interface Props {
  paidMedia: PaidMedia;
  model: AttributionModel;
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number; color: string }>;
}

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-white/[0.10] bg-[#0f0f14] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 text-white/40">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-white/60">{p.name}</span>
          <span className="ml-auto font-semibold text-white">{p.value.toFixed(2)}x</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  return (
    <div className="flex items-center justify-center gap-5 pt-1">
      {(payload ?? []).map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-[10px] text-white/40">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function RoasComparisonChart({ paidMedia: pm, model }: Props) {

  const safeRoas = (revenue: number | null, spend: number | null) =>
    spend && spend > 0 && revenue != null ? +(revenue / spend).toFixed(2) : undefined;

  const data = [
    {
      platform: 'Meta',
      'AdNova ROAS':   safeRoas(pm.meta.revenue, pm.meta.spend),
      'Platform ROAS': pm.meta.roas != null ? +pm.meta.roas.toFixed(2) : undefined,
    },
    {
      platform: 'Google',
      'AdNova ROAS':   safeRoas(pm.google.revenue, pm.google.spend),
      'Platform ROAS': pm.google.roas != null ? +pm.google.roas.toFixed(2) : undefined,
    },
  ];

  const hasData = data.some((d) => d['AdNova ROAS'] != null || d['Platform ROAS'] != null);

  return (
    <div className="futuristic-surface flex h-full flex-col rounded-2xl p-4">
      {/* Header */}
      <div className="mb-3 flex flex-col items-start gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">Commercial</p>
          <p className="text-xs font-semibold text-white/70">ROAS Comparison (AdNova vs Native)</p>
        </div>
        <span className="text-[10px] text-white/30">Model: {MODEL_LABELS[model]}</span>
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/25">No paid media data for this period</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
              <defs>
                <linearGradient id="roas-gradient-adnova" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ADRAY_PURPLE} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={ADRAY_PURPLE} stopOpacity={0.08} />
                </linearGradient>
                <linearGradient id="roas-gradient-platform" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ADRAY_CYAN} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={ADRAY_CYAN} stopOpacity={0.08} />
                </linearGradient>
                <filter id="roas-glow-adnova" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
                <filter id="roas-glow-platform" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="2.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid strokeDasharray="2 5" stroke="rgba(255,255,255,0.035)" vertical={false} />
              <XAxis
                dataKey="platform"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 500 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.22)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={32}
                allowDecimals={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(181, 92, 255, 0.04)' }} />
              <Legend content={<CustomLegend />} />
              <Bar
                dataKey="AdNova ROAS"
                fill="url(#roas-gradient-adnova)"
                stroke={ADRAY_PURPLE}
                strokeWidth={1.5}
                radius={[6, 6, 0, 0]}
                maxBarSize={52}
                filter="url(#roas-glow-adnova)"
              />
              <Bar
                dataKey="Platform ROAS"
                fill="url(#roas-gradient-platform)"
                stroke={ADRAY_CYAN}
                strokeWidth={1.5}
                radius={[6, 6, 0, 0]}
                maxBarSize={52}
                filter="url(#roas-glow-platform)"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
