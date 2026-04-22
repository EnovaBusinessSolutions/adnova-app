import { Activity } from 'lucide-react';
import { formatNumber, formatPercent } from '../utils/formatters';
import type { PixelHealth, EventStats } from '../types';

interface Props {
  pixelHealth: PixelHealth;
  events: EventStats;
}

interface StatRowProps {
  label: string;
  value: string | number;
}

function StatRow({ label, value }: StatRowProps) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-white/40">{label}</span>
      <span className="text-[11px] font-semibold text-white/70">{value}</span>
    </div>
  );
}

interface RateBarProps {
  label: string;
  value: number;
  warn?: boolean;
}

function RateBar({ label, value, warn }: RateBarProps) {
  const pct = Math.min(100, Math.max(0, value));
  const color = warn && pct < 70 ? 'bg-yellow-400/70' : 'bg-[#4FE3C1]/70';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] text-white/35">{label}</span>
        <span className="text-[10px] font-semibold text-white/55">{formatPercent(pct / 100)}</span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function PixelHealthPanel({ pixelHealth: ph, events }: Props) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Activity size={13} className="text-[#4FE3C1]" />
        <span className="text-xs font-semibold text-white/70">Pixel Health</span>
        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
          ph.orderMatchRate >= 70
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-yellow-500/10 text-yellow-400'
        }`}>
          {ph.orderMatchRate >= 70 ? 'OK' : 'REVIEW'}
        </span>
      </div>

      <div className="mb-3 space-y-1.5">
        <StatRow label="Events received" value={formatNumber(ph.eventsReceived)} />
        <StatRow label="Purchase signals" value={formatNumber(ph.purchaseSignals)} />
        <StatRow label="Orders in DB" value={formatNumber(ph.orders)} />
        <StatRow label="Matched orders" value={`${formatNumber(ph.matchedOrders)} / ${formatNumber(ph.orders)}`} />
      </div>

      <div className="mt-auto space-y-2.5 border-t border-white/[0.04] pt-3">
        <RateBar label="Order match rate" value={ph.orderMatchRate} warn />
        <RateBar label="Signal coverage" value={ph.purchaseSignalCoverage} warn />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/[0.04] pt-3">
        {[
          { label: 'Page views', value: events.page_view },
          { label: 'Add to cart', value: events.add_to_cart },
          { label: 'Purchases', value: events.purchase },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center rounded-lg bg-white/[0.03] px-2 py-1.5">
            <span className="text-[11px] font-semibold text-white/65">{formatNumber(value)}</span>
            <span className="text-[9px] text-white/30">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
