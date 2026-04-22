import { useState, useCallback } from 'react';
import { Download, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatCurrency } from '../utils/formatters';
import { channelColor, channelLabel } from '../utils/channelColors';
import type { RecentPurchase, JourneyEvent } from '../types';

interface SelectedJourneyProps {
  purchase: RecentPurchase;
  onClose: () => void;
}

const EVENT_LABELS: Record<string, string> = {
  page_view: 'Page View',
  view_item: 'View Item',
  add_to_cart: 'Add to Cart',
  begin_checkout: 'Begin Checkout',
  purchase: 'Purchase',
};

function eventLabel(name: string): string {
  return EVENT_LABELS[name.toLowerCase()] ?? name;
}

function formatTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function downloadCsv(purchase: RecentPurchase) {
  const headers = ['eventName', 'createdAt', 'pageUrl', 'utmSource', 'orderId', 'productId', 'productName'];
  const rows = purchase.events.map((e) =>
    headers.map((h) => {
      const val = (e as unknown as Record<string, unknown>)[h];
      return val != null ? `"${String(val).replace(/"/g, '""')}"` : '';
    }).join(','),
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `journey-${purchase.orderId.slice(0, 8)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function EventRow({ event, condensed }: { event: JourneyEvent; condensed: boolean }) {
  const hasClickId = event.gclid || event.fbc || event.ttclid || event.clickId;
  const displayUrl = event.pageUrl
    ? (() => { try { return new URL(event.pageUrl).pathname; } catch { return event.pageUrl; } })()
    : null;

  return (
    <div className="border-b border-white/[0.04] px-3 py-2">
      <div className="flex items-center gap-2">
        <ChevronRight size={10} className="shrink-0 text-white/20" />
        <span className="text-[11px] font-semibold text-white/80">
          {eventLabel(event.eventName)}
        </span>
        {hasClickId && (
          <Badge variant="outline" className="h-3.5 border-[#B55CFF]/30 px-1 text-[8px] text-[#D8B8FF]">
            click ID
          </Badge>
        )}
        <span className="ml-auto text-[10px] text-white/30">{formatTs(event.createdAt)}</span>
      </div>

      {!condensed && (
        <div className="mt-1 space-y-0.5 pl-5">
          {displayUrl && (
            <p className="truncate text-[10px] text-white/35">{displayUrl}</p>
          )}
          {event.utmSource && (
            <p className="text-[10px] text-white/30">
              utm_source: <span className="text-white/50">{event.utmSource}</span>
            </p>
          )}
          {event.productName && (
            <p className="text-[10px] text-white/30">
              product: <span className="text-white/50">{event.productName}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function SelectedJourney({ purchase, onClose }: SelectedJourneyProps) {
  const [condensed, setCondensed] = useState(false);
  const handleDownload = useCallback(() => downloadCsv(purchase), [purchase]);

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: channelColor(purchase.attributedChannel) }}
            />
            <span className="text-sm font-semibold text-white/85">
              {purchase.orderNumber ? `Order #${purchase.orderNumber}` : purchase.orderId.slice(0, 16)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <Badge
              variant="outline"
              className="h-4 border-white/[0.08] px-1.5 text-[9px] text-white/45"
              style={{ borderColor: `${channelColor(purchase.attributedChannel)}40` }}
            >
              {channelLabel(purchase.attributedChannel)}
            </Badge>
            <span className="text-xs font-semibold text-white/70">
              {formatCurrency(purchase.revenue, purchase.currency)}
            </span>
            <span className="text-[10px] text-white/30">
              {purchase.events.length} events
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCondensed((v) => !v)}
            className="h-6 px-2 text-[10px] text-white/45 hover:text-white"
          >
            {condensed ? 'Full' : 'Condensed'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-6 gap-1 px-2 text-[10px] text-white/45 hover:text-white"
          >
            <Download size={10} />
            CSV
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 text-white/30 hover:text-white"
          >
            <X size={12} />
          </Button>
        </div>
      </div>

      {/* Events */}
      <ScrollArea className="flex-1">
        {purchase.events.length === 0 ? (
          <p className="py-8 text-center text-xs text-white/25">No events recorded</p>
        ) : (
          purchase.events.map((event, i) => (
            <EventRow
              key={event.eventId ?? `ev-${i}`}
              event={event}
              condensed={condensed}
            />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
