import { TrendingUp, Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCurrency, formatNumber } from '../utils/formatters';
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
  transactions: number | null;
  roas?: number | null;
  currency?: string | null;
}

function PlatformRow({ name, color, connected, spend, revenue, transactions, roas, currency }: PlatformRowProps) {
  const cpa = spend != null && transactions != null && transactions > 0
    ? spend / transactions
    : null;

  return (
    <div className="rounded-xl border border-[var(--adray-line-soft)] bg-[var(--adray-surface-2)] p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] font-semibold text-white/70">{name}</span>
        <span className={`ml-auto flex items-center gap-1 text-[9px] ${connected ? 'text-emerald-400' : 'text-white/25'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-white/20'}`} />
          {connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      {connected && spend != null ? (
        <div className="grid grid-cols-4 gap-1.5 sm:gap-1">
          <div className="flex flex-col">
            <span className="text-[9px] text-white/30">Spend</span>
            <span className="text-[11px] font-semibold text-white/65">{formatCurrency(spend, currency)}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-white/30">Transactions</span>
            <span className="text-[11px] font-semibold text-white/65">
              {transactions != null ? formatNumber(transactions) : '—'}
            </span>
            {cpa != null && (
              <span className="text-[9px] text-white/35">CPA {formatCurrency(cpa, currency)}</span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="flex items-center gap-1 text-[9px] text-white/30">
              Revenue
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="What does this revenue figure represent?"
                      className="inline-flex h-3 w-3 items-center justify-center text-white/35 transition-colors hover:text-white/70 focus:text-white/70 focus:outline-none"
                    >
                      <Info size={10} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" className="max-w-[260px] text-[11px] leading-relaxed">
                    Revenue reported by {name} using its own attribution window
                    (typically 7‑day click + 1‑day view). Adray attributes orders
                    with the model you selected (Last Click by default), so these
                    numbers usually diverge — see <span className="font-semibold">ROAS Comparison</span> for the side‑by‑side view.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </span>
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

  const blendedCpa = pm.blended.cpa
    ?? (pm.blended.transactions && pm.blended.transactions > 0
      ? pm.blended.spend / pm.blended.transactions
      : null);

  return (
    <div className="futuristic-surface flex flex-col rounded-2xl p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TrendingUp size={13} className="text-[var(--adray-purple)]" />
        <span className="text-xs font-semibold text-white/70">Paid Media</span>
        <div className="ml-auto flex items-center gap-3">
          {pm.blended.roas != null && pm.blended.roas > 0 && (
            <span className="text-[10px] font-semibold text-[var(--adray-purple)]">
              Blended ROAS {pm.blended.roas.toFixed(2)}x
            </span>
          )}
          {blendedCpa != null && blendedCpa > 0 && (
            <span className="text-[10px] font-semibold text-white/55">
              Blended CPA {formatCurrency(blendedCpa, pm.blended.currency || currency)}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <PlatformRow
          name="Meta Ads"
          color="#1877F2"
          connected={ih.meta?.connected ?? false}
          spend={pm.meta.spend}
          revenue={pm.meta.revenue}
          transactions={pm.meta.transactions ?? null}
          roas={metaRoas}
          currency={currency}
        />
        <PlatformRow
          name="Google Ads"
          color="#4285F4"
          connected={ih.google?.connected ?? false}
          spend={pm.google.spend}
          revenue={pm.google.revenue}
          transactions={pm.google.transactions ?? null}
          roas={googleRoas}
          currency={currency}
        />
        <PlatformRow
          name="TikTok Ads"
          color="#69C9D0"
          connected={ih.tiktok?.connected ?? false}
          spend={null}
          revenue={null}
          transactions={null}
          roas={null}
          currency={currency}
        />
      </div>
    </div>
  );
}
