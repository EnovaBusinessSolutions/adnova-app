import { useState, useCallback, useMemo } from 'react';
import { Download, X, ShoppingCart, CreditCard, Eye, Package, Star, User, Zap, Globe, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '../utils/formatters';
import { channelColor, channelDisplayLabel, friendlyPlatformLabel } from '../utils/channelColors';
import type { RecentPurchase, JourneyEvent } from '../types';
import { ADRAY_PURPLE } from '../utils/adrayColors';

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
  if (n === 'user_logged_in')  return { label: 'User Logged In',  color: ADRAY_PURPLE, bg: `${ADRAY_PURPLE}18`, icon: <User size={9} /> };
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

function formatShortTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch { return iso; }
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function shortPath(url: string | null): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url; }
}

// Defensive sanitizer — backend already sanitizes, but old cached rows
// may still carry "/", "null", etc. Drop them so the UI never renders
// "adset: /" or similar noise.
const TRASH = new Set(['', '/', 'null', 'undefined', '(none)', '-', 'nan', 'n/a', 'na']);
function cleanAttr(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || TRASH.has(s.toLowerCase())) return null;
  if (s.startsWith('/') && s.length < 40 && !/\s/.test(s)) return null;
  return s;
}

function eventTime(e: JourneyEvent): number {
  const iso = e.capturedAt || e.createdAt;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function downloadCsv(purchase: RecentPurchase) {
  const headers = ['sessionId', 'eventName', 'createdAt', 'pageUrl', 'utmSource', 'utmCampaign', 'utmContent', 'utmTerm', 'orderId', 'productId', 'productName'];
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
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/[0.04] px-3 py-2 sm:px-4 sm:py-2.5 [&::-webkit-scrollbar]:hidden">
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
  const hasClickId = event.gclid || event.fbc || event.fbclid || event.ttclid || event.clickId;
  const clickIdTooltip = event.gclid
    ? `Google Ads click (gclid: ${String(event.gclid).slice(0, 14)}…)`
    : (event.fbclid || event.fbc)
      ? `Meta Ads click (${event.fbclid ? 'fbclid' : '_fbc'}: ${String(event.fbclid || event.fbc).slice(0, 14)}…)`
      : event.ttclid
        ? `TikTok Ads click (ttclid: ${String(event.ttclid).slice(0, 14)}…)`
        : 'Click ID capturado';
  const path = shortPath(event.pageUrl);

  return (
    <div className={`flex gap-2 px-3 py-2 sm:gap-3 sm:px-4 ${isPurchase ? 'bg-emerald-500/5' : ''}`}>
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
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="text-[11px] font-semibold"
            style={{ color: isPurchase ? '#10B981' : 'rgba(255,255,255,0.80)' }}
          >
            {cfg.label}
          </span>
          {hasClickId && (
            <Badge
              variant="outline"
              title={clickIdTooltip}
              className="h-3.5 shrink-0 cursor-help border-[var(--adray-purple)]/30 px-1 text-[8px] text-[#D8B8FF]"
            >
              click ID
            </Badge>
          )}
          {isPurchase && event.orderId && (
            <Badge
              variant="outline"
              className="h-3.5 shrink-0 border-emerald-500/30 px-1 text-[8px] text-emerald-400"
            >
              converted
            </Badge>
          )}
          {event.postPurchase && !isPurchase && (
            <Badge
              variant="outline"
              className="h-3.5 shrink-0 border-white/15 bg-white/[0.04] px-1 text-[8px] uppercase tracking-wider text-white/40"
            >
              post-purchase
            </Badge>
          )}
          <span className="ml-auto shrink-0 text-[10px] text-white/25">{formatTs(event.capturedAt || event.createdAt)}</span>
        </div>

        {!condensed && (
          <div className="mt-0.5 space-y-0.5">
            {path && (
              <p className="truncate text-[10px] text-white/35">{path}</p>
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

// ─── Session grouping ─────────────────────────────────────────
interface SessionGroup {
  sessionKey: string;             // real sessionId, or "nosession-N"
  sessionId: string | null;
  events: JourneyEvent[];
  start: number;
  end: number;
  landing: string | null;         // first pageUrl in the session
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  hasPurchase: boolean;
}

function groupBySession(events: JourneyEvent[]): SessionGroup[] {
  const sorted = [...events].sort((a, b) => eventTime(a) - eventTime(b));
  const groups: SessionGroup[] = [];
  const byKey = new Map<string, SessionGroup>();
  let orphanCounter = 0;

  for (const ev of sorted) {
    const key = ev.sessionId ?? `__nosession_${++orphanCounter}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        sessionKey: key,
        sessionId: ev.sessionId,
        events: [],
        start: eventTime(ev),
        end: eventTime(ev),
        landing: ev.pageUrl ?? null,
        utmSource: ev.utmSource ?? null,
        utmMedium: ev.utmMedium ?? null,
        utmCampaign: ev.utmCampaign ?? null,
        utmContent: ev.utmContent ?? null,
        utmTerm: ev.utmTerm ?? null,
        referrer: ev.referrer ?? null,
        hasPurchase: false,
      };
      byKey.set(key, g);
      groups.push(g);
    }
    g.events.push(ev);
    g.end = Math.max(g.end, eventTime(ev));
    if (!g.landing && ev.pageUrl) g.landing = ev.pageUrl;
    // Prefer first non-null UTMs we see (landing UTM is what matters)
    if (!g.utmSource && ev.utmSource) g.utmSource = ev.utmSource;
    if (!g.utmMedium && ev.utmMedium) g.utmMedium = ev.utmMedium;
    if (!g.utmCampaign && ev.utmCampaign) g.utmCampaign = ev.utmCampaign;
    if (!g.utmContent && ev.utmContent) g.utmContent = ev.utmContent;
    if (!g.utmTerm && ev.utmTerm) g.utmTerm = ev.utmTerm;
    if (!g.referrer && ev.referrer) g.referrer = ev.referrer;
    if (ev.eventName.toLowerCase() === 'purchase') g.hasPurchase = true;
  }

  return groups.sort((a, b) => a.start - b.start);
}

// ─── Session block ────────────────────────────────────────────
function SessionBlock({
  group,
  index,
  total,
  prevEnd,
  condensed,
}: {
  group: SessionGroup;
  index: number;
  total: number;
  prevEnd: number | null;
  condensed: boolean;
}) {
  const gap = prevEnd != null ? group.start - prevEnd : null;
  const duration = group.end - group.start;
  const landing = shortPath(group.landing);
  const referrerHost = group.referrer ? friendlyPlatformLabel(group.referrer) : null;

  const cleanCampaign = cleanAttr(group.utmCampaign);
  const cleanContent  = cleanAttr(group.utmContent);
  const cleanTerm     = cleanAttr(group.utmTerm);
  const cleanSource   = cleanAttr(group.utmSource);
  const cleanMedium   = cleanAttr(group.utmMedium);
  const campaignPieces: string[] = [];
  if (cleanCampaign) campaignPieces.push(`campaign: ${cleanCampaign}`);
  if (cleanContent)  campaignPieces.push(`adset: ${cleanContent}`);
  if (cleanTerm)     campaignPieces.push(`ad: ${cleanTerm}`);

  return (
    <div className="border-t border-white/[0.04] first:border-t-0">
      {/* Session header */}
      <div className="bg-white/[0.015] px-3 py-2 sm:px-4">
        {gap != null && gap > 60 * 1000 && (
          <div className="mb-1.5 flex items-center gap-2">
            <div className="h-px flex-1 bg-white/[0.04]" />
            <span className="text-[9px] uppercase tracking-wider text-white/25">
              +{formatDuration(gap)} después · regresa
            </span>
            <div className="h-px flex-1 bg-white/[0.04]" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--adray-purple)]/30 bg-[var(--adray-purple)]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#D8B8FF]">
            Session {index + 1}
            {total > 1 && <span className="text-white/40">/{total}</span>}
          </span>
          {group.hasPurchase && (
            <Badge
              variant="outline"
              className="h-3.5 shrink-0 border-emerald-500/30 px-1 text-[8px] font-medium text-emerald-400"
            >
              conversion
            </Badge>
          )}
          <span className="text-[10px] text-white/40">
            {formatShortTs(new Date(group.start).toISOString())}
            {duration > 0 && (
              <span className="text-white/25"> · {formatDuration(duration)}</span>
            )}
          </span>
          <span className="ml-auto text-[10px] text-white/25">
            {group.events.length} events
          </span>
        </div>

        {!condensed && (landing || referrerHost || campaignPieces.length > 0 || cleanSource) && (
          <div className="mt-1 space-y-0.5 text-[10px]">
            {landing && (
              <p className="flex items-center gap-1 truncate text-white/40">
                <Globe size={9} className="shrink-0 text-white/30" />
                <span className="truncate">{landing}</span>
              </p>
            )}
            {(cleanSource || referrerHost) && (
              <p className="text-white/40">
                <span className="text-white/25">from: </span>
                <span className="text-white/60">
                  {cleanSource ?? referrerHost ?? 'direct'}
                </span>
                {cleanMedium && (
                  <>
                    <span className="text-white/25"> / </span>
                    <span className="text-white/50">{cleanMedium}</span>
                  </>
                )}
              </p>
            )}
            {campaignPieces.length > 0 && (
              <p className="flex items-start gap-1 text-white/40">
                <Target size={9} className="mt-0.5 shrink-0 text-white/30" />
                <span className="min-w-0 flex-1 truncate">{campaignPieces.join(' · ')}</span>
              </p>
            )}
            {!group.sessionId && (
              <p className="text-[9px] italic text-white/25">
                (eventos sin sessionId — agrupados juntos)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Events */}
      <div className="py-1.5">
        {group.events.map((ev, i) => (
          <EventRow
            key={ev.eventId ?? `${group.sessionKey}-${i}`}
            event={ev}
            condensed={condensed}
            isLast={i === group.events.length - 1}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────
export function SelectedJourney({ purchase, onClose }: SelectedJourneyProps) {
  const [condensed, setCondensed] = useState(false);
  const [eventFilter, setEventFilter] = useState<string | null>(null);
  const handleDownload = useCallback(() => downloadCsv(purchase), [purchase]);

  const filteredEvents = useMemo(
    () => (eventFilter
      ? purchase.events.filter((e) => e.eventName.toLowerCase() === eventFilter)
      : purchase.events),
    [purchase.events, eventFilter],
  );

  const sessionGroups = useMemo(() => groupBySession(filteredEvents), [filteredEvents]);

  const chColor = channelColor(purchase.attributedChannel);

  // Campaign / adset / ad header line — use conversion-level attribution
  // (chosen by the selected model), falling back to purchase.attributedPlatform.
  // Defensive clean: old snapshots may still have "/" junk.
  const cleanPurchaseCampaign = cleanAttr(purchase.attributedCampaign);
  const cleanPurchaseAdset    = cleanAttr(purchase.attributedAdset);
  const cleanPurchaseAd       = cleanAttr(purchase.attributedAd);
  const campaignLine: string[] = [];
  if (cleanPurchaseCampaign) campaignLine.push(`campaign: ${cleanPurchaseCampaign}`);
  if (cleanPurchaseAdset)    campaignLine.push(`adset: ${cleanPurchaseAdset}`);
  if (cleanPurchaseAd)       campaignLine.push(`ad: ${cleanPurchaseAd}`);

  const platformFriendly = friendlyPlatformLabel(purchase.attributedPlatform);

  // Click-ID fallback: when we have a click id but no campaign name, tell
  // the user which ad platform the click came from so attribution is never
  // "just empty". The resolver job may fill campaign asynchronously on a
  // later request.
  const clickProviderLabel: Record<string, string> = {
    meta:   'Meta Ads',
    google: 'Google Ads',
    tiktok: 'TikTok Ads',
  };
  const hasCampaign = campaignLine.length > 0;
  const showClickIdFallback =
    !hasCampaign && purchase.attributedClickId && purchase.attributedClickIdProvider;
  const clickIdShort = purchase.attributedClickId
    ? purchase.attributedClickId.slice(0, 18) + (purchase.attributedClickId.length > 18 ? '…' : '')
    : null;

  // Human-readable labels for the attributionSource tag. Backend uses short
  // internal codes; we expand them here so the UI never shows cryptic
  // strings like "woo_fallback" or "orders_sync".
  const SOURCE_LABELS: Record<string, string> = {
    click_id:     'Click ID',
    utm:          'UTM parameters',
    referrer:     'Referrer',
    orders_sync:  'Platform sync (Shopify)',
    woo_fallback: 'WooCommerce attribution',
    click_view:   'Google Ads API lookup',
    none:         'Unattributed',
  };
  function formatAttributionSource(raw: string | null | undefined): string | null {
    if (!raw) return null;
    // source can be composed (e.g. "click_id+click_view") — format each piece.
    return raw
      .split(/[+,]/)
      .map((part) => SOURCE_LABELS[part.trim()] ?? part.trim())
      .join(' + ');
  }
  const attributionSourceBadge = formatAttributionSource(purchase.attributionSource);
  const attributionSourceTooltip =
    'Cómo calculamos la atribución de este pedido: Click ID (más alta confianza) > UTM > Platform sync > WooCommerce > Referrer';

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.02]">
      {/* Header */}
      <div className="border-b border-white/[0.06] px-3 py-3 sm:flex sm:items-start sm:justify-between sm:px-4">
        {/* Info (left on desktop, top on mobile) */}
        <div className="min-w-0 sm:flex-1">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: chColor }} />
            <span className="min-w-0 truncate text-sm font-semibold text-white/85">
              {purchase.orderNumber ? `Order #${purchase.orderNumber}` : purchase.orderId.slice(0, 16)}
            </span>
            {/* Mobile-only close button (top-right of row 1) */}
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="Close journey"
              className="ml-auto h-7 w-7 shrink-0 p-0 text-white/40 hover:text-white sm:hidden"
            >
              <X size={14} />
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge
              variant="outline"
              className="h-4 shrink-0 max-w-[260px] truncate px-1.5 text-[9px] text-white/45"
              style={{ borderColor: `${chColor}40` }}
              title={channelDisplayLabel(purchase.attributedChannel, purchase.attributedPlatform)}
            >
              {channelDisplayLabel(purchase.attributedChannel, purchase.attributedPlatform)}
            </Badge>
            <span className="shrink-0 text-xs font-semibold text-white/70">
              {formatCurrency(purchase.revenue, purchase.currency)}
            </span>
            <span className="shrink-0 text-[10px] text-white/30">
              {purchase.events.length} events · {sessionGroups.length} session{sessionGroups.length === 1 ? '' : 's'}
            </span>
          </div>
          {(hasCampaign || showClickIdFallback || (platformFriendly && purchase.attributedChannel?.toLowerCase() !== 'other')) && (
            <div className="mt-1.5 flex items-start gap-1 text-[10px]">
              <Target size={10} className="mt-0.5 shrink-0 text-white/35" />
              <span className="min-w-0 flex-1 truncate text-white/55">
                {hasCampaign
                  ? campaignLine.join(' · ')
                  : showClickIdFallback
                    ? `${clickProviderLabel[purchase.attributedClickIdProvider!] ?? 'Ads'} · click ID: ${clickIdShort}`
                    : platformFriendly
                      ? `source: ${platformFriendly}`
                      : null}
              </span>
            </div>
          )}
          {attributionSourceBadge && (
            <div
              className="mt-1 flex cursor-help items-center gap-1 text-[9px] text-white/25"
              title={attributionSourceTooltip}
            >
              <span>attribution source:</span>
              <span className="rounded border border-white/[0.06] bg-white/[0.02] px-1 py-[1px] text-white/45">
                {attributionSourceBadge}
              </span>
            </div>
          )}
        </div>

        {/* Actions: bottom-row on mobile, right-aligned inline on sm+ */}
        <div className="mt-3 flex items-center gap-1 sm:mt-0 sm:shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCondensed((v) => !v)}
            className="h-7 px-2 text-[10px] text-white/45 hover:text-white sm:h-6"
          >
            {condensed ? 'Full' : 'Condensed'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-7 gap-1 px-2 text-[10px] text-white/45 hover:text-white sm:h-6"
          >
            <Download size={10} />
            CSV
          </Button>
          {/* Desktop-only close button (inline with actions) */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close journey"
            className="hidden h-6 w-6 p-0 text-white/30 hover:text-white sm:inline-flex"
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

      {/* BRI Narrative */}
      {purchase.briArchetype && (
        <div className="border-b border-white/[0.04] px-4 py-2.5 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-[#B55CFF]/60">BRI</span>
            <span className="text-[10px] rounded-full border border-white/10 bg-white/5 px-2 py-0 text-white/50">
              {purchase.briArchetype.replace(/_/g, ' ')}
            </span>
            {purchase.briCustomerTier && (
              <span className="text-[10px] text-white/30">tier: {purchase.briCustomerTier}</span>
            )}
            {purchase.briConfidence != null && (
              <span className="text-[10px] text-white/30">{Math.round(purchase.briConfidence * 100)}% confidence</span>
            )}
            {purchase.briOrganicConverter && (
              <span className="text-[10px] rounded-full border border-emerald-500/25 bg-emerald-500/8 px-2 py-0 text-emerald-400">organic</span>
            )}
            {purchase.briExcludeFromRetargeting && (
              <span className="text-[10px] rounded-full border border-orange-500/25 bg-orange-500/8 px-2 py-0 text-orange-400">suppress retargeting</span>
            )}
          </div>
          {purchase.briNextBestAction && (
            <p className="text-[10px] text-[#B55CFF]/70 leading-relaxed">
              <span className="text-white/20 mr-1">→</span>
              {purchase.briNextBestAction.content}
            </p>
          )}
        </div>
      )}

      {/* Timeline grouped by session */}
      <div className="min-h-0 flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-track]:bg-transparent">
        {sessionGroups.length === 0 ? (
          <p className="py-8 text-center text-xs text-white/25">No events of this type</p>
        ) : (
          sessionGroups.map((g, i) => (
            <SessionBlock
              key={g.sessionKey}
              group={g}
              index={i}
              total={sessionGroups.length}
              prevEnd={i === 0 ? null : sessionGroups[i - 1].end}
              condensed={condensed}
            />
          ))
        )}
      </div>
    </div>
  );
}
