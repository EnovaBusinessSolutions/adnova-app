// dashboard-src/src/pages/BriPipeline.tsx
import React, { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Brain, Users, Activity, CheckCircle2, XCircle,
  Clock, ChevronDown, ChevronRight, Loader2,
  MousePointer, ScrollText, Eye, ShoppingCart, AlertTriangle,
  ArrowLeftRight, ZapOff, Star, Maximize2, Navigation, LogOut, CreditCard,
} from "lucide-react";

/* ── Types ──────────────────────────────────────────────────────────────────── */

interface PipelineStats {
  recordings: { RECORDING: number; FINALIZING: number; READY: number; ERROR: number };
  sessionPackets: { total: number; analyzed: number; pending: number };
  persons: number;
  briEnriched: number;
}

interface Keyframe {
  type: string;
  elapsed_seconds?: number;  // seconds from session start (primary)
  timestamp?: number;        // absolute unix ms (fallback)
  page_url?: string;
  interaction?: Record<string, unknown>;
  data?: Record<string, unknown>;
  // allow extra fields emitted by keyframeExtractor
  [key: string]: unknown;
}

interface AiAnalysis {
  archetype?: string;
  narrative?: string;
  customer_tier?: string;
  confidence_score?: number;
  friction_signals?: unknown;
  next_best_action?: { type: string; content: string; priority: string; timing_days?: number };
  organic_converter?: boolean;
  exclude_from_retargeting?: boolean;
  retention_insight?: string;
  predicted_ltv_multiplier?: number;
}

interface PersonAnalysis {
  tier: string | null;
  behaviorSummary: string | null;
  conversionProb: number | null;
  preferredChannel: string | null;
  nextBestAction: { type: string; content: string; priority: string; timing_days?: number } | null;
  retentionInsight: string | null;
  ltvEstimate: number | null;
  confidence: number | null;
  sessionCount: number;
  analyzedAt: string;
}

interface PersonRow {
  id: string;
  accountId: string;
  visitorIds: string[];
  emailHashes: string[];
  customerIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  sessionCount: number;
  orderCount: number;
  totalSpent: number;
  analysis: PersonAnalysis | null;
}

interface SessionPacketRow {
  sessionId: string;
  accountId: string;
  visitorId: string | null;
  personId: string | null;
  outcome: string;
  orderId: string | null;
  cartValueAtEnd: number | null;
  aiAnalysis: AiAnalysis | null;
  aiAnalyzedAt: string | null;
  startTs: string;
  endTs: string;
  durationMs: number;
  keyframes: Keyframe[] | null;
  signals: Record<string, unknown> | null;
}

interface ApiResponse<T> { ok: boolean; data?: T; error?: string }

interface LoopStatus {
  name: string;
  intervalMs: number;
  firstDelayMs: number;
  registeredAt: string;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastResult: Record<string, unknown> | null;
  lastError: { message: string; at: string } | null;
  runCount: number;
  errorCount: number;
  nextRunAt: string | null;
}

interface LoopsStatusResponse {
  ok: boolean;
  loops: LoopStatus[];
  now: string;
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

async function apiFetch<T>(url: string): Promise<ApiResponse<T>> {
  try {
    const r = await fetch(url, { credentials: "include" });
    const body = await r.json();
    return r.ok ? { ok: true, data: body } : { ok: false, error: body.error || r.statusText };
  } catch (e: unknown) {
    return { ok: false, error: (e as Error).message };
  }
}

function fmtDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function fmtOffset(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  if (ms < 1000) return "0s";
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

/** Resolve keyframe offset in ms from session start, tolerating missing fields. */
function keyframeOffsetMs(kf: Keyframe, startTs?: number): number {
  if (typeof kf.elapsed_seconds === "number" && Number.isFinite(kf.elapsed_seconds)) {
    return kf.elapsed_seconds * 1000;
  }
  if (typeof kf.timestamp === "number" && typeof startTs === "number") {
    return Math.max(0, kf.timestamp - startTs);
  }
  return 0;
}

/* ── Adray palette aligned with attribution panel ────────────────────────── */

const OUTCOME_STYLES: Record<string, string> = {
  PURCHASED: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  ABANDONED: "border-red-500/30 bg-red-500/10 text-red-400",
  BOUNCED:   "border-orange-500/30 bg-orange-500/10 text-orange-400",
};

function outcomeStyle(outcome: string) {
  return OUTCOME_STYLES[outcome] || "border-white/[0.08] bg-white/[0.04] text-white/50";
}

const ARCHETYPE_STYLES: Record<string, string> = {
  high_intent:       "border-purple-500/30 bg-purple-500/10 text-purple-400",
  new_visitor:       "border-blue-500/30 bg-blue-500/10 text-blue-400",
  loyal_buyer:       "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  abandonment_risk:  "border-red-500/30 bg-red-500/10 text-red-400",
  price_sensitive:   "border-amber-500/30 bg-amber-500/10 text-amber-400",
  researcher:        "border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
};

function archetypeStyle(archetype: string | null | undefined) {
  if (!archetype) return "border-white/[0.08] bg-white/[0.04] text-white/40";
  return ARCHETYPE_STYLES[archetype] || "border-white/[0.08] bg-white/[0.04] text-white/50";
}

const STATUS_STYLES: Record<string, string> = {
  RECORDING:  "border-blue-500/30 bg-blue-500/10 text-blue-400",
  FINALIZING: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  READY:      "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  ERROR:      "border-red-500/30 bg-red-500/10 text-red-400",
};

const PRIORITY_STYLES: Record<string, string> = {
  high:   "border-red-500/30 bg-red-500/10 text-red-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  low:    "border-white/[0.08] bg-white/[0.04] text-white/50",
};

const TIER_STYLES: Record<string, string> = {
  vip:       "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
  returning: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  new:       "border-blue-500/30 bg-blue-500/10 text-blue-400",
  at_risk:   "border-red-500/30 bg-red-500/10 text-red-400",
};

/* ── Shared atoms (attribution-panel vocabulary) ─────────────────────────── */

function Pill({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone} ${className}`}
    >
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[9px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">
      {children}
    </p>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">
      {children}
    </p>
  );
}

/* ── Keyframe config ────────────────────────────────────────────────────────── */

const KEYFRAME_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  page_navigation:       { icon: Navigation,    color: "text-white/50",    label: "Page nav" },
  session_end:           { icon: LogOut,        color: "text-white/40",    label: "Session end" },
  scroll_stop:           { icon: ScrollText,    color: "text-blue-400",    label: "Scroll stop" },
  product_hover:         { icon: Eye,           color: "text-cyan-400",    label: "Product hover" },
  product_view:          { icon: Maximize2,     color: "text-cyan-400",    label: "Product view" },
  rage_click:            { icon: MousePointer,  color: "text-red-400",     label: "Rage click" },
  checkout_entry:        { icon: CreditCard,    color: "text-purple-400",  label: "Checkout entry" },
  checkout_hesitation:   { icon: AlertTriangle, color: "text-amber-400",   label: "Checkout hesitation" },
  add_to_cart:           { icon: ShoppingCart,  color: "text-emerald-400", label: "Add to cart" },
  cart_modification:     { icon: ShoppingCart,  color: "text-emerald-400", label: "Cart modification" },
  purchase:              { icon: ShoppingCart,  color: "text-emerald-400", label: "Purchase" },
  tab_switch:            { icon: ArrowLeftRight,color: "text-white/40",    label: "Tab switch" },
  form_abandon:          { icon: ZapOff,        color: "text-orange-400",  label: "Form abandon" },
  visibility_change:     { icon: Eye,           color: "text-white/30",    label: "Visibility change" },
  high_engagement:       { icon: Star,          color: "text-yellow-400",  label: "High engagement" },
};

function getKeyframeConfig(type: string) {
  return KEYFRAME_CONFIG[type] || { icon: Activity, color: "text-white/30", label: type.replace(/_/g, " ") };
}

/* ── Stat Card (KpiCard-aligned) ───────────────────────────────────────────── */

function StatCard({
  label, value, sub, icon: Icon, accentClass,
}: {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  accentClass?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-[var(--adray-line)] bg-[var(--adray-surface-2)] backdrop-blur-md transition-all duration-200 hover:bg-[rgba(255,255,255,0.035)] hover:shadow-[var(--adray-shadow-lg)] ${accentClass || ""}`}
    >
      <div className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[11px] font-medium leading-tight text-white/45">{label}</p>
          <span className="mt-0.5 shrink-0 text-white/25">
            <Icon size={13} />
          </span>
        </div>
        <p className="mt-2 text-[1rem] font-semibold leading-tight tracking-tight text-white sm:text-[1.15rem] tabular-nums">
          {value}
        </p>
        {sub != null && (
          <p className="mt-1 text-[11px] leading-tight text-white/35">{sub}</p>
        )}
      </div>
    </div>
  );
}

/* ── Keyframes Timeline ─────────────────────────────────────────────────────── */

function KeyframesTimeline({
  keyframes,
  durationMs,
  startTs,
}: {
  keyframes: Keyframe[];
  durationMs: number;
  startTs?: number;
}) {
  if (!keyframes.length) return (
    <p className="text-[11px] text-white/25 italic">No keyframes captured</p>
  );

  // Skip-noise fields from the small text line under each keyframe.
  const HIDDEN_EXTRA = new Set([
    "type", "timestamp", "elapsed_seconds", "page_url", "interaction",
    "ts", "session_id", "merchantId", "visitorId", "merchant_id", "visitor_id",
  ]);

  return (
    <div className="space-y-1">
      {keyframes.map((kf, i) => {
        const cfg = getKeyframeConfig(kf.type);
        const Icon = cfg.icon;
        const offsetMs = keyframeOffsetMs(kf, startTs);
        const pct = durationMs > 0 ? Math.min((offsetMs / durationMs) * 100, 100) : 0;

        // Collect humanly-useful extras: scroll_depth_percent, hover_duration,
        // page_url for navigation, element_id for rage_clicks, etc. Anything
        // scalar that isn't already represented by the label/offset.
        const interactionExtras: string[] = [];
        if (kf.interaction && typeof kf.interaction === "object") {
          for (const [k, v] of Object.entries(kf.interaction)) {
            if (v == null) continue;
            if (typeof v === "object") continue;
            interactionExtras.push(`${k}: ${v}`);
          }
        }
        const topLevelExtras: string[] = [];
        for (const [k, v] of Object.entries(kf)) {
          if (HIDDEN_EXTRA.has(k)) continue;
          if (v == null) continue;
          if (typeof v === "object") continue;
          topLevelExtras.push(`${k}: ${v}`);
        }
        const pageUrl = kf.type === "page_navigation" && kf.page_url ? kf.page_url : null;
        const extraBits = [
          pageUrl ? pageUrl : null,
          ...topLevelExtras,
          ...interactionExtras,
        ].filter(Boolean) as string[];
        const extra = extraBits.length ? extraBits.slice(0, 3).join(" · ") : null;

        return (
          <div key={i} className="flex items-start gap-2">
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center shrink-0">
              <div className="h-5 w-5 rounded-full flex items-center justify-center border border-white/[0.08] bg-white/[0.04]">
                <Icon className={`h-2.5 w-2.5 ${cfg.color}`} />
              </div>
              {i < keyframes.length - 1 && (
                <div className="w-px h-full min-h-[8px] bg-white/[0.05] mt-0.5" />
              )}
            </div>
            {/* Content */}
            <div className="pb-2 min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-white/25 tabular-nums">{fmtOffset(offsetMs)}</span>
                <div className="h-px flex-1 bg-white/[0.04]" />
                <span className="text-[10px] text-white/20 tabular-nums">{Math.round(pct)}%</span>
              </div>
              {extra && (
                <p className="text-[10px] text-white/30 mt-0.5 truncate">{extra}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── AI Insights Card ───────────────────────────────────────────────────────── */

function AiInsightsCard({ ai }: { ai: AiAnalysis }) {
  const nba = ai.next_best_action;
  const frictionSignals = Array.isArray(ai.friction_signals)
    ? ai.friction_signals as string[]
    : ai.friction_signals ? [String(ai.friction_signals)] : [];

  return (
    <div className="space-y-3">
      {/* Archetype + confidence */}
      <div className="flex items-center gap-2 flex-wrap">
        {ai.archetype && (
          <Pill tone={archetypeStyle(ai.archetype)}>
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {ai.archetype.replace(/_/g, " ")}
            {ai.confidence_score != null && (
              <span className="opacity-60 ml-0.5">{Math.round(ai.confidence_score * 100)}%</span>
            )}
          </Pill>
        )}
        {ai.customer_tier && (
          <span className="text-[11px] text-white/35">
            tier <span className="text-white/60 font-medium">{ai.customer_tier}</span>
          </span>
        )}
        {ai.organic_converter && (
          <Pill tone="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">organic</Pill>
        )}
        {ai.exclude_from_retargeting && (
          <Pill tone="border-orange-500/30 bg-orange-500/10 text-orange-400">suppress retargeting</Pill>
        )}
      </div>

      {/* Narrative */}
      {ai.narrative && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <FieldLabel>Narrative</FieldLabel>
          <p className="text-[12px] text-white/65 leading-relaxed">{ai.narrative}</p>
        </div>
      )}

      {/* Friction signals */}
      {frictionSignals.length > 0 && (
        <div>
          <FieldLabel>Friction signals</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {frictionSignals.map((s, i) => (
              <Pill key={i} tone="border-amber-500/30 bg-amber-500/10 text-amber-400">
                {s}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Next best action */}
      {nba && (
        <div className="rounded-xl border border-[var(--adray-purple)]/25 bg-[var(--adray-purple)]/[0.06] p-3">
          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">
              Next best action
            </p>
            <div className="flex items-center gap-1.5">
              <Pill tone="border-white/[0.08] bg-white/[0.04] text-white/50">{nba.type}</Pill>
              <Pill tone={PRIORITY_STYLES[nba.priority] || PRIORITY_STYLES.low}>{nba.priority}</Pill>
              {nba.timing_days != null && (
                <span className="text-[10px] text-white/30">in {nba.timing_days}d</span>
              )}
            </div>
          </div>
          <p className="text-[12px] text-white/65 leading-relaxed">{nba.content}</p>
        </div>
      )}

      {/* Retention insight */}
      {ai.retention_insight && (
        <div>
          <FieldLabel>Retention insight</FieldLabel>
          <p className="text-[11px] text-white/50 leading-relaxed">{ai.retention_insight}</p>
        </div>
      )}

      {/* LTV */}
      {ai.predicted_ltv_multiplier != null && (
        <p className="text-[11px] text-white/35">
          Predicted LTV multiplier{" "}
          <span className="text-white/70 font-semibold">{ai.predicted_ltv_multiplier}×</span>
        </p>
      )}
    </div>
  );
}

/* ── Packet Row ─────────────────────────────────────────────────────────────── */

function PacketRow({ packet }: { packet: SessionPacketRow }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"insights" | "keyframes" | "identifiers">("insights");
  const ai = packet.aiAnalysis;
  const keyframes = Array.isArray(packet.keyframes) ? packet.keyframes : [];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:bg-white/[0.03]">
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />}

        <span className="font-mono text-[11px] text-white/45 w-[108px] shrink-0 truncate">
          {packet.sessionId.slice(0, 12)}…
        </span>

        <Pill tone={outcomeStyle(packet.outcome)} className="shrink-0">
          {packet.outcome}
        </Pill>

        {ai ? (
          <Pill tone={archetypeStyle(ai.archetype)} className="shrink-0">
            {ai.archetype?.replace(/_/g, " ") || "analyzed"}
          </Pill>
        ) : (
          <Pill tone="border-white/[0.08] bg-white/[0.04] text-white/35" className="shrink-0">
            pending AI
          </Pill>
        )}

        {packet.personId && (
          <Pill tone="border-blue-500/30 bg-blue-500/10 text-blue-400" className="shrink-0">
            person
          </Pill>
        )}

        {keyframes.length > 0 && (
          <span className="text-[10px] text-white/25 shrink-0">{keyframes.length} kf</span>
        )}

        <span className="ml-auto text-[11px] text-white/40 shrink-0 tabular-nums">
          {fmtDuration(packet.durationMs)}
        </span>

        {ai?.confidence_score != null && (
          <span className="text-[11px] text-white/45 shrink-0 w-10 text-right tabular-nums">
            {Math.round(ai.confidence_score * 100)}%
          </span>
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-4">
          {/* Tab bar */}
          <div className="flex gap-1 mb-3 border-b border-white/[0.05] pb-2">
            {(["insights", "keyframes", "identifiers"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-[11px] px-2.5 py-1 rounded-md transition-colors font-medium ${
                  tab === t
                    ? "bg-white/[0.08] text-white"
                    : "text-white/35 hover:text-white/65 hover:bg-white/[0.04]"
                }`}
              >
                {t === "keyframes" ? `keyframes (${keyframes.length})` : t}
              </button>
            ))}
          </div>

          {tab === "insights" && (
            ai
              ? <AiInsightsCard ai={ai} />
              : <p className="text-[11px] text-white/25 italic">No AI analysis yet — packet pending processing.</p>
          )}

          {tab === "keyframes" && (
            <KeyframesTimeline
              keyframes={keyframes}
              durationMs={packet.durationMs}
              startTs={packet.startTs ? new Date(packet.startTs).getTime() : undefined}
            />
          )}

          {tab === "identifiers" && (
            <div className="space-y-1.5 text-[11px]">
              {[
                ["sessionId",  packet.sessionId,                    true],
                ["accountId",  packet.accountId,                    true],
                ["visitorId",  packet.visitorId,                    true],
                ["personId",   packet.personId,                     true],
                ["orderId",    packet.orderId,                      false],
                ["outcome",    packet.outcome,                      false],
                ["cartValue",  packet.cartValueAtEnd != null ? `$${packet.cartValueAtEnd}` : null, false],
                ["start",      new Date(packet.startTs).toLocaleString(), false],
                ["duration",   fmtDuration(packet.durationMs),     false],
                ["analyzed",   packet.aiAnalyzedAt ? new Date(packet.aiAnalyzedAt).toLocaleString() : "—", false],
              ].filter(([, v]) => v != null).map(([label, value, mono]) => (
                <div key={String(label)} className="flex gap-2 items-baseline">
                  <span className="text-white/30 shrink-0 w-24">{label}</span>
                  <span className={`truncate ${mono ? "font-mono text-white/55" : "text-white/65"}`}>
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Person Row ─────────────────────────────────────────────────────────────── */

function PersonRow({ person }: { person: PersonRow }) {
  const [open, setOpen] = useState(false);
  const a = person.analysis;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] transition-colors hover:bg-white/[0.03]">
      <button
        className="w-full flex items-center gap-2.5 px-3.5 py-3 text-left"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />}

        <span className="font-mono text-[11px] text-white/45 w-[96px] shrink-0 truncate">
          {person.id.slice(0, 8)}…
        </span>

        {a?.tier ? (
          <Pill tone={TIER_STYLES[a.tier] || "border-white/[0.08] bg-white/[0.04] text-white/50"} className="shrink-0">
            {a.tier}
          </Pill>
        ) : (
          <Pill tone="border-white/[0.08] bg-white/[0.04] text-white/35" className="shrink-0">
            no profile
          </Pill>
        )}

        <span className="text-[11px] text-white/45 shrink-0 tabular-nums">
          {person.sessionCount} sessions
        </span>
        <span className="text-[11px] text-white/45 shrink-0 tabular-nums">
          {person.orderCount} orders
        </span>

        <span className="ml-auto text-[11px] text-white/70 font-semibold shrink-0 tabular-nums">
          ${person.totalSpent.toFixed(0)}
        </span>

        {a?.conversionProb != null && (
          <span className="text-[11px] text-white/45 shrink-0 w-10 text-right tabular-nums">
            {Math.round(a.conversionProb * 100)}%
          </span>
        )}
      </button>

      {open && (
        <div className="px-3.5 pb-4 space-y-3 text-[11px]">
          {/* Identifiers */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-white/30">
            <span>first seen <span className="text-white/55">{new Date(person.firstSeenAt).toLocaleDateString()}</span></span>
            <span>last seen <span className="text-white/55">{new Date(person.lastSeenAt).toLocaleDateString()}</span></span>
            {person.visitorIds.length > 0 && <span>visitors <span className="font-mono text-white/45">{person.visitorIds.length}</span></span>}
            {person.emailHashes.length > 0 && <span>emails <span className="font-mono text-white/45">{person.emailHashes.length}</span></span>}
            {person.customerIds.length > 0 && <span>customer ids <span className="font-mono text-white/45">{person.customerIds.length}</span></span>}
          </div>

          {!a && <p className="text-white/25 italic">No cross-session analysis yet — will generate after next session.</p>}

          {a && (
            <>
              {/* Behavior summary */}
              {a.behaviorSummary && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <FieldLabel>Behavior summary</FieldLabel>
                  <p className="text-[12px] text-white/65 leading-relaxed">{a.behaviorSummary}</p>
                </div>
              )}

              {/* Key metrics */}
              <div className="flex flex-wrap gap-5">
                {a.conversionProb != null && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/30">Conversion prob.</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/80 tabular-nums">
                      {Math.round(a.conversionProb * 100)}%
                    </p>
                  </div>
                )}
                {a.ltvEstimate != null && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/30">LTV estimate</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/80 tabular-nums">
                      ${a.ltvEstimate.toFixed(0)}
                    </p>
                  </div>
                )}
                {a.preferredChannel && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/30">Preferred channel</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/80">{a.preferredChannel}</p>
                  </div>
                )}
                {a.confidence != null && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-white/30">Confidence</p>
                    <p className="mt-0.5 text-[13px] font-semibold text-white/80 tabular-nums">
                      {Math.round(a.confidence * 100)}%
                    </p>
                  </div>
                )}
              </div>

              {/* Next best action */}
              {a.nextBestAction && (
                <div className="rounded-xl border border-[var(--adray-purple)]/25 bg-[var(--adray-purple)]/[0.06] p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--adray-purple)]/70">
                      Next best action
                    </p>
                    <div className="flex items-center gap-1.5">
                      <Pill tone="border-white/[0.08] bg-white/[0.04] text-white/50">{a.nextBestAction.type}</Pill>
                      <Pill tone={PRIORITY_STYLES[a.nextBestAction.priority] || PRIORITY_STYLES.low}>
                        {a.nextBestAction.priority}
                      </Pill>
                      {a.nextBestAction.timing_days != null && (
                        <span className="text-[10px] text-white/30">in {a.nextBestAction.timing_days}d</span>
                      )}
                    </div>
                  </div>
                  <p className="text-[12px] text-white/65 leading-relaxed">{a.nextBestAction.content}</p>
                </div>
              )}

              {/* Retention insight */}
              {a.retentionInsight && (
                <p className="text-[11px] text-white/45 italic leading-relaxed">{a.retentionInsight}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────────── */

function fmtRelative(iso: string | null, now: number): string {
  if (!iso) return "—";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "—";
  const abs = Math.abs(ms);
  if (abs < 10_000) return ms >= 0 ? "just now" : "in a moment";
  const suffix = ms >= 0 ? "ago" : "from now";
  if (abs < 60_000) return `${Math.round(abs / 1000)}s ${suffix}`;
  if (abs < 60 * 60_000) return `${Math.round(abs / 60_000)}m ${suffix}`;
  return `${Math.floor(abs / (60 * 60_000))}h ${suffix}`;
}

function LoopsStrip({ loopsData }: { loopsData: LoopsStatusResponse | null }) {
  if (!loopsData || loopsData.loops.length === 0) {
    return (
      <span className="text-[10px] text-white/25">
        auto-loops status unavailable
      </span>
    );
  }
  const now = new Date(loopsData.now).getTime();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-white/35">
      {loopsData.loops.map((l) => {
        const alive = l.runCount > 0 && !l.lastError;
        const stale = l.runCount === 0;
        const dot = stale
          ? "bg-white/30"
          : alive
          ? "bg-emerald-400"
          : "bg-amber-400";
        return (
          <span key={l.name} className="inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
            <span className="text-white/55 font-medium">{l.name}</span>
            <span className="text-white/25">
              {l.runCount === 0
                ? `first run ${fmtRelative(l.nextRunAt, now)}`
                : `ran ${fmtRelative(l.lastRunAt, now)} · next ${fmtRelative(l.nextRunAt, now)}`}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function BriPipeline() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [packets, setPackets] = useState<SessionPacketRow[]>([]);
  const [persons, setPersons] = useState<PersonRow[]>([]);
  const [loopsData, setLoopsData] = useState<LoopsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "pending">("all");
  const [mainTab, setMainTab] = useState<"sessions" | "persons">("sessions");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [statsRes, packetsRes, personsRes, loopsRes] = await Promise.all([
      apiFetch<PipelineStats>("/api/bri/pipeline-stats"),
      apiFetch<SessionPacketRow[]>("/api/bri/session-packets?limit=50"),
      apiFetch<PersonRow[]>("/api/bri/persons?limit=30"),
      apiFetch<LoopsStatusResponse>("/api/bri/loops-status"),
    ]);
    if (!statsRes.ok) setError(statsRes.error || "Failed to load stats");
    if (statsRes.data) setStats(statsRes.data);
    if (packetsRes.data) setPackets(packetsRes.data);
    if (personsRes.data) setPersons(personsRes.data);
    if (loopsRes.data) setLoopsData(loopsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh the loops strip every 20s without touching the stats/sessions
  // queries — cheaper, and lets the user watch the next-run countdown.
  useEffect(() => {
    const id = setInterval(async () => {
      const r = await apiFetch<LoopsStatusResponse>("/api/bri/loops-status");
      if (r.data) setLoopsData(r.data);
    }, 20_000);
    return () => clearInterval(id);
  }, []);

  const filteredPackets = packets.filter(p => {
    if (filter === "analyzed") return !!p.aiAnalysis;
    if (filter === "pending") return !p.aiAnalysis;
    return true;
  });

  return (
    <DashboardLayout>
      {/* ── Sticky header in AttributionHeader style ── */}
      <div className="border-b border-[var(--adray-line)] bg-[rgba(5,5,8,0.82)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgba(5,5,8,0.72)] sm:sticky sm:top-0 sm:z-[30]">
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 md:px-6">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--adray-purple)]/30 bg-[var(--adray-purple)]/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-[#D8B8FF]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--adray-purple)]/50" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#D8B8FF]" />
            </span>
            BRI PIPELINE
          </div>

          <div className="mx-1 h-4 w-px bg-[var(--adray-line)]" />

          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-white/35 leading-tight">
              Behavioral Revenue Intelligence — keyframes, AI insights & identity resolution
            </p>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={load}
            disabled={loading}
            className="h-8 gap-1.5 border border-white/[0.08] bg-white/[0.03] px-3 text-xs text-white/60 hover:bg-white/[0.08] hover:text-white"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-[12px] text-red-400">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Stats grid */}
        {stats && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              <StatCard
                label="Recordings READY"
                value={stats.recordings.READY}
                sub={`${stats.recordings.RECORDING} recording · ${stats.recordings.ERROR} error`}
                icon={Activity}
              />
              <StatCard
                label="Session Packets"
                value={stats.sessionPackets.total}
                sub={`${stats.sessionPackets.pending} pending analysis`}
                icon={Clock}
              />
              <StatCard
                label="AI Analyzed"
                value={stats.sessionPackets.analyzed}
                sub={`of ${stats.sessionPackets.total} packets`}
                icon={Brain}
              />
              <StatCard
                label="Persons Resolved"
                value={stats.persons}
                sub={`${stats.briEnriched} CAPI enriched`}
                icon={Users}
              />
            </div>

            {/* Pipeline status strip */}
            <div className="futuristic-surface rounded-2xl p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <SectionLabel>Pipeline</SectionLabel>
                <LoopsStrip loopsData={loopsData} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["RECORDING", "FINALIZING", "READY", "ERROR"] as const).map(status => (
                  <Pill key={status} tone={STATUS_STYLES[status]} className="px-2.5 py-1 text-[11px]">
                    <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
                    {status}
                    <span className="ml-1 font-semibold tabular-nums">{stats.recordings[status]}</span>
                  </Pill>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Main panel: Sessions / Persons */}
        <div className="futuristic-surface rounded-2xl">
          <div className="flex flex-row items-center justify-between gap-2 border-b border-white/[0.05] px-3.5 py-3 flex-wrap">
            <div className="flex gap-1">
              {(["sessions", "persons"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setMainTab(t)}
                  className={`text-[12px] px-3 py-1.5 rounded-md transition-colors font-medium ${
                    mainTab === t
                      ? "bg-white/[0.08] text-white"
                      : "text-white/35 hover:text-white/65 hover:bg-white/[0.04]"
                  }`}
                >
                  {t === "sessions" ? `Sessions (${packets.length})` : `Persons (${persons.length})`}
                </button>
              ))}
            </div>

            {mainTab === "sessions" && (
              <div className="flex gap-1">
                {(["all", "analyzed", "pending"] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                      filter === f
                        ? "bg-white/[0.08] text-white"
                        : "text-white/35 hover:text-white/65 hover:bg-white/[0.04]"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 sm:p-3.5">
            {loading && packets.length === 0 && (
              <div className="flex items-center justify-center py-12 text-white/25 text-[12px]">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…
              </div>
            )}

            {mainTab === "sessions" && (
              <>
                {!loading && filteredPackets.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-white/25 text-[12px] gap-2">
                    <CheckCircle2 className="h-7 w-7" />
                    No session packets yet
                  </div>
                )}
                <div className="space-y-2">
                  {filteredPackets.map(p => <PacketRow key={p.sessionId} packet={p} />)}
                </div>
              </>
            )}

            {mainTab === "persons" && (
              <>
                {!loading && persons.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-white/25 text-[12px] gap-2">
                    <Users className="h-7 w-7" />
                    No persons resolved yet
                  </div>
                )}
                <div className="space-y-2">
                  {persons.map(p => <PersonRow key={p.id} person={p} />)}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
