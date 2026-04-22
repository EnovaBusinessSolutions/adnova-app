import { Skeleton } from '@/components/ui/skeleton';
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

const SIGNAL_LABELS: Array<{ key: keyof Signals; label: string }> = [
  { key: 'fbp',       label: 'FBP' },
  { key: 'fbc',       label: 'FBC (Click id)' },
  { key: 'gclid',     label: 'GCLID' },
  { key: 'ttclid',    label: 'TTCLID' },
  { key: 'clickId',   label: 'Click ID' },
  { key: 'email',     label: 'Email (Hashed)' },
  { key: 'ip',        label: 'IP Address' },
  { key: 'userAgent', label: 'User Agent' },
];

// ─── Per-order helpers ────────────────────────────────────────
function syncLabel(p: RecentPurchase): string {
  const channel = (p.attributedChannel ?? 'unknown').toUpperCase();
  const source = p.events[0]?.utmSource;
  if (source) return `${channel}: ${source.toUpperCase()}`;
  return channel;
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

// ─── Sub-components ───────────────────────────────────────────
function PlatformBadge({ label, status }: { label: string; status: PlatformStatus }) {
  const recorded = status === 'recorded';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        recorded
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
          : 'border-white/[0.08] bg-white/[0.04] text-white/40'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${recorded ? 'bg-emerald-400' : 'bg-white/25'}`} />
      {label} {recorded ? 'Recorded' : 'Not recorded'}
    </span>
  );
}

function SignalTag({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-[#B55CFF]/20 bg-[#B55CFF]/10 px-2 py-0.5 text-[10px] font-medium text-[#B55CFF]/80">
      {label}
    </span>
  );
}

function OrderCard({ purchase }: { purchase: RecentPurchase }) {
  const signals = extractSignals(purchase.events);
  const meta   = metaStatus(purchase.attributedChannel, signals);
  const google = googleStatus(purchase.attributedChannel, signals);
  const overall = overallStatus(meta, google);
  const activeSignals = SIGNAL_LABELS.filter(({ key }) => signals[key]);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
      <div className="flex items-start gap-3">
        {/* Left content */}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Order + sync */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-white">
              Order #{purchase.orderNumber ?? purchase.orderId}
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-white/30">
              SYNC: {syncLabel(purchase)}
            </span>
          </div>

          {/* Platform badges */}
          <div className="flex flex-wrap gap-1.5">
            <PlatformBadge label="Meta"   status={meta} />
            <PlatformBadge label="Google" status={google} />
          </div>

          {/* Signal tags */}
          {activeSignals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeSignals.map(({ key, label }) => (
                <SignalTag key={key} label={label} />
              ))}
            </div>
          )}
        </div>

        {/* Right status */}
        <div className="shrink-0 text-right">
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
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      {/* Header */}
      <div className="mb-1">
        <p className="text-[9px] font-semibold uppercase tracking-wider text-[#B55CFF]/70">
          Data Pipeline
        </p>
        <p className="text-xs font-semibold text-white/70">Data Enrichment</p>
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
  );
}
