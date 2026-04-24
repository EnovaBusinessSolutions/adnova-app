import { useEffect, useState } from 'react';
import { Activity, Shield, AlertTriangle, ServerCog } from 'lucide-react';
import { formatNumber, formatPercent } from '../utils/formatters';
import { fetchPixelHealth } from '../api/attribution';
import type { PixelHealthCoverage } from '../types';

interface Props {
  shopId: string | null;
  days?: number;
}

interface MetricRowProps {
  icon: React.ReactNode;
  label: string;
  rate: number;
  fraction: string;
  target: number;
  tone?: 'normal' | 'warn' | 'inverse';
}

function toneColor(rate: number, target: number, tone: MetricRowProps['tone']): string {
  if (tone === 'inverse') {
    return rate <= (1 - target) ? 'bg-emerald-400/70' : rate >= 0.2 ? 'bg-red-400/70' : 'bg-yellow-400/70';
  }
  if (rate >= target) return 'bg-emerald-400/70';
  if (rate >= target - 0.2) return 'bg-yellow-400/70';
  return 'bg-red-400/70';
}

function MetricRow({ icon, label, rate, fraction, target, tone = 'normal' }: MetricRowProps) {
  const pct = Math.min(100, Math.max(0, rate * 100));
  const color = toneColor(rate, target, tone);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-white/45">{icon}</span>
        <span className="text-[11px] text-white/55">{label}</span>
        <span className="ml-auto text-[10px] font-semibold text-white/70">{formatPercent(rate)}</span>
        <span className="text-[10px] text-white/35">({fraction})</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PixelHealthPanel({ shopId, days = 30 }: Props) {
  const [data, setData] = useState<PixelHealthCoverage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetchPixelHealth(shopId, days, ctrl.signal)
      .then((res) => setData(res))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load pixel health');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [shopId, days]);

  const overallStatus: 'ok' | 'warn' | 'bad' | 'empty' = (() => {
    if (!data || data.totalOrders === 0) return 'empty';
    if (data.pixelCoverage.rate >= 0.9 && data.attributionCoverage.rate >= 0.8) return 'ok';
    if (data.pixelCoverage.rate < 0.7 || data.attributionCoverage.rate < 0.5) return 'bad';
    return 'warn';
  })();

  const statusBadge = {
    ok:    { text: 'OK',    cls: 'bg-emerald-500/10 text-emerald-400' },
    warn:  { text: 'REVIEW', cls: 'bg-yellow-500/10 text-yellow-400' },
    bad:   { text: 'BLOCKED', cls: 'bg-red-500/10 text-red-400' },
    empty: { text: '—',     cls: 'bg-white/10 text-white/40' },
  }[overallStatus];

  return (
    <div className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity size={13} className="text-[#4FE3C1]" />
        <span className="text-xs font-semibold text-white/70">Pixel Health</span>
        <span className="text-[10px] text-white/35">({days}d)</span>
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${statusBadge.cls}`}>
          {statusBadge.text}
        </span>
      </div>

      {loading && !data ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-white/30">Loading…</div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-red-400/70">{error}</div>
      ) : !data || data.totalOrders === 0 ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-white/30">
          No orders in the last {days} days.
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-[11px] text-white/50">
            <span>Orders analyzed</span>
            <span className="font-semibold text-white/70">{formatNumber(data.totalOrders)}</span>
          </div>

          <div className="space-y-3">
            <MetricRow
              icon={<Activity size={11} />}
              label="Pixel coverage"
              rate={data.pixelCoverage.rate}
              fraction={`${formatNumber(data.pixelCoverage.covered ?? 0)} / ${formatNumber(data.pixelCoverage.total)}`}
              target={0.9}
            />
            <MetricRow
              icon={<Shield size={11} />}
              label="Attribution coverage"
              rate={data.attributionCoverage.rate}
              fraction={`${formatNumber(data.attributionCoverage.attributed ?? 0)} / ${formatNumber(data.attributionCoverage.total)}`}
              target={0.8}
            />
            <MetricRow
              icon={<ServerCog size={11} />}
              label="Server-side coverage"
              rate={data.serverSideCoverage.rate}
              fraction={`${formatNumber(data.serverSideCoverage.covered ?? 0)} / ${formatNumber(data.serverSideCoverage.total)}`}
              target={0.95}
            />
            <MetricRow
              icon={<AlertTriangle size={11} />}
              label="Blocked (ad-blockers)"
              rate={data.blockedOrders.rate}
              fraction={`${formatNumber(data.blockedOrders.count)} / ${formatNumber(data.blockedOrders.total)}`}
              target={0.9}
              tone="inverse"
            />
          </div>

          <div className="mt-4 text-[9px] text-white/25">
            Updated {new Date(data.generatedAt).toLocaleString()}
          </div>
        </>
      )}
    </div>
  );
}
