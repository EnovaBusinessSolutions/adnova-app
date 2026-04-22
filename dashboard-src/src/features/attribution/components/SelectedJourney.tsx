import { useState, useCallback } from 'react';
import { Download, X, ShoppingCart, CreditCard, Eye, Package, Star, User, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '../utils/formatters';
import { channelColor, channelLabel } from '../utils/channelColors';
import type { RecentPurchase, JourneyEvent } from '../types';

interface SelectedJourneyProps {
  purchase: RecentPurchase;
  onClose: () => void;
}

// ─── Event type config ────────────────────────────────────────
interface EventConfig {
  label: string;
  color: string;
  bg: string;
  icon: React.ReactNode;
}

function getEventConfig(name: string): EventConfig {
  const n = name.toLowerCase();
  if (n === 'purchase')        return { label: 'Purchase',        color: '#10B981', bg: '#10B98118', icon: <Star size={9} /> };
  if (n === 'begin_checkout')  return { label: 'Begin Checkout',  color: '#F97316', bg: '#F9731618', icon: <CreditCard size={9} /> };
  if (n === 'add_to_cart')     return { label: 'Add to Cart',     color: '#F59E0B', bg: '#F59E0B18', icon: <ShoppingCart size={9} /> };
  if (n === 'view_item')       return { label: 'View Item',       color: '#34D399', bg: '#34D39918', icon: <Package size={9} /> };
  if (n === 'page_view')       return { label: 'Page View',       color: '#60A5FA', bg: '#60A5FA18', icon: <Eye size={9} /> };
  if (n === 'user_logged_in')  return { label: 'User Logged In',  color: '#B55CFF', bg: '#B55CFF18', icon: <User size={9} /> };
  return { label: name, color: '#6B7280', bg: '#6B728018', icon: <Zap size={9} /> };
}

// ─── Utilities ────────────────────────────────────────────────
function formatTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function shortPath(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url; }
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

// ─── Journey summary strip ────────────────────────────────────
const KEY_EVENTS = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'];

function JourneySummary({
  events,
  activeFilter,
  onFilter,
}: {
  events: JourneyEvent[];
  activeFilter: string | null;
  onFilter: (key: string | null) => void;
}) {
  const present = KEY_EVENTS.filter((key) =>
    events.some((e) => e.eventName.toLowerCase() === key),
  );

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.04] px-4 py-2.5 [&::-webkit-scrollbar]:hidden">
      {present.map((key, i) => {
        const cfg = getEventConfig(key);
        const isActive = activeFilter === key;
        return (
          <div key={key} className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => onFilter(isActive ? null : key)}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 transition-all"
              style={{
                background: isActive ? cfg.color + '30' : cfg.bg,
                color: cfg.color,
                outline: isActive ? `1px solid ${cfg.color}60` : 'none',
              }}
              title={`Filter by ${cfg.label}`}
            >
              {cfg.icon}
              <span className="text-[9px] font-semibold uppercase tracking-wide">{cfg.label}</span>
            </button>
            {i < present.length - 1 && (
              <span className="text-[10px] text-white/20">→</span>
            )}
          </div>
        );
      })}
      {activeFilter && (
        <button
          onClick={() => onFilter(null)}
          className="ml-1 shrink-0 text-[9px] text-white/30 underline hover:text-white/60"
        >
          clear
        </button>
      )}
    </div>
  );
}

// ─── Event row ────────────────────────────────────────────────
function EventRow({
  event,
  condensed,
  isLast,
}: {
  event: JourneyEvent;
  condensed: boolean;
  isLast: boolean;
}) {
  const cfg = getEventConfig(event.eventName);
  const isPurchase = event.eventName.toLowerCase() === 'purchase';
  const hasClickId = event.gclid || event.fbc || event.ttclid || event.clickId;
  const path = shortPath(event.pageUrl);

  return (
    <div className={`flex gap-3 px-4 py-2 ${isPurchase ? 'bg-emerald-500/5' : ''}`}>
      {/* Timeline indicator */}
      <div className="relative flex flex-col items-center">
        <div
          className="z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40` }}
        >
          {cfg.icon}
        </div>
        {!isLast && (
          <div className="mt-0.5 w-px flex-1 bg-white/[0.06]" style={{ minHeight: 12 }} />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-2">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-semibold"
            style={{ color: isPurchase ? '#10B981' : 'rgba(255,255,255,0.80)' }}
          >
            {cfg.label}
          </span>
          {hasClickId && (
            <Badge
              variant="outline"
              className="h-3.5 border-[#B55CFF]/30 px-1 text-[8px] text-[#D8B8FF]"
            >
              click ID
            </Badge>
          )}
          {isPurchase && event.orderId && (
            <Badge
              variant="outline"
              className="h-3.5 border-emerald-500/30 px-1 text-[8px] text-emerald-400"
            >
              converted
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-white/25">{formatTs(event.createdAt)}</span>
        </div>

        {!condensed && (
          <div className="mt-0.5 space-y-0.5">
            {path && (
              <p className="truncate text-[10px] text-white/35">{path}</p>
            )}
            {event.utmSource && (
              <p className="text-[10px]">
                <span className="text-white/25">utm_source: </span>
                <span className="text-white/50">{event.utmSource}</span>
              </p>
            )}
            {event.productName && (
              <p className="text-[10px]">
                <span className="text-white/25">product: </span>
                <span className="text-white/50">{event.productName}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────
export function SelectedJourney({ purchase, onClose }: SelectedJourneyProps) {
  const [condensed, setCondensed] = useState(false);
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const handleDownload = useCallback(() => downloadCsv(purchase), [purchase]);

  const visibleEvents = eventFilter
    ? purchase.events.filter((e) => e.eventName.toLowerCase() === eventFilter)
    : purchase.events;

  const chColor = channelColor(purchase.attributedChannel);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-white/[0.06] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chColor }} />
            <span className="text-sm font-semibold text-white/85">
              {purchase.orderNumber ? `Order #${purchase.orderNumber}` : purchase.orderId.slice(0, 16)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] text-white/45"
              style={{ borderColor: `${chColor}40` }}
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

        <div className="flex shrink-0 items-center gap-1">
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

      {/* Journey summary */}
      <JourneySummary
        events={purchase.events}
        activeFilter={eventFilter}
        onFilter={setEventFilter}
      />

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {visibleEvents.length === 0 ? (
          <p className="py-8 text-center text-xs text-white/25">No events of this type</p>
        ) : (
          <div className="py-2">
            {visibleEvents.map((event, i) => (
              <EventRow
                key={event.eventId ?? `ev-${i}`}
                event={event}
                condensed={condensed}
                isLast={i === visibleEvents.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
