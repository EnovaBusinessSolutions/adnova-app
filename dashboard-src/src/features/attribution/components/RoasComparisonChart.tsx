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
  time_decay:  'Time Decay',
  position:    'Position Based',
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
  const tickStyle = { fill: 'rgba(255,255,255,0.3)', fontSize: 10 };

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
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="platform" tick={tickStyle} tickLine={false} axisLine={false} />
              <YAxis tick={tickStyle} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Legend content={<CustomLegend />} />
              <Bar dataKey="AdNova ROAS"   fill={ADRAY_PURPLE} radius={[4, 4, 0, 0]} maxBarSize={48} />
              <Bar dataKey="Platform ROAS" fill={ADRAY_CYAN} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
