// dashboard-src/src/pages/CreativeIntelligence.tsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardLayout from "@/components/DashboardLayout";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import DisconnectedIntegrationCard from "@/components/DisconnectedIntegrationCard";
import {
  useCreativeIntelligence,
  useCreativeAccounts,
  toggleRecommendationCheck,
  resyncMetaAccounts,
  type CreativeSnapshot,
  type CreativeObjective,
  type CreativeTier,
} from "@/hooks/useCreativeIntelligence";
import {
  RefreshCw,
  Sparkles,
  ChevronDown,
  Check,
  Star,
  TrendingUp,
  AlertTriangle,
  XCircle,
  Info,
  Zap,
  Target,
  Shield,
  RotateCcw,
} from "lucide-react";

/* =============== Utility Functions =============== */

const tierConfig: Record<
  CreativeTier,
  { label: string; color: string; bgColor: string; icon: React.ReactNode }
> = {
  star: {
    label: "Estrella",
    color: "#FCD34D",
    bgColor: "rgba(252,211,77,0.15)",
    icon: <Star className="h-4 w-4" />,
  },
  good: {
    label: "Bueno",
    color: "#34D399",
    bgColor: "rgba(52,211,153,0.15)",
    icon: <TrendingUp className="h-4 w-4" />,
  },
  average: {
    label: "Promedio",
    color: "#60A5FA",
    bgColor: "rgba(96,165,250,0.15)",
    icon: <Info className="h-4 w-4" />,
  },
  poor: {
    label: "Bajo",
    color: "#FB923C",
    bgColor: "rgba(251,146,60,0.15)",
    icon: <AlertTriangle className="h-4 w-4" />,
  },
  critical: {
    label: "Crítico",
    color: "#F87171",
    bgColor: "rgba(248,113,113,0.15)",
    icon: <XCircle className="h-4 w-4" />,
  },
};

const objectiveLabels: Record<CreativeObjective, string> = {
  ventas: "Ventas",
  alcance: "Alcance",
  leads: "Leads",
};

function formatCurrency(value: number | null, decimals = 2): string {
  if (value == null) return "—";
  return `$${value.toLocaleString("es-MX", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatNumber(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("es-MX");
}

function formatPercent(value: number | null, decimals = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatDelta(value: number | null): { text: string; color: string } {
  if (value == null) return { text: "—", color: "text-white/50" };
  const pct = (value * 100).toFixed(1);
  if (value > 0) return { text: `+${pct}%`, color: "text-green-400" };
  if (value < 0) return { text: `${pct}%`, color: "text-red-400" };
  return { text: "0%", color: "text-white/50" };
}

/* =============== Components =============== */

function CreativeIntelligenceHeader({
  onRefresh,
  loading,
}: {
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-400">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">Creative Intelligence</h1>
            <p className="text-xs text-muted-foreground">Motor de Decisión Creativa</p>
          </div>
          <span className="ml-2 rounded bg-gradient-to-r from-amber-500 to-yellow-400 px-2 py-0.5 text-[10px] font-bold text-black">
            PRO
          </span>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>
    </header>
  );
}

function AccountSelector({
  accounts,
  selectedId,
  onChange,
}: {
  accounts: Array<{ id: string; name: string }>;
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const selected = accounts.find((a) => a.id === selectedId);

  return (
    <div className="relative">
      <select
        value={selectedId}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-white/10 bg-white/5 px-4 py-2 pr-8 text-sm text-white outline-none focus:border-purple-500"
      >
        {accounts.map((acc) => (
          <option key={acc.id} value={acc.id} className="bg-[#1A1622] text-white">
            {acc.name || `Cuenta ${acc.id}`}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
    </div>
  );
}

function ObjectiveSelector({
  value,
  onChange,
}: {
  value: CreativeObjective;
  onChange: (v: CreativeObjective) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
      {(["ventas", "alcance", "leads"] as CreativeObjective[]).map((obj) => (
        <button
          key={obj}
          onClick={() => onChange(obj)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            value === obj
              ? "bg-purple-600 text-white"
              : "text-white/60 hover:bg-white/10 hover:text-white"
          }`}
        >
          {objectiveLabels[obj]}
        </button>
      ))}
    </div>
  );
}

function SummaryCards({
  summary,
}: {
  summary: {
    total: number;
    star: number;
    good: number;
    average: number;
    poor: number;
    critical: number;
  };
}) {
  const items: Array<{ tier: CreativeTier; count: number }> = [
    { tier: "star", count: summary.star },
    { tier: "good", count: summary.good },
    { tier: "average", count: summary.average },
    { tier: "poor", count: summary.poor },
    { tier: "critical", count: summary.critical },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
      {items.map(({ tier, count }) => {
        const config = tierConfig[tier];
        return (
          <div
            key={tier}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
            style={{ borderColor: `${config.color}30` }}
          >
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ backgroundColor: config.bgColor, color: config.color }}
              >
                {config.icon}
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{count}</div>
                <div className="text-xs text-white/50">{config.label}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScoreGauge({ score, label, icon }: { score: number; label: string; icon: React.ReactNode }) {
  const getColor = (s: number) => {
    if (s >= 80) return "#34D399";
    if (s >= 65) return "#60A5FA";
    if (s >= 45) return "#FBBF24";
    if (s >= 25) return "#FB923C";
    return "#F87171";
  };

  const color = getColor(score);

  return (
    <div className="flex items-center gap-2">
      <div className="text-white/50">{icon}</div>
      <div className="flex-1">
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-white/60">{label}</span>
          <span className="font-semibold" style={{ color }}>
            {score}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${score}%`, backgroundColor: color }}
          />
        </div>
      </div>
    </div>
  );
}

function CreativeCard({
  creative,
  accountId,
  onRecommendationToggle,
}: {
  creative: CreativeSnapshot;
  accountId: string;
  onRecommendationToggle: (adId: string, recId: string, checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = tierConfig[creative.tier];

  const primaryMetric = useMemo(() => {
    switch (creative.userObjective) {
      case "ventas":
        return { label: "ROAS", value: creative.metrics.roas?.toFixed(2) + "x" || "—" };
      case "leads":
        return { label: "CPL", value: formatCurrency(creative.metrics.cpl) };
      case "alcance":
        return { label: "CPM", value: formatCurrency(creative.metrics.cpm) };
      default:
        return { label: "ROAS", value: creative.metrics.roas?.toFixed(2) + "x" || "—" };
    }
  }, [creative]);

  return (
    <div
      className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] transition hover:border-white/20"
      style={{ borderLeftColor: config.color, borderLeftWidth: 3 }}
    >
      {/* Header */}
      <div
        className="flex cursor-pointer items-start justify-between p-4"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex gap-3 min-w-0 flex-1">
          {/* Thumbnail */}
          <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-white/5">
            {creative.thumbnailUrl ? (
              <img
                src={creative.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-white/30">
                <Sparkles className="h-6 w-6" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-white">{creative.adName || `Ad ${creative.adId}`}</h3>
            <p className="truncate text-xs text-white/50">{creative.campaignName}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: config.bgColor, color: config.color }}
              >
                {config.icon}
                {config.label}
              </span>
              <span className="text-[10px] text-white/40">{creative.creativeType.toUpperCase()}</span>
              <span
                className={`text-[10px] ${
                  creative.effectiveStatus === "ACTIVE" ? "text-green-400" : "text-white/40"
                }`}
              >
                {creative.effectiveStatus}
              </span>
            </div>
          </div>
        </div>

        {/* Score & Metrics */}
        <div className="flex items-center gap-4 pl-3">
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: config.color }}>
              {creative.scores.total}
            </div>
            <div className="text-[10px] text-white/50">Score</div>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold text-white">{primaryMetric.value}</div>
            <div className="text-[10px] text-white/50">{primaryMetric.label}</div>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-white/40 transition ${expanded ? "rotate-180" : ""}`}
          />
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="border-t border-white/10 p-4">
          {/* Score Breakdown */}
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <ScoreGauge score={creative.scores.value} label="Valor" icon={<Target className="h-4 w-4" />} />
            <ScoreGauge score={creative.scores.risk} label="Riesgo" icon={<Shield className="h-4 w-4" />} />
            <ScoreGauge score={creative.scores.alignment} label="Alineación" icon={<Zap className="h-4 w-4" />} />
          </div>

          {/* Metrics Grid */}
          <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg bg-white/[0.02] p-3 sm:grid-cols-4">
            <div>
              <span className="text-xs text-white/50">Gasto</span>
              <div className="text-sm font-medium text-white">{formatCurrency(creative.metrics.spend)}</div>
            </div>
            <div>
              <span className="text-xs text-white/50">Impresiones</span>
              <div className="text-sm font-medium text-white">{formatNumber(creative.metrics.impressions)}</div>
            </div>
            <div>
              <span className="text-xs text-white/50">Clicks</span>
              <div className="text-sm font-medium text-white">{formatNumber(creative.metrics.clicks)}</div>
            </div>
            <div>
              <span className="text-xs text-white/50">CTR</span>
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-white">{formatPercent(creative.metrics.ctr)}</span>
                {creative.deltas.ctr != null && (
                  <span className={`text-xs ${formatDelta(creative.deltas.ctr).color}`}>
                    {formatDelta(creative.deltas.ctr).text}
                  </span>
                )}
              </div>
            </div>
            {creative.userObjective === "ventas" && (
              <>
                <div>
                  <span className="text-xs text-white/50">Compras</span>
                  <div className="text-sm font-medium text-white">{formatNumber(creative.metrics.purchases)}</div>
                </div>
                <div>
                  <span className="text-xs text-white/50">Revenue</span>
                  <div className="text-sm font-medium text-white">{formatCurrency(creative.metrics.revenue)}</div>
                </div>
                <div>
                  <span className="text-xs text-white/50">ROAS</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm font-medium text-white">
                      {creative.metrics.roas?.toFixed(2)}x
                    </span>
                    {creative.deltas.roas != null && (
                      <span className={`text-xs ${formatDelta(creative.deltas.roas).color}`}>
                        {formatDelta(creative.deltas.roas).text}
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-white/50">CPA</span>
                  <div className="text-sm font-medium text-white">{formatCurrency(creative.metrics.cpa)}</div>
                </div>
              </>
            )}
            {creative.userObjective === "leads" && (
              <>
                <div>
                  <span className="text-xs text-white/50">Leads</span>
                  <div className="text-sm font-medium text-white">{formatNumber(creative.metrics.leads)}</div>
                </div>
                <div>
                  <span className="text-xs text-white/50">CPL</span>
                  <div className="text-sm font-medium text-white">{formatCurrency(creative.metrics.cpl)}</div>
                </div>
              </>
            )}
            {creative.userObjective === "alcance" && (
              <>
                <div>
                  <span className="text-xs text-white/50">Alcance</span>
                  <div className="text-sm font-medium text-white">{formatNumber(creative.metrics.reach)}</div>
                </div>
                <div>
                  <span className="text-xs text-white/50">Frecuencia</span>
                  <div className="text-sm font-medium text-white">
                    {creative.metrics.frequency?.toFixed(1) || "—"}
                  </div>
                </div>
                <div>
                  <span className="text-xs text-white/50">CPM</span>
                  <div className="text-sm font-medium text-white">{formatCurrency(creative.metrics.cpm)}</div>
                </div>
              </>
            )}
          </div>

          {/* Recommendations */}
          {creative.recommendations.length > 0 && (
            <div>
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/50">
                Recomendaciones
              </h4>
              <div className="space-y-2">
                {creative.recommendations.map((rec) => {
                  const catColors: Record<string, string> = {
                    scale: "border-l-green-400 bg-green-400/5",
                    optimize: "border-l-blue-400 bg-blue-400/5",
                    alert: "border-l-amber-400 bg-amber-400/5",
                    info: "border-l-purple-400 bg-purple-400/5",
                  };

                  return (
                    <div
                      key={rec.id}
                      className={`flex items-start gap-3 rounded-lg border-l-2 p-3 ${
                        catColors[rec.category] || catColors.info
                      } ${rec.checked ? "opacity-60" : ""}`}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRecommendationToggle(creative.adId, rec.id, !rec.checked);
                        }}
                        className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                          rec.checked
                            ? "border-green-500 bg-green-500 text-black"
                            : "border-white/30 bg-transparent hover:border-white/50"
                        }`}
                      >
                        {rec.checked && <Check className="h-3 w-3" />}
                      </button>
                      <div className="flex-1">
                        <p className={`text-sm ${rec.checked ? "line-through text-white/50" : "text-white/90"}`}>
                          {rec.message}
                        </p>
                        {rec.action && (
                          <p className="mt-1 text-xs text-white/50">
                            → {rec.action}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* =============== Main Page =============== */

export default function CreativeIntelligence() {
  const [params, setParams] = useSearchParams();
  const { ready, connected } = useOnboardingStatus();
  const showDisconnected = ready && !connected.meta;

  // Load accounts
  const { data: accountsData, loading: accountsLoading } = useCreativeAccounts();

  // State
  const [accountId, setAccountId] = useState<string>("");
  const [objective, setObjective] = useState<CreativeObjective>("ventas");
  const [localCreatives, setLocalCreatives] = useState<CreativeSnapshot[]>([]);
  const [resyncLoading, setResyncLoading] = useState(false);
  const [resyncMessage, setResyncMessage] = useState<string | null>(null);

  // Initialize from params/defaults
  useEffect(() => {
    if (!accountsData) return;

    const paramAccount = params.get("account_id") || "";
    const paramObjective = (params.get("objective") || "") as CreativeObjective;

    const resolvedAccount = paramAccount || accountsData.defaultAccountId || accountsData.accounts[0]?.id || "";
    const resolvedObjective =
      ["ventas", "alcance", "leads"].includes(paramObjective)
        ? paramObjective
        : accountsData.objective || "ventas";

    setAccountId(resolvedAccount);
    setObjective(resolvedObjective);
  }, [accountsData, params]);

  // Fetch creatives
  const { data, loading, error, refetch } = useCreativeIntelligence({
    accountId,
    objective,
    days: 7,
  });

  // Sync local creatives with data
  useEffect(() => {
    if (data?.creatives) {
      setLocalCreatives(data.creatives);
    }
  }, [data]);

  // Update URL params
  useEffect(() => {
    const newParams = new URLSearchParams();
    if (accountId) newParams.set("account_id", accountId);
    if (objective) newParams.set("objective", objective);
    setParams(newParams, { replace: true });
  }, [accountId, objective, setParams]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleResync = useCallback(async () => {
    setResyncLoading(true);
    setResyncMessage(null);
    try {
      const result = await resyncMetaAccounts();
      if (result.ok) {
        setResyncMessage(`✅ Encontradas ${result.stats?.total || 0} cuentas (${result.stats?.personal || 0} personales, ${result.stats?.fromBusinesses || 0} de negocios). Recarga la página.`);
        // Reload the page to get new accounts
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setResyncMessage(`❌ Error: ${result.error}`);
      }
    } catch (e) {
      setResyncMessage(`❌ Error: ${String(e)}`);
    } finally {
      setResyncLoading(false);
    }
  }, []);

  const handleRecommendationToggle = useCallback(
    async (adId: string, recId: string, checked: boolean) => {
      // Optimistic update
      setLocalCreatives((prev) =>
        prev.map((c) =>
          c.adId === adId
            ? {
                ...c,
                recommendations: c.recommendations.map((r) =>
                  r.id === recId ? { ...r, checked, checkedAt: checked ? new Date().toISOString() : null } : r
                ),
              }
            : c
        )
      );

      // Persist to backend
      await toggleRecommendationCheck(adId, recId, checked, accountId);
    },
    [accountId]
  );

  const accounts = accountsData?.accounts || [];

  return (
    <DashboardLayout>
      <div className="w-full min-w-0 overflow-x-hidden">
        {!ready ? (
          <div className="p-4 md:p-6">
            <div className="rounded-xl border border-border/60 bg-card/40 p-6 text-sm text-muted-foreground">
              Verificando integraciones…
            </div>
          </div>
        ) : showDisconnected ? (
          <div className="p-4 md:p-6">
            <DisconnectedIntegrationCard platform="meta" />
          </div>
        ) : (
          <>
            <CreativeIntelligenceHeader onRefresh={handleRefresh} loading={loading} />

            <div className="p-4 md:p-6">
              <div className="mx-auto max-w-[1400px] space-y-6">
                {/* Controls */}
                <div className="flex flex-wrap items-center gap-3">
                  {accounts.length > 0 && (
                    <AccountSelector accounts={accounts} selectedId={accountId} onChange={setAccountId} />
                  )}
                  <ObjectiveSelector value={objective} onChange={setObjective} />
                  
                  {/* Resync button */}
                  <button
                    onClick={handleResync}
                    disabled={resyncLoading}
                    className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60 transition hover:bg-white/10 hover:text-white/80 disabled:opacity-50"
                    title="Resincronizar cuentas de todos tus Business Managers"
                  >
                    <RotateCcw className={`h-3.5 w-3.5 ${resyncLoading ? "animate-spin" : ""}`} />
                    {resyncLoading ? "Sincronizando..." : "Buscar más cuentas"}
                  </button>
                </div>

                {/* Resync message */}
                {resyncMessage && (
                  <div className={`rounded-lg p-3 text-sm ${resyncMessage.startsWith("✅") ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                    {resyncMessage}
                  </div>
                )}

                {/* Error State */}
                {error && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
                    <strong>Error:</strong> {error}
                  </div>
                )}

                {/* Loading State */}
                {loading && !data && (
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-24 animate-pulse rounded-xl bg-white/5" />
                    ))}
                  </div>
                )}

                {/* Empty State */}
                {!loading && data && localCreatives.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.02] p-8 text-center">
                    <Sparkles className="mx-auto h-12 w-12 text-white/20" />
                    <h3 className="mt-4 text-lg font-medium text-white">Sin creativos activos</h3>
                    <p className="mt-2 text-sm text-white/50">
                      No se encontraron anuncios con actividad en los últimos 7 días para esta cuenta.
                    </p>
                  </div>
                )}

                {/* Summary Cards */}
                {data && localCreatives.length > 0 && <SummaryCards summary={data.summary} />}

                {/* Creative Cards */}
                {localCreatives.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-medium text-white/80">
                        {localCreatives.length} Creativos · Ordenados por Score
                      </h2>
                      {data?.dateRange && (
                        <span className="text-xs text-white/40">
                          {data.dateRange.since} → {data.dateRange.until}
                        </span>
                      )}
                    </div>
                    {localCreatives.map((creative) => (
                      <CreativeCard
                        key={creative.adId}
                        creative={creative}
                        accountId={accountId}
                        onRecommendationToggle={handleRecommendationToggle}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
