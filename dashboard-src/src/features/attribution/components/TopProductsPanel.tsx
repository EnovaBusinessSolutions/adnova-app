import { Package } from 'lucide-react';
import { formatCurrency, formatNumber } from '../utils/formatters';
import type { TopProduct } from '../types';

interface Props {
  products: TopProduct[];
  currency?: string | null;
}

export function TopProductsPanel({ products, currency }: Props) {
  const top = products.slice(0, 8);
  const maxRevenue = top[0]?.revenue ?? 1;

  return (
    <div className="futuristic-surface flex flex-col rounded-2xl p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2">
        <Package size={13} className="text-[#F59E0B]" />
        <span className="text-xs font-semibold text-white/70">Top Products</span>
        {top.length > 0 && (
          <span className="ml-auto text-[10px] text-white/30">{products.length} products</span>
        )}
      </div>

      {top.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-8">
          <p className="text-xs text-white/25">No product data</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {top.map((p) => {
            const pct = (p.revenue / maxRevenue) * 100;
            return (
              <div key={p.id}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] text-white/65" title={p.name}>
                    {p.name || 'Unknown product'}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] text-white/35">×{formatNumber(p.quantity)}</span>
                    <span className="text-[11px] font-semibold text-white/70">
                      {formatCurrency(p.revenue, currency)}
                    </span>
                  </div>
                </div>
                <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-[#F59E0B]/60 transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
