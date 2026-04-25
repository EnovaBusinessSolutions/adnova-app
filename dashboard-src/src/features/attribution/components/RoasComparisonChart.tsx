import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { PaidMedia, AttributionModel } from '../types';
import { ADRAY_PURPLE, ADRAY_CYAN } from '../utils/adrayColors';

const MODEL_LABELS: Record<AttributionModel, string> = {
  last_touch:  'LastClick',
  first_touch: 'FirstClick',
  linear:      'Linear',
};

const PLATFORM_STYLE: Record<string, { color: string; gradient: string; glow: string }> = {
  Meta:   { color: ADRAY_PURPLE, gradient: 'roas-gradient-meta',   glow: 'roas-glow-meta' },
  Google: { color: ADRAY_CYAN,   gradient: 'roas-gradient-google', glow: 'roas-glow-google' },
};

interface Props {
  paidMedia: PaidMedia;
  model: AttributionModel;
}

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number; color: string; payload: { fill: string } }>;
}

function CustomTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-xl border border-white/[0.10] bg-[#0f0f14] px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 text-white/40">{label}</p>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ background: p.payload.fill }} />
        <span className="text-white/60">Adray ROAS</span>
        <span className="ml-auto font-semibold text-white">{p.value.toFixed(2)}x</span>
      </div>
    </div>
  );
}

interface PlatformRoas {
  name: string;
  adray: number | null;
  platform: number | null;
}

function buildNarrative(rows: PlatformRoas[]): string {
  const sentences: string[] = [];
  for (const row of rows) {
    if (row.adray == null && row.platform == null) continue;
    if (row.adray != null && row.platform != null) {
      const diffPct = Math.round(((row.adray - row.platform) / row.platform) * 100);
      if (Math.abs(diffPct) < 8) {
        sentences.push(
          `${row.name} reports ${row.platform.toFixed(2)}x ROAS and Adray's stitched journeys confirm ${row.adray.toFixed(2)}x — the platform's view aligns with what we see on the site.`,
        );
      } else if (diffPct < 0) {
        sentences.push(
          `${row.name} reports ${row.platform.toFixed(2)}x ROAS, but Adray attributes only ${row.adray.toFixed(2)}x — ${row.name} is over-claiming credit by ~${Math.abs(diffPct)}%, likely from assisted touchpoints rather than final-click conversions.`,
        );
      } else {
        sentences.push(
          `${row.name} reports ${row.platform.toFixed(2)}x ROAS; Adray's journey data shows ${row.adray.toFixed(2)}x — ${row.name} is under-crediting itself by ~${diffPct}%, missing assisted conversions in its native view.`,
        );
      }
    } else if (row.platform != null) {
      sentences.push(`${row.name} reports ${row.platform.toFixed(2)}x ROAS, but Adray has no attributed revenue yet for this period.`);
    } else if (row.adray != null) {
      sentences.push(`Adray attributes ${row.adray.toFixed(2)}x ROAS to ${row.name}; no platform-reported number is available for comparison.`);
    }
  }
  return sentences.join(' ');
}

export function RoasComparisonChart({ paidMedia: pm, model }: Props) {

  const safeRoas = (revenue: number | null, spend: number | null) =>
    spend && spend > 0 && revenue != null ? +(revenue / spend).toFixed(2) : null;

  const metaAdray = safeRoas(pm.meta.revenue, pm.meta.spend);
  const metaPlatform = pm.meta.roas != null ? +pm.meta.roas.toFixed(2) : null;
  const googleAdray = safeRoas(pm.google.revenue, pm.google.spend);
  const googlePlatform = pm.google.roas != null ? +pm.google.roas.toFixed(2) : null;

  const data = [
    { platform: 'Meta',   roas: metaAdray ?? 0,   hasValue: metaAdray != null },
    { platform: 'Google', roas: googleAdray ?? 0, hasValue: googleAdray != null },
  ];

  const hasData = data.some((d) => d.hasValue);

  const narrative = buildNarrative([
    { name: 'Meta',   adray: metaAdray,   platform: metaPlatform },
    { name: 'Google', adray: googleAdray, platform: googlePlatform },
  ]);

  return (
    <div className="futuristic-surface flex h-full flex-col rounded-2xl p-4">
      {/* Header */}
      <div className="mb-3 flex flex-col items-start gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">Commercial</p>
          <p className="text-xs font-semibold text-white/70">ROAS Comparison (Adray vs Platforms)</p>
        </div>
        <span className="text-[10px] text-white/30">Model: {MODEL_LABELS[model]}</span>
      </div>

      {!hasData ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-white/25">No paid media data for this period</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Chart */}
          <div className="min-h-0 flex-[3]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
                <defs>
                  {Object.entries(PLATFORM_STYLE).flatMap(([name, style]) => [
                    <linearGradient key={`${name}-grad`} id={style.gradient} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor={style.color} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={style.color} stopOpacity={0.08} />
                    </linearGradient>,
                    <filter key={`${name}-glow`} id={style.glow} x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>,
                  ])}
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
                <Bar
                  dataKey="roas"
                  radius={[6, 6, 0, 0]}
                  maxBarSize={56}
                  strokeWidth={1.5}
                  isAnimationActive
                >
                  {data.map((entry) => {
                    const style = PLATFORM_STYLE[entry.platform];
                    return (
                      <Cell
                        key={entry.platform}
                        fill={`url(#${style.gradient})`}
                        stroke={style.color}
                        filter={`url(#${style.glow})`}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Narrative */}
          <div className="flex flex-[2] flex-col justify-center border-l border-white/[0.06] pl-4">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-white/30">Adray's view</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/55">
              {narrative || 'Connect Meta or Google Ads to see how platform-reported ROAS compares to Adray’s stitched journey data.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
