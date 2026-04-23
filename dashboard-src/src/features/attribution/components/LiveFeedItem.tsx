import { cn } from '@/lib/utils';
import type { LiveFeedEvent } from '../types';

const EVENT_LABELS: Record<string, string> = {
  page_view:      'Page View',
  view_item:      'View Item',
  add_to_cart:    'Add to Cart',
  begin_checkout: 'Begin Checkout',
  purchase:       'Purchase',
  identify:       'Identify',
};

const EVENT_COLORS: Record<string, string> = {
  page_view:      'bg-white/20',
  view_item:      'bg-[var(--adray-cyan)]/60',
  add_to_cart:    'bg-[var(--adray-purple)]/60',
  begin_checkout: 'bg-yellow-400/60',
  purchase:       'bg-emerald-400/80',
  identify:       'bg-sky-400/60',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

interface LiveFeedItemProps {
  event: LiveFeedEvent;
}

export function LiveFeedItem({ event }: LiveFeedItemProps) {
  const eventName = event.payload?.eventName ?? event.type ?? 'event';
  const normalizedName = eventName.toLowerCase().replace(/[\s-]/g, '_');
  const label = EVENT_LABELS[normalizedName] ?? eventName;
  const dotColor = EVENT_COLORS[normalizedName] ?? 'bg-white/30';
  const pageUrl = event.payload?.pageUrl;
  const ts = event.payload?.timestamp ?? event.timestamp ?? '';
  const customerName = (event.customerName || event.payload?.customerName || null) as string | null;

  const displayUrl = pageUrl
    ? (() => { try { return new URL(pageUrl).pathname; } catch { return pageUrl; } })()
    : null;

  return (
    <div className="flex items-start gap-2.5 border-b border-white/[0.04] px-3 py-2.5 transition-colors hover:bg-white/[0.02]">
      <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dotColor)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-white/80">{label}</span>
          {ts && (
            <span className="shrink-0 text-[10px] text-white/30">{relativeTime(ts)}</span>
          )}
        </div>
        {displayUrl && (
          <p className="mt-0.5 truncate text-[10px] text-white/35">{displayUrl}</p>
        )}
        {customerName && (
          <p className="mt-0.5 text-[10px] text-white/50">{customerName}</p>
        )}
      </div>
    </div>
  );
}
