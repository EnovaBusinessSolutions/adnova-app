// dashboard-src/src/pages/BriPipeline.tsx
import React, { useEffect, useState, useCallback } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, Brain, Users, Activity, CheckCircle2, XCircle,
  Clock, ChevronDown, ChevronRight, Loader2,
  MousePointer, ScrollText, Eye, ShoppingCart, AlertTriangle,
  ArrowLeftRight, ZapOff, Star, Maximize2,
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
  ts: number;        // ms offset from session start
  data?: Record<string, unknown>;
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
  if (ms < 1000) return `0s`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function outcomeColor(outcome: string) {
  if (outcome === "PURCHASED") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (outcome === "ABANDONED") return "bg-red-500/15 text-red-400 border-red-500/30";
  if (outcome === "BOUNCED") return "bg-orange-500/15 text-orange-400 border-orange-500/30";
  return "bg-white/10 text-white/50 border-white/10";
}

function archetypeColor(archetype: string | null | undefined) {
  if (!archetype) return "bg-white/5 text-white/30 border-white/10";
  const map: Record<string, string> = {
    high_intent: "bg-purple-500/15 text-purple-400 border-purple-500/30",
    new_visitor: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    loyal_buyer: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    abandonment_risk: "bg-red-500/15 text-red-400 border-red-500/30",
    price_sensitive: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    researcher: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  };
  return map[archetype] || "bg-white/10 text-white/50 border-white/10";
}

/* ── Keyframe config ────────────────────────────────────────────────────────── */

const KEYFRAME_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  scroll_stop:           { icon: ScrollText,    color: "text-blue-400",    label: "Scroll stop" },
  product_hover:         { icon: Eye,           color: "text-cyan-400",    label: "Product hover" },
  product_view:          { icon: Maximize2,     color: "text-cyan-400",    label: "Product view" },
  rage_click:            { icon: MousePointer,  color: "text-red-400",     label: "Rage click" },
  checkout_hesitation:   { icon: AlertTriangle, color: "text-amber-400",   label: "Checkout hesitation" },
  add_to_cart:           { icon: ShoppingCart,  color: "text-emerald-400", label: "Add to cart" },
  tab_switch:            { icon: ArrowLeftRight,color: "text-white/40",    label: "Tab switch" },
  form_abandon:          { icon: ZapOff,        color: "text-orange-400",  label: "Form abandon" },
  visibility_change:     { icon: Eye,           color: "text-white/30",    label: "Visibility change" },
  high_engagement:       { icon: Star,          color: "text-yellow-400",  label: "High engagement" },
};

function getKeyframeConfig(type: string) {
  return KEYFRAME_CONFIG[type] || { icon: Activity, color: "text-white/30", label: type.replace(/_/g, " ") };
}

/* ── Stat Card ──────────────────────────────────────────────────────────────── */

function StatCard({ label, value, sub, icon: Icon, color = "text-white" }: {
  label: string; value: number | string; sub?: string;
  icon: React.ElementType; color?: string;
}) {
  return (
    <Card className="bg-white/[0.03] border-white/[0.06]">
      <CardContent className="p-4 flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-white/5 p-2">
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
        <div>
          <div className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
          <div className="text-xs text-white/40 mt-0.5">{label}</div>
          {sub && <div className="text-xs text-white/25 mt-0.5">{sub}</div>}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Keyframes Timeline ─────────────────────────────────────────────────────── */

function KeyframesTimeline({ keyframes, durationMs }: { keyframes: Keyframe[]; durationMs: number }) {
  if (!keyframes.length) return (
    <p className="text-xs text-white/20 italic">No keyframes captured</p>
  );

  return (
    <div className="space-y-1">
      {keyframes.map((kf, i) => {
        const cfg = getKeyframeConfig(kf.type);
        const Icon = cfg.icon;
        const pct = durationMs > 0 ? Math.min((kf.ts / durationMs) * 100, 100) : 0;
        const extra = kf.data && Object.keys(kf.data).length > 0
          ? Object.entries(kf.data)
              .filter(([k]) => !["ts", "type"].includes(k))
              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
              .join(" · ")
          : null;

        return (
          <div key={i} className="flex items-start gap-2">
            {/* Timeline dot + line */}
            <div className="flex flex-col items-center shrink-0">
              <div className={`h-5 w-5 rounded-full flex items-center justify-center bg-white/5 border border-white/10`}>
                <Icon className={`h-2.5 w-2.5 ${cfg.color}`} />
              </div>
              {i < keyframes.length - 1 && (
                <div className="w-px h-full min-h-[8px] bg-white/[0.05] mt-0.5" />
              )}
            </div>
            {/* Content */}
            <div className="pb-2 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</span>
                <span className="text-[10px] text-white/25">{fmtOffset(kf.ts)}</span>
                <div className="h-px flex-1 bg-white/[0.04]" />
                <span className="text-[10px] text-white/15">{Math.round(pct)}%</span>
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
          <Badge variant="outline" className={`text-xs px-2.5 py-0.5 ${archetypeColor(ai.archetype)}`}>
            {ai.archetype.replace(/_/g, " ")}
          </Badge>
        )}
        {ai.customer_tier && (
          <span className="text-xs text-white/40">tier: <span className="text-white/60">{ai.customer_tier}</span></span>
        )}
        {ai.confidence_score != null && (
          <span className="text-xs text-white/40">confidence: <span className="text-white/60">{Math.round(ai.confidence_score * 100)}%</span></span>
        )}
        {ai.organic_converter && (
          <Badge variant="outline" className="text-xs px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">organic</Badge>
        )}
        {ai.exclude_from_retargeting && (
          <Badge variant="outline" className="text-xs px-2 py-0.5 bg-orange-500/10 text-orange-400 border-orange-500/20">suppress retargeting</Badge>
        )}
      </div>

      {/* Narrative */}
      {ai.narrative && (
        <div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">Narrative</p>
          <p className="text-xs text-white/60 leading-relaxed">{ai.narrative}</p>
        </div>
      )}

      {/* Friction signals */}
      {frictionSignals.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5">Friction signals</p>
          <div className="flex flex-wrap gap-1.5">
            {frictionSignals.map((s, i) => (
              <span key={i} className="text-[11px] rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-400">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Next best action */}
      {nba && (
        <div className="rounded-lg bg-purple-500/5 border border-purple-500/15 p-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-purple-400/60">Next best action</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/30">{nba.type}</span>
              <span className={`text-[10px] rounded-full px-1.5 py-0 border ${
                nba.priority === "high"
                  ? "border-red-500/30 text-red-400 bg-red-500/10"
                  : nba.priority === "medium"
                  ? "border-amber-500/30 text-amber-400 bg-amber-500/10"
                  : "border-white/10 text-white/30 bg-white/5"
              }`}>{nba.priority}</span>
              {nba.timing_days != null && (
                <span className="text-[10px] text-white/25">in {nba.timing_days}d</span>
              )}
            </div>
          </div>
          <p className="text-xs text-white/60 leading-relaxed">{nba.content}</p>
        </div>
      )}

      {/* Retention insight */}
      {ai.retention_insight && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1">Retention insight</p>
          <p className="text-xs text-white/50 leading-relaxed">{ai.retention_insight}</p>
        </div>
      )}

      {/* LTV */}
      {ai.predicted_ltv_multiplier != null && (
        <p className="text-xs text-white/30">
          Predicted LTV multiplier: <span className="text-white/60 font-medium">{ai.predicted_ltv_multiplier}×</span>
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
    <div className="border-b border-white/[0.05] last:border-0">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen(!open)}
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 text-white/30 shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-white/30 shrink-0" />}

        <span className="font-mono text-xs text-white/40 w-[120px] shrink-0 truncate">
          {packet.sessionId.slice(0, 12)}…
        </span>

        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${outcomeColor(packet.outcome)}`}>
          {packet.outcome}
        </Badge>

        {ai ? (
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${archetypeColor(ai.archetype)}`}>
            {ai.archetype?.replace(/_/g, " ") || "analyzed"}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 bg-white/5 text-white/20 border-white/10">
            no AI
          </Badge>
        )}

        {packet.personId && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 bg-blue-500/10 text-blue-400 border-blue-500/20">
            person
          </Badge>
        )}

        {keyframes.length > 0 && (
          <span className="text-[10px] text-white/20 shrink-0">{keyframes.length} kf</span>
        )}

        <span className="ml-auto text-xs text-white/30 shrink-0">{fmtDuration(packet.durationMs)}</span>

        {ai?.confidence_score != null && (
          <span className="text-xs text-white/30 shrink-0 w-10 text-right">
            {Math.round(ai.confidence_score * 100)}%
          </span>
        )}
      </button>

      {open && (
        <div className="px-4 pb-5">
          {/* Tab bar */}
          <div className="flex gap-1 mb-4 border-b border-white/[0.05] pb-2">
            {(["insights", "keyframes", "identifiers"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${
                  tab === t ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60"
                }`}
              >
                {t === "keyframes" ? `keyframes (${keyframes.length})` : t}
              </button>
            ))}
          </div>

          {tab === "insights" && (
            ai
              ? <AiInsightsCard ai={ai} />
              : <p className="text-xs text-white/20 italic">No AI analysis yet — packet pending processing.</p>
          )}

          {tab === "keyframes" && (
            <KeyframesTimeline keyframes={keyframes} durationMs={packet.durationMs} />
          )}

          {tab === "identifiers" && (
            <div className="space-y-1.5 text-xs">
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
                  <span className="text-white/30 shrink-0 w-28">{label}</span>
                  <span className={`truncate ${mono ? "font-mono text-white/50" : "text-white/60"}`}>{String(value)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────────────── */

export default function BriPipeline() {
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [packets, setPackets] = useState<SessionPacketRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "pending">("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [statsRes, packetsRes] = await Promise.all([
      apiFetch<PipelineStats>("/api/bri/pipeline-stats"),
      apiFetch<SessionPacketRow[]>("/api/bri/session-packets?limit=50"),
    ]);
    if (!statsRes.ok) setError(statsRes.error || "Failed to load stats");
    if (statsRes.data) setStats(statsRes.data);
    if (packetsRes.data) setPackets(packetsRes.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const filteredPackets = packets.filter(p => {
    if (filter === "analyzed") return !!p.aiAnalysis;
    if (filter === "pending") return !p.aiAnalysis;
    return true;
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">BRI Pipeline</h1>
            <p className="text-sm text-white/40 mt-0.5">Behavioral Revenue Intelligence — keyframes, AI insights & identity</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={loading}
            className="border-white/10 text-white/60 hover:text-white hover:border-white/20"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
            <XCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard label="Recordings READY" value={stats.recordings.READY}
                sub={`${stats.recordings.RECORDING} recording · ${stats.recordings.ERROR} error`}
                icon={Activity} color="text-emerald-400" />
              <StatCard label="Session Packets" value={stats.sessionPackets.total}
                sub={`${stats.sessionPackets.pending} pending analysis`}
                icon={Clock} color="text-blue-400" />
              <StatCard label="AI Analyzed" value={stats.sessionPackets.analyzed}
                sub={`of ${stats.sessionPackets.total} packets`}
                icon={Brain} color="text-purple-400" />
              <StatCard label="Persons Resolved" value={stats.persons}
                sub={`${stats.briEnriched} CAPI enriched`}
                icon={Users} color="text-amber-400" />
            </div>

            <Card className="bg-white/[0.03] border-white/[0.06]">
              <CardContent className="px-4 py-3 flex flex-wrap gap-3">
                {(["RECORDING", "FINALIZING", "READY", "ERROR"] as const).map(status => {
                  const colors: Record<string, string> = {
                    RECORDING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
                    FINALIZING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
                    READY: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                    ERROR: "bg-red-500/10 text-red-400 border-red-500/20",
                  };
                  return (
                    <Badge key={status} variant="outline" className={`px-3 py-1 text-sm ${colors[status]}`}>
                      {status} <span className="ml-2 font-semibold">{stats.recordings[status]}</span>
                    </Badge>
                  );
                })}
              </CardContent>
            </Card>
          </>
        )}

        {/* Session Packets */}
        <Card className="bg-white/[0.03] border-white/[0.06]">
          <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-white/60">Session Packets</CardTitle>
            <div className="flex gap-1">
              {(["all", "analyzed", "pending"] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                    filter === f ? "bg-white/10 text-white" : "text-white/30 hover:text-white/60"
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading && packets.length === 0 && (
              <div className="flex items-center justify-center py-12 text-white/20">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…
              </div>
            )}
            {!loading && filteredPackets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-white/20 text-sm gap-2">
                <CheckCircle2 className="h-8 w-8" />No session packets yet
              </div>
            )}
            {filteredPackets.map(p => <PacketRow key={p.sessionId} packet={p} />)}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
