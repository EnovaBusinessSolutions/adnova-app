import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { RecentPurchase } from '../types';

interface Props {
  purchases: RecentPurchase[];
  loading?: boolean;
}

// ─── Signal extraction ────────────────────────────────────────
interface Signals {
  fbp: boolean;
  fbc: boolean;
  gclid: boolean;
  ttclid: boolean;
  clickId: boolean;
  email: boolean;
  ip: boolean;
  userAgent: boolean;
}

function extractSignals(events: RecentPurchase['events']): Signals {
  return {
    fbp:       events.some((e) => !!e.fbp),
    fbc:       events.some((e) => !!e.fbc),
    gclid:     events.some((e) => !!e.gclid),
    ttclid:    events.some((e) => !!e.ttclid),
    clickId:   events.some((e) => !!e.clickId),
    email:     events.some((e) => !!e.customerEmail),
    ip:        events.some((e) => !!e.clientIp),
    userAgent: events.some((e) => !!e.userAgent),
  };
}

const SIGNAL_LABELS: Array<{ key: keyof Signals; label: string; tip: string }> = [
  {
    key: 'fbp',
    label: 'FBP',
    tip: 'Facebook Browser Pixel ID — cookie _fbp placed by the Meta Pixel. Used to match this session to a Meta user for CAPI deduplication.',
  },
  {
    key: 'fbc',
    label: 'FBC (Click id)',
    tip: 'Facebook Click ID — cookie _fbc set when a user arrives via a Meta ad (fbclid param). Strongest identity signal for Meta CAPI.',
  },
  {
    key: 'gclid',
    label: 'GCLID',
    tip: 'Google Click ID — URL parameter appended when a user clicks a Google Ads ad. Used to report conversions back to Google Ads.',
  },
  {
    key: 'ttclid',
    label: 'TTCLID',
    tip: 'TikTok Click ID — URL parameter from TikTok Ads. Used to match conversions in TikTok Events API.',
  },
  {
    key: 'clickId',
    label: 'Click ID',
    tip: 'Generic click ID captured from the URL (e.g. ttclid, msclkid, or custom). Stored as a fallback attribution anchor.',
  },
  {
    key: 'email',
    label: 'Email (Hashed)',
    tip: 'SHA-256 hashed customer email collected at checkout. Sent to Meta/Google CAPI as an identity match signal — the raw email is never stored.',
  },
  {
    key: 'ip',
    label: 'IP Address',
    tip: "Customer's IP address captured by the pixel. Used as a supplementary match signal in CAPI calls alongside email and user agent.",
  },
  {
    key: 'userAgent',
    label: 'User Agent',
    tip: "Browser user-agent string from the customer's device. Combined with IP and email for probabilistic matching in Meta/Google CAPI.",
  },
];

// ─── Per-order helpers ────────────────────────────────────────
function syncLabel(p: RecentPurchase): string {
  const channel = (p.attributedChannel ?? 'unknown').toUpperCase();
  const source = p.events[0]?.utmSource;
  if (source) return `${channel}: ${source.toUpperCase()}`;
  return channel;
}

function syncTip(p: RecentPurchase): string {
  const channel = p.attributedChannel ?? 'unknown';
  const source = p.events[0]?.utmSource;
  return `This order was attributed to the "${channel}" channel${source ? ` via utm_source="${source}"` : ''}. SYNC indicates which attribution path was resolved before firing CAPI events.`;
}

type PlatformStatus = 'recorded' | 'not_recorded';

function metaStatus(channel: string | null, s: Signals): PlatformStatus {
  return channel === 'meta' && s.fbp ? 'recorded' : 'not_recorded';
}

function googleStatus(channel: string | null, s: Signals): PlatformStatus {
  return channel === 'google' && (s.gclid || s.clickId) ? 'recorded' : 'not_recorded';
}

function overallStatus(meta: PlatformStatus, google: PlatformStatus) {
  if (meta === 'recorded' || google === 'recorded') return 'recorded';
  return 'not_recorded';
}

function statusText(meta: PlatformStatus, google: PlatformStatus): string {
  const parts: string[] = [];
  if (meta === 'not_recorded') parts.push('Meta not recorded');
  if (google === 'not_recorded') parts.push('Google not recorded');
  if (parts.length === 0) return 'All platforms recorded';
  return parts.join(' · ');
}

function platformTip(label: string, status: PlatformStatus, channel: string | null): string {
  if (status === 'recorded') {
    return `A ${label} Conversions API (CAPI) event was fired for this order with the enriched signals captured by AdNova.`;
  }
  if (label === 'Meta') {
    if (channel !== 'meta') {
      return `No Meta CAPI event sent — this order was not attributed to Meta (channel: ${channel ?? 'unknown'}). FBP signal alone is not enough to trigger a CAPI call.`;
    }
    return 'No Meta CAPI event sent — FBP signal was missing, which is required to deduplicate the conversion in Meta Events Manager.';
  }
  if (channel !== 'google') {
    return `No Google Ads conversion sent — this order was not attributed to Google (channel: ${channel ?? 'unknown'}). A GCLID is required.`;
  }
  return 'No Google Ads conversion sent — GCLID was missing from the session events for this order.';
}

function overallTip(meta: PlatformStatus, google: PlatformStatus): string {
  if (meta === 'recorded' && google === 'recorded') {
    return 'CAPI events were successfully sent to both Meta and Google for this order.';
  }
  if (meta === 'recorded') return 'CAPI event sent to Meta. Google conversion not recorded.';
  if (google === 'recorded') return 'Conversion sent to Google Ads. Meta CAPI not recorded.';
  return 'No CAPI/conversion events were sent to any ad platform for this order. This is normal for organic or unattributed orders.';
}

// ─── Sub-components ───────────────────────────────────────────
function Tip({ children, content }: { children: React.ReactNode; content: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        className="max-w-[260px] border-white/[0.10] bg-[#0f0f14] text-[11px] leading-relaxed text-white/70"
        side="top"
      >
        {content}
      </TooltipContent>
    </Tooltip>
  );
}

function PlatformBadge({
  label,
  status,
  channel,
}: {
  label: string;
  status: PlatformStatus;
  channel: string | null;
}) {
  const recorded = status === 'recorded';
  return (
    <Tip content={platformTip(label, status, channel)}>
      <span
        className={`inline-flex cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
          recorded
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
            : 'border-white/[0.08] bg-white/[0.04] text-white/40'
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${recorded ? 'bg-emerald-400' : 'bg-white/25'}`} />
        {label} {recorded ? 'Recorded' : 'Not recorded'}
      </span>
    </Tip>
  );
}

function SignalTag({ label, tip }: { label: string; tip: string }) {
  return (
    <Tip content={tip}>
      <span className="cursor-default rounded-md border border-[var(--adray-purple)]/20 bg-[var(--adray-purple)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--adray-purple)]/80">
        {label}
      </span>
    </Tip>
  );
}

const ARCHETYPE_STYLES: Record<string, string> = {
  high_intent:       'border-purple-500/30 bg-purple-500/10 text-purple-400',
  new_visitor:       'border-blue-500/30 bg-blue-500/10 text-blue-400',
  loyal_buyer:       'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  abandonment_risk:  'border-red-500/30 bg-red-500/10 text-red-400',
  price_sensitive:   'border-amber-500/30 bg-amber-500/10 text-amber-400',
  researcher:        'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
};

function archetypeTip(archetype: string | null, tier: string | null, confidence: number | null): string {
  if (!archetype) return 'No BRI analysis available for this session yet.';
  const conf = confidence != null ? ` (${Math.round(confidence * 100)}% confidence)` : '';
  const tierStr = tier ? ` · Tier: ${tier}` : '';
  return `BRI Archetype: ${archetype}${tierStr}${conf}. Behavioral Revenue Intelligence classifies buyers based on session signals to optimize retargeting.`;
}

function OrderCard({ purchase }: { purchase: RecentPurchase }) {
  const signals = extractSignals(purchase.events);
  const meta    = metaStatus(purchase.attributedChannel, signals);
  const google  = googleStatus(purchase.attributedChannel, signals);
  const overall = overallStatus(meta, google);
  const activeSignals = SIGNAL_LABELS.filter(({ key }) => signals[key]);

  const { briArchetype, briConfidence, briOrganicConverter, briExcludeFromRetargeting, briCustomerTier, briNextBestAction } = purchase;
  const archetypeStyle = briArchetype ? (ARCHETYPE_STYLES[briArchetype] ?? 'border-white/10 bg-white/5 text-white/50') : null;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        {/* Left content */}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Order + sync */}
          <div className="flex flex-wrap items-center gap-2">
            <Tip content="Shopify/WooCommerce order number attributed by AdNova's pixel and session stitching.">
              <span className="cursor-default text-[11px] font-semibold text-white">
                Order #{purchase.orderNumber ?? purchase.orderId}
              </span>
            </Tip>
            <Tip content={syncTip(purchase)}>
              <span className="cursor-default text-[9px] font-semibold uppercase tracking-wider text-white/30">
                SYNC: {syncLabel(purchase)}
              </span>
            </Tip>
          </div>

          {/* Platform badges */}
          <div className="flex flex-wrap gap-1.5">
            <PlatformBadge label="Meta"   status={meta}   channel={purchase.attributedChannel} />
            <PlatformBadge label="Google" status={google} channel={purchase.attributedChannel} />
          </div>

          {/* BRI badges */}
          {archetypeStyle && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tip content={archetypeTip(briArchetype, briCustomerTier, briConfidence)}>
                <span className={`cursor-default inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${archetypeStyle}`}>
                  <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                  {briArchetype!.replace(/_/g, ' ')}
                  {briConfidence != null && (
                    <span className="opacity-60 ml-0.5">{Math.round(briConfidence * 100)}%</span>
                  )}
                </span>
              </Tip>
              {briOrganicConverter && (
                <Tip content="This buyer converted organically — no paid retargeting needed. Excluding from paid audiences saves budget.">
                  <span className="cursor-default inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                    organic
                  </span>
                </Tip>
              )}
              {briExcludeFromRetargeting && (
                <Tip content="BRI flagged this buyer to be excluded from retargeting audiences — they convert without ad pressure.">
                  <span className="cursor-default inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-400">
                    suppress retargeting
                  </span>
                </Tip>
              )}
              {briNextBestAction && (
                <Tip content={`Next best action: ${briNextBestAction.content} (${briNextBestAction.priority} priority)`}>
                  <span className="cursor-default inline-flex items-center gap-1 rounded-full border border-[#B55CFF]/30 bg-[#B55CFF]/10 px-2 py-0.5 text-[10px] font-medium text-[#B55CFF]/80">
                    {briNextBestAction.type}
                  </span>
                </Tip>
              )}
            </div>
          )}

          {/* Signal tags */}
          {activeSignals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeSignals.map(({ key, label, tip }) => (
                <SignalTag key={key} label={label} tip={tip} />
              ))}
            </div>
          )}
        </div>

        {/* Right status */}
        <Tip content={overallTip(meta, google)}>
          <div className="shrink-0 cursor-default text-right">
            <p
              className={`text-[10px] font-semibold uppercase tracking-wider ${
                overall === 'recorded' ? 'text-emerald-400' : 'text-white/30'
              }`}
            >
              {overall === 'recorded' ? 'Recorded' : 'Not recorded'}
            </p>
            <p className="mt-0.5 max-w-[140px] text-[9px] leading-tight text-white/25">
              {statusText(meta, google)}
            </p>
          </div>
        </Tip>
      </div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 space-y-2">
      <Skeleton className="h-3 w-40 rounded bg-white/[0.06]" />
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-28 rounded-full bg-white/[0.04]" />
        <Skeleton className="h-5 w-28 rounded-full bg-white/[0.04]" />
      </div>
      <div className="flex gap-1">
        {[60, 80, 70, 65].map((w, i) => (
          <Skeleton key={i} className="h-4 rounded-md bg-white/[0.04]" style={{ width: w }} />
        ))}
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────
export function DataEnrichmentPanel({ purchases, loading }: Props) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="futuristic-surface rounded-2xl p-3 sm:p-4">
        {/* Header */}
        <div className="mb-1">
          <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">
            Data Pipeline
          </p>
          <Tip content="Shows the enrichment signals captured per order and whether a Conversions API (CAPI) event was successfully sent to Meta and/or Google for each one.">
            <p className="w-fit cursor-default text-xs font-semibold text-white/70">
              Data Enrichment
            </p>
          </Tip>
        </div>
        <p className="mb-4 text-[10px] text-white/30">
          Accurate data signals sent per order to their respective attribution platform.
        </p>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : purchases.length === 0 ? (
          <div className="flex h-20 items-center justify-center">
            <p className="text-xs text-white/25">No orders in this period</p>
          </div>
        ) : (
          <div className="max-h-[195px] overflow-y-auto space-y-2 pr-1">
            {purchases.map((p) => (
              <OrderCard key={p.orderId} purchase={p} />
            ))}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
