import { TrendingUp } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';
import type { PaidMedia, IntegrationStatus } from '../types';

interface Props {
  paidMedia: PaidMedia;
  integrationHealth: {
    meta: IntegrationStatus;
    google: IntegrationStatus;
    tiktok: IntegrationStatus;
  };
  currency?: string | null;
}

interface PlatformRowProps {
  name: string;
  color: string;
  connected: boolean;
  spend: number | null;
  revenue: number | null;
  roas?: number | null;
  currency?: string | null;
}

function PlatformRow({ name, color, connected, spend, revenue, roas, currency }: PlatformRowProps) {
  return (
    <div className="rounded-xl border border-white/[0.04] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-semibold text-white/70">{name}</span>
        <span className={`ml-auto flex items-center gap-1 text-[9px] ${connected ? 'text-emerald-400' : 'text-white/25'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      {connected && spend != null ? (
        <div className="grid grid-cols-3 gap-1">
          <div className="flex flex-col">
            <span className="text-[9px] text-white/30">Spend</span>
            <span className="text-[11px] font-semibold text-white/65">{formatCurrency(spend, currency)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-white/30">Revenue</span>
            <span className="text-[11px] font-semibold text-white/65">
              {revenue != null ? formatCurrency(revenue, currency) : '—'}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-white/30">ROAS</span>
            <span className="text-[11px] font-semibold text-white/65">
              {roas != null ? `${roas.toFixed(2)}x` : '—'}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-white/20">
          {connected ? 'No spend data in range' : 'Link account to see insights'}
        </p>
      )}
    </div>
  );
}

export function PaidMediaPanel({ paidMedia: pm, integrationHealth: ih, currency }: Props) {
  const metaRoas = pm.meta.spend && pm.meta.spend > 0 && pm.meta.revenue != null
    ? pm.meta.revenue / pm.meta.spend
    : pm.meta.roas ?? null;
  const googleRoas = pm.google.spend && pm.google.spend > 0 && pm.google.revenue != null
    ? pm.google.revenue / pm.google.spend
    : pm.google.roas ?? null;

  return (
    <div className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp size={13} className="text-[#B55CFF]" />
        <span className="text-xs font-semibold text-white/70">Paid Media</span>
        {pm.blended.roas != null && pm.blended.roas > 0 && (
          <span className="ml-auto text-[10px] font-semibold text-[#B55CFF]">
            Blended ROAS {pm.blended.roas.toFixed(2)}x
          </span>
        )}
      </div>

      <div className="space-y-2">
        <PlatformRow
          name="Meta Ads"
          color="#1877F2"
          connected={ih.meta?.connected ?? false}
          spend={pm.meta.spend}
          revenue={pm.meta.revenue}
          roas={metaRoas}
          currency={currency}
        />
        <PlatformRow
          name="Google Ads"
          color="#4285F4"
          connected={ih.google?.connected ?? false}
          spend={pm.google.spend}
          revenue={pm.google.revenue}
          roas={googleRoas}
          currency={currency}
        />
        <PlatformRow
          name="TikTok Ads"
          color="#69C9D0"
          connected={ih.tiktok?.connected ?? false}
          spend={null}
          revenue={null}
          roas={null}
          currency={currency}
        />
      </div>
    </div>
  );
}
