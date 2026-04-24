import { useState, useMemo, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '../utils/formatters';
import { channelColor, channelDisplayLabel } from '../utils/channelColors';
import type { RecentPurchase } from '../types';

interface HistoricalJourneysProps {
  purchases: RecentPurchase[];
  channelFilter: string;
  selectedId: string | null;
  onSelect: (purchase: RecentPurchase) => void;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const PAGE_SIZE = 20;

export function HistoricalJourneys({
  purchases,
  channelFilter,
  selectedId,
  onSelect,
}: HistoricalJourneysProps) {
  const [query, setQuery] = useState('');
  const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

  useEffect(() => {
    setDisplayLimit(PAGE_SIZE);
  }, [channelFilter, query]);

  const filtered = useMemo(() => {
    let list = purchases;

    if (channelFilter !== 'all') {
      list = list.filter((p) =>
        (p.attributedChannel ?? 'unattributed').toLowerCase() === channelFilter,
      );
    }

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((p) => {
        if (p.orderId.toLowerCase().includes(q)) return true;
        if ((p.orderNumber ?? '').toLowerCase().includes(q)) return true;
        if ((p.customerName ?? '').toLowerCase().includes(q)) return true;
        const email = p.events.find((e) => e.customerEmail)?.customerEmail ?? '';
        if (email.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    return list;
  }, [purchases, channelFilter, query]);

  const visible = filtered.slice(0, displayLimit);
  const remaining = filtered.length - displayLimit;

  return (
    <div className="flex h-full flex-col">
      {/* Search */}
      <div className="relative mb-2">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
        <Input
          placeholder="Search order, name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 border-white/[0.08] bg-white/[0.03] pl-7 text-xs text-white/70 placeholder:text-white/25"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-xs text-white/25">No journeys found</p>
        ) : (
          <div className="space-y-1">
            {visible.map((p) => (
              <button
                key={p.orderId}
                onClick={() => onSelect(p)}
                className={cn(
                  'w-full rounded-xl border px-3 py-2.5 text-left transition-all',
                  selectedId === p.orderId
                    ? 'border-[var(--adray-purple)]/40 bg-[var(--adray-purple)]/10'
                    : 'border-transparent hover:border-white/[0.06] hover:bg-white/[0.03]',
                )}
              >
                {/* Row 1: dot + order# (left, truncate) + monto (right, shrink-0) */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: channelColor(p.attributedChannel) }}
                    />
                    <span className="truncate text-[11px] font-medium text-white/75">
                      {p.orderNumber ? `#${p.orderNumber}` : p.orderId.slice(0, 12)}
                    </span>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-white/80">
                    {formatCurrency(p.revenue, p.currency)}
                  </span>
                </div>
                {/* Row 2 + 3: name and email on separate lines, each truncated */}
                {(() => {
                  const name  = p.customerName ?? null;
                  const email = p.events.find((e) => e.customerEmail)?.customerEmail ?? null;
                  if (!name && !email) return null;
                  return (
                    <>
                      {name && (
                        <p className="mt-1 truncate text-[10px] text-white/50">
                          {name}
                        </p>
                      )}
                      {email && (
                        <p className="truncate text-[10px] text-white/30">
                          {email}
                        </p>
                      )}
                    </>
                  );
                })()}
                {/* Row 4: badge (left, shrink-0) + date (right, shrink-0) */}
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <Badge
                    variant="outline"
                    className="h-4 shrink-0 max-w-[70%] truncate border-white/[0.08] px-1.5 text-[9px] font-normal text-white/40"
                    style={{ borderColor: `${channelColor(p.attributedChannel)}40` }}
                    title={channelDisplayLabel(p.attributedChannel, p.attributedPlatform)}
                  >
                    {channelDisplayLabel(p.attributedChannel, p.attributedPlatform)}
                  </Badge>
                  <span className="shrink-0 text-[10px] text-white/30">{formatDate(p.createdAt)}</span>
                </div>
              </button>
            ))}
            {remaining > 0 && (
              <button
                onClick={() => setDisplayLimit((l) => l + PAGE_SIZE)}
                className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] py-1.5 text-[10px] text-white/40 transition-colors hover:bg-white/[0.05] hover:text-white/60"
              >
                Show more ({remaining} more)
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
