import { useDataCoverage } from '../hooks/useDataCoverage';
import { Skeleton } from '@/components/ui/skeleton';
import type { FieldState } from '../types';

interface Props {
  shopId: string;
}

const LAYER_LABELS: Record<string, string> = {
  layer1_identity_anchors:            'Layer 1 — Identity Anchors',
  layer2_session_events:              'Layer 2 — Session Events',
  layer3_touchpoints_click_ids:       'Layer 3 — Touchpoints & Click IDs',
  layer4_order_truth:                 'Layer 4 — Order Truth',
  layer5_platform_signals_daily_pull: 'Layer 5 — Platform Signals',
  layer6_raw_enrichment_every_event:  'Layer 6 — Raw Enrichment',
  critical_stitch:                    'Critical Stitch',
};

const LAYER_ORDER = [
  'layer1_identity_anchors',
  'layer2_session_events',
  'layer3_touchpoints_click_ids',
  'layer4_order_truth',
  'layer5_platform_signals_daily_pull',
  'layer6_raw_enrichment_every_event',
  'critical_stitch',
];

function fieldScore(fields: Record<string, FieldState>): { ok: number; total: number } {
  const entries = Object.values(fields);
  return { ok: entries.filter((f) => f.ok).length, total: entries.length };
}

function LayerRow({ layerKey, fields }: { layerKey: string; fields: Record<string, FieldState> }) {
  const { ok, total } = fieldScore(fields);
  const ratio = total > 0 ? ok / total : 0;
  const allOk = ratio === 1;
  const hasWarning = ratio < 0.5;

  const barColor = allOk
    ? 'bg-emerald-500'
    : hasWarning
    ? 'bg-yellow-500'
    : 'bg-[#B55CFF]';

  const dotColor = allOk
    ? 'bg-emerald-400'
    : hasWarning
    ? 'bg-yellow-400'
    : 'bg-yellow-500';

  return (
    <div className="flex items-center gap-3 py-2.5">
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-white/60">
        {LAYER_LABELS[layerKey] ?? layerKey}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className={`h-full rounded-full ${barColor} transition-all`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
        <span className="w-10 text-right text-[10px] tabular-nums text-white/35">
          {ok}/{total}
        </span>
      </div>
    </div>
  );
}

export function DataEnrichmentPanel({ shopId }: Props) {
  const { data, isLoading } = useDataCoverage(shopId);

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[#B55CFF]/70">
            Enrichment
          </p>
          <p className="text-xs font-semibold text-white/70">Data Coverage</p>
        </div>
        {data && (
          <span className="text-[10px] text-white/30">
            Last {data.windowDays}d
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      ) : !data ? (
        <div className="flex h-24 items-center justify-center">
          <p className="text-xs text-white/25">No coverage data available</p>
        </div>
      ) : (
        <>
          {/* Totals row */}
          <div className="mb-4 grid grid-cols-5 gap-2">
            {[
              { label: 'Events',     value: data.totals.events },
              { label: 'Sessions',   value: data.totals.sessions },
              { label: 'Orders',     value: data.totals.orders },
              { label: 'Identities', value: data.totals.identities },
              { label: 'Checkouts',  value: data.totals.checkoutMaps },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="flex flex-col items-center rounded-xl border border-white/[0.06] bg-white/[0.02] px-2 py-2"
              >
                <span className="text-[13px] font-semibold text-white">
                  {value.toLocaleString()}
                </span>
                <span className="mt-0.5 text-[9px] uppercase tracking-wider text-white/30">
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Layer rows */}
          <div className="divide-y divide-white/[0.04]">
            {LAYER_ORDER.map((key) => {
              const fields = data.layers[key as keyof typeof data.layers];
              if (!fields) return null;
              return <LayerRow key={key} layerKey={key} fields={fields} />;
            })}
          </div>

          {/* Warnings + missing */}
          {(data.warnings.length > 0 || data.missing.length > 0) && (
            <div className="mt-4 space-y-1.5">
              {data.missing.length > 0 && (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[10px] text-yellow-400">
                  {data.missing.length} missing field{data.missing.length > 1 ? 's' : ''}:{' '}
                  {data.missing.join(', ')}
                </div>
              )}
              {data.warnings.map((w, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2 text-[10px] text-orange-400"
                >
                  <span className="font-medium">{w.label}:</span> {w.error}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
