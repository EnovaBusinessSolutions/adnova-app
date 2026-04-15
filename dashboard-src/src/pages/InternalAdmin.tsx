// dashboard-src/src/pages/InternalAdmin.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { DashboardLayout } from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Eye,
  EyeOff,
  ShieldCheck,
  Sparkles,
  Loader2,
  XCircle,
  Activity,
  TrendingUp,
  Users,
  ChevronRight,
  BarChart3,
  PieChart as PieIcon,
  LineChart as LineIcon,
  FileText,
} from "lucide-react";

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RTooltip,
  AreaChart,
  Area,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";

import InternalUsersTable from "@/components/internal-admin/InternalUsersTable";

import type { DateRange, RangePreset } from "@/lib/adminApi";

/* =============================================================================
  Types + Constants
============================================================================= */

type AnyObj = Record<string, any>;

/** ✅ FIX 1: TabKey faltaba (causaba "No se encuentra el nombre 'TabKey'") */
type TabKey = "resumen" | "graficos" | "funnel" | "usuarios";

const SS_KEY = "adray_internal_admin_token";

// ✅ Login event canonical + aliases (para no romper histórico)
const LOGIN_EVENT_ALIASES = ["user_logged_in", "user_login", "login"];

/**
 * ✅ ORDEN ESTÁTICO (CAPTURA):
 * SIEMPRE deben mostrarse estos 10 KPIs en este orden (con 0 si no existen en el rango)
 */
const STATIC_KPI_ORDER_10: string[] = [
  "user_signed_up",
  "welcome_email_sent",
  "email_verified",
  "google_connected",
  "google_ads_discovered",
  "google_ads_selected",
  "meta_connected",
  "meta_ads_discovered",
  "meta_ads_selected",
  "user_logged_in", // <- login agregado (sumando aliases)
];

/* =============================================================================
  API helper
============================================================================= */

async function apiAdmin(path: string, token: string, init?: RequestInit) {
  const r = await fetch(`/api/admin/analytics${path}`, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "x-internal-admin-token": token,
      ...(init?.headers || {}),
    },
  });

  const json = await r.json().catch(() => ({}));
  const data = (json?.data ?? json) as AnyObj;

  if (!r.ok || json?.ok === false) {
    const msg = String(
      json?.error || json?.details || data?.error || "UNAUTHORIZED"
    );
    throw new Error(msg);
  }

  return data;
}

/* =============================================================================
  Small utils
============================================================================= */

function cx(...c: Array<string | false | null | undefined>) {
  return c.filter(Boolean).join(" ");
}

function formatInt(n: any) {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return "0";
  return x.toLocaleString("es-MX");
}

function formatPct(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(1)}%`;
}

/** YYYY-MM-DD (local) */
function isoDay(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ✅ Rango por preset (solo 30d):
 * - from/to siempre YYYY-MM-DD (estable)
 * - IMPORTANTE: Ya NO mandamos cutoffDay desde frontend.
 *   El backend decide el cierre diario (ayer) con ANALYTICS_TZ.
 *
 * ✅ FIX 2: Esta función estaba incompleta (provocaba 2 rojos + error de parser)
 */
function makeRangePreset(preset: RangePreset): DateRange {
  // Preset único que usamos: "30d"
  const now = new Date();

  // to = hoy (el backend aplica cutoff a "ayer" si corresponde)
  const to = isoDay(now);

  // from = últimos 30 días (incluyendo hoy como extremo superior)
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - 29);
  const from = isoDay(fromDate);

  // DateRange exige cutoffDay:string según tu tooltip de TS.
  // NO lo mandamos al backend (buildRangeQs solo usa from/to),
  // así que lo dejamos como string vacío para cumplir el type.
  return {
    from,
    to,
    preset,
    cutoffDay: "",
  };
}

function buildQs(params: Record<string, any>) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const s = String(v).trim();
    if (!s) return;
    qs.set(k, s);
  });
  const out = qs.toString();
  return out ? `?${out}` : "";
}

/**
 * ✅ Panel interno siempre usa from/to (día).
 * ✅ NO mandamos cutoffDay para que el backend aplique:
 *    - default = AYER (último día completo) en ANALYTICS_TZ
 *    - clamp si lo necesitas (ya está en backend)
 */
function buildRangeQs(range: DateRange) {
  return { from: range.from, to: range.to };
}

/* =============================================================================
  Family-friendly event labels
============================================================================= */

const EVENT_LABELS: Record<string, string> = {
  user_signed_up: "Registros",
  welcome_email_sent: "Correo de bienvenida enviado",
  email_verified: "Correo verificado",
  google_connected: "Conectaron Google",
  google_ads_selected: "Seleccionaron Google Ads",
  ga4_selected: "Seleccionaron GA4",
  google_ads_discovered: "Detectamos cuentas Google Ads",
  ga4_discovered: "Detectamos propiedades GA4",
  meta_connected: "Conectaron Meta",
  meta_ads_selected: "Seleccionaron Meta Ads",
  meta_ads_discovered: "Detectamos cuentas Meta Ads",
  audit_requested: "Auditoría solicitada",
  audit_completed: "Auditoría completada",
  pixel_audit_done: "Auditoría de pixel completada",

  // ✅ Login (tu DB está guardando user_logged_in)
  user_logged_in: "Inicios de sesión",
  user_login: "Inicios de sesión",
  login: "Inicios de sesión",
};

function prettyEventName(name: any) {
  const k = String(name || "").trim();
  if (!k) return "—";
  return EVENT_LABELS[k] || k.replace(/_/g, " ");
}

/* =============================================================================
  Charts (theme-safe colors)
============================================================================= */

const CHART_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(var(--accent))",
  "hsl(var(--muted-foreground))",
  "hsl(var(--ring))",
  "hsl(var(--foreground))",
];

function chartColor(i: number) {
  return CHART_COLORS[i % CHART_COLORS.length];
}

/* =============================================================================
  UI components
============================================================================= */

function InlineMotionStyles() {
  return (
    <style>{`
      @keyframes adrayFloat { 0% { transform: translateY(0px); } 50% { transform: translateY(-6px); } 100% { transform: translateY(0px); } }
      @keyframes adrayGlowPulse { 0% { opacity: .35; transform: scale(1); } 50% { opacity: .65; transform: scale(1.04); } 100% { opacity: .35; transform: scale(1); } }
      @keyframes adrayShake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(6px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(4px); } }
      @keyframes adrayPopIn { 0% { opacity: 0; transform: translateY(10px) scale(.98); } 100% { opacity: 1; transform: translateY(0px) scale(1); } }
      @keyframes adraySweep { 0% { transform: translateX(-30%); opacity:.0; } 20% { opacity:.6; } 100% { transform: translateX(130%); opacity:0; } }
      @keyframes adrayFadeUp { 0% { opacity:0; transform: translateY(10px); } 100% { opacity:1; transform: translateY(0px); } }
      @keyframes adrayRing { 0% { transform: scale(.92); opacity:.55; } 60% { transform: scale(1.05); opacity:.15; } 100% { transform: scale(1.12); opacity:0; } }

      .adray-float { animation: adrayFloat 5.5s ease-in-out infinite; }
      .adray-glow { animation: adrayGlowPulse 3.6s ease-in-out infinite; }
      .adray-shake { animation: adrayShake .45s ease-in-out; }
      .adray-popin { animation: adrayPopIn .35s ease-out both; }
      .adray-fadeup { animation: adrayFadeUp .45s ease-out both; }
      .adray-sweep { animation: adraySweep 1.8s ease-in-out infinite; }
      .adray-ring { animation: adrayRing 1.4s ease-out infinite; }
    `}</style>
  );
}

function GlassShell({
  title,
  subtitle,
  children,
  className,
  icon,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cx("relative w-full", className)}>
      <div className="pointer-events-none absolute -inset-6 rounded-[28px] blur-2xl opacity-55">
        <div className="adray-glow absolute inset-0 rounded-[28px] bg-gradient-to-r from-violet-500/25 via-fuchsia-500/20 to-sky-500/25" />
      </div>

      <Card className="relative overflow-hidden border-white/10 bg-white/[0.035] shadow-[0_18px_55px_rgba(0,0,0,.55)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-violet-500/70 via-fuchsia-400/50 to-sky-400/60" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,rgba(255,255,255,.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.22)_1px,transparent_1px)] [background-size:28px_28px]" />
        <div className="pointer-events-none absolute -top-10 left-0 h-40 w-40 opacity-40">
          <div className="adray-sweep h-full w-full rounded-full bg-gradient-to-r from-white/0 via-white/20 to-white/0 blur-xl" />
        </div>

        <CardHeader className="relative">
          <CardTitle className="text-white flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
              {icon ?? <Sparkles className="h-4 w-4 text-white/80" />}
            </span>
            {title}
          </CardTitle>
          {subtitle ? (
            <CardDescription className="text-white/60">
              {subtitle}
            </CardDescription>
          ) : null}
        </CardHeader>

        <CardContent className="relative">{children}</CardContent>
      </Card>
    </div>
  );
}

function Pill({
  active,
  label,
  onClick,
  icon,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "relative inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm transition",
        active
          ? "border-white/20 bg-white/[0.10] text-white"
          : "border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
      )}
    >
      {active ? (
        <span className="relative inline-flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-60 adray-ring" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
        </span>
      ) : (
        <span className="h-2 w-2 rounded-full bg-white/20" />
      )}
      {icon ? <span className="text-white/70">{icon}</span> : null}
      {label}
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.05] px-2 py-1 text-[11px] text-white/75">
      {children}
    </span>
  );
}

/* =============================================================================
  Internal Dashboard (post-login)
============================================================================= */

function InternalAdminDashboard({
  token,
  onReset,
}: {
  token: string;
  onReset: () => void;
}) {
  const [bootLoading, setBootLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>("resumen");

  // ✅ Default: 30 días (preset único)
  const [rangePreset, setRangePreset] = useState<RangePreset>("30d");
  const range = useMemo(() => makeRangePreset(rangePreset), [rangePreset]);

  // Resumen
  const [summary, setSummary] = useState<any>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);

  // Funnel
  const [funnel, setFunnel] = useState<any>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelErr, setFunnelErr] = useState<string | null>(null);

  // Series (Gráficos)
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsErr, setInsightsErr] = useState<string | null>(null);
  const [insightsEvent, setInsightsEvent] = useState<string>("user_signed_up");
  const [insightsSeries, setInsightsSeries] = useState<any>(null);

  // Boot health
  useEffect(() => {
    let alive = true;
    setBootLoading(true);
    setBootError(null);

    apiAdmin("/health", token)
      .then((d) => alive && setHealth(d))
      .catch((e) => alive && setBootError(e?.message || "ERROR"))
      .finally(() => alive && setBootLoading(false));

    return () => {
      alive = false;
    };
  }, [token]);

  async function loadSummary() {
    setSummaryLoading(true);
    setSummaryErr(null);
    try {
      const d = await apiAdmin(`/summary${buildQs(buildRangeQs(range))}`, token);
      setSummary(d);
    } catch (e: any) {
      setSummaryErr(e?.message || "SUMMARY_ERROR");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadFunnel() {
    setFunnelLoading(true);
    setFunnelErr(null);
    try {
      const d = await apiAdmin(`/funnel${buildQs(buildRangeQs(range))}`, token);
      setFunnel(d);
    } catch (e: any) {
      setFunnelErr(e?.message || "FUNNEL_ERROR");
    } finally {
      setFunnelLoading(false);
    }
  }

  async function loadInsights(nextEvent?: string) {
    const name = String(nextEvent ?? insightsEvent ?? "").trim();
    setInsightsLoading(true);
    setInsightsErr(null);

    const qs = buildQs({
      name,
      groupBy: "day",
      ...buildRangeQs(range),
    });

    try {
      const d = await apiAdmin(`/series${qs}`, token);
      setInsightsSeries(d);
    } catch (e: any) {
      const msg = String(e?.message || "INSIGHTS_ERROR");
      setInsightsErr(msg);
    } finally {
      setInsightsLoading(false);
    }
  }

  // Auto-load por tab
  useEffect(() => {
    if (bootLoading || bootError) return;

    if (tab === "resumen" && !summary && !summaryLoading) loadSummary();

    if (tab === "graficos") {
      if (!summary && !summaryLoading) loadSummary();
      if (!insightsSeries && !insightsLoading) loadInsights();
    }

    if (tab === "funnel" && !funnel && !funnelLoading) loadFunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, bootLoading, bootError]);

  // Reload cuando cambia rango (aunque sea fijo)
  useEffect(() => {
    if (bootLoading || bootError) return;

    setSummary(null);
    setFunnel(null);
    setInsightsSeries(null);

    setInsightsEvent("user_signed_up");

    if (tab === "resumen") loadSummary();
    if (tab === "graficos") {
      loadSummary();
      loadInsights("user_signed_up");
    }
    if (tab === "funnel") loadFunnel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangePreset]);

  const loginCount = useMemo(() => {
    const fromBackend = summary?.loginEvents ?? summary?.logins ?? null;
    if (typeof fromBackend === "number" && Number.isFinite(fromBackend))
      return fromBackend;

    const list = Array.isArray(summary?.topEvents) ? summary.topEvents : [];
    let sum = 0;
    for (const it of list) {
      const nm = String(it?.name || "").trim();
      if (!nm) continue;
      if (LOGIN_EVENT_ALIASES.includes(nm)) {
        const c = Number(it?.count || 0);
        if (Number.isFinite(c)) sum += c;
      }
    }
    return sum;
  }, [summary]);

  const topEventsStatic10 = useMemo(() => {
    const raw = Array.isArray(summary?.topEvents) ? summary.topEvents : [];

    const counts = new Map<string, number>();
    for (const x of raw) {
      const name = String(x?.name || "").trim();
      const c = Number(x?.count || 0);
      if (!name) continue;
      if (!Number.isFinite(c)) continue;
      counts.set(name, (counts.get(name) || 0) + c);
    }

    let loginSum = 0;
    for (const k of LOGIN_EVENT_ALIASES) {
      loginSum += Number(counts.get(k) || 0);
    }

    const out: Array<{ name: string; label: string; count: number }> = [];

    for (const key of STATIC_KPI_ORDER_10) {
      if (key === "user_logged_in") {
        out.push({
          name: "user_logged_in",
          label: prettyEventName("user_logged_in"),
          count: Number.isFinite(loginSum) ? loginSum : 0,
        });
        continue;
      }

      const c = Number(counts.get(key) || 0);
      out.push({
        name: key,
        label: prettyEventName(key),
        count: Number.isFinite(c) ? c : 0,
      });
    }

    return out;
  }, [summary?.topEvents]);

  const topEventsForCharts = useMemo(() => {
    const base = Array.isArray(topEventsStatic10) ? topEventsStatic10 : [];
    return base
      .map((x: any) => ({
        name: String(x?.name || ""),
        label: String(x?.label || prettyEventName(x?.name)),
        count: Number(x?.count || 0),
        value: Number(x?.count || 0),
      }))
      .filter((x) => x.name)
      .filter((x) => x.count > 0);
  }, [topEventsStatic10]);

  const insightChips = useMemo(() => {
    return [...STATIC_KPI_ORDER_10];
  }, []);

  const seriesPointsForChart = useMemo(() => {
    const pts = Array.isArray(insightsSeries?.points) ? insightsSeries.points : [];
    return pts.map((p: any) => ({
      bucket: String(p?.bucket || "—"),
      count: Number(p?.count || 0),
      uniqueUsers: Number(p?.uniqueUsers || 0),
    }));
  }, [insightsSeries?.points]);

  const totalSeriesCount = useMemo(() => {
    return seriesPointsForChart.reduce(
      (a, b) => a + (Number(b?.count || 0) || 0),
      0
    );
  }, [seriesPointsForChart]);

  const rangeLabel = useMemo(() => {
    return "30 días";
  }, [rangePreset]);

  // ✅ Mostramos el corte REAL que devuelve backend (ayer / último día completo)
  const cutoffLabel = useMemo(() => {
    const v =
      summary?.cutoffEffectiveDay ||
      summary?.cutoffDay ||
      summary?.debug?.cutoffEffectiveDay ||
      summary?.debug?.cutoffDay ||
      null;
    return v ? String(v) : "—";
  }, [summary]);

  // Boot states
  if (bootLoading) {
    return (
      <div className="adray-popin">
        <GlassShell
          title="Panel interno"
          subtitle="Validando acceso…"
          icon={<ShieldCheck className="h-4 w-4 text-white/80" />}
        >
          <div className="flex items-center gap-3 text-white/75">
            <Loader2 className="h-4 w-4 animate-spin" />
            <div className="text-sm">Conectando…</div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-20 rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse"
              />
            ))}
          </div>
          <div className="mt-3 h-40 rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
        </GlassShell>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="adray-popin">
        <GlassShell
          title="Acceso denegado"
          subtitle="La clave no es válida o el backend no reconoce el token."
          className="adray-shake"
          icon={<XCircle className="h-4 w-4 text-red-200" />}
        >
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10">
              <XCircle className="h-4 w-4 text-red-200" />
            </span>
            <div className="text-sm text-white/75">
              Error: <span className="text-white/90">{bootError}</span>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button variant="destructive" onClick={onReset} className="rounded-xl">
              Cambiar clave
            </Button>
          </div>
        </GlassShell>
      </div>
    );
  }

  return (
    <div className="adray-popin space-y-4">
      <GlassShell
        title="Internal Analytics"
        subtitle={`Conectado${health?.env ? ` • ${health.env}` : ""}${
          health?.db ? ` • DB: ${health.db}` : ""
        }`}
        icon={<ShieldCheck className="h-4 w-4 text-white/85" />}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-white/80">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] adray-float">
              <Activity className="h-4 w-4 text-white/85" />
            </span>
            <div>
              <div className="text-sm font-semibold text-white">
                Panel interno de analítica
              </div>
              <div className="text-xs text-white/55">
                Rango:{" "}
                <span className="text-white/85 font-semibold">{rangeLabel}</span>
                <span className="text-white/45"> • </span>
                <span className="text-white/80">{range.from}</span> →{" "}
                <span className="text-white/80">{range.to}</span>
                <span className="text-white/45"> • </span>
                <span className="text-white/65">
                  corte:{" "}
                  <span className="text-white/80 font-semibold">
                    {cutoffLabel}
                  </span>
                </span>
                {health?.version ? (
                  <span className="text-white/45">
                    {" "}
                    • build {String(health.version).slice(0, 10)}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ✅ Preset único: 30 días */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              <button
                className={cx(
                  "px-3 py-2 text-xs rounded-xl transition",
                  "bg-white/[0.10] text-white"
                )}
                onClick={() => setRangePreset("30d")}
                title="Ventana fija de 30 días"
              >
                30 días
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-5 flex flex-wrap gap-2">
          <Pill
            active={tab === "resumen"}
            label="Resumen"
            onClick={() => setTab("resumen")}
            icon={<FileText className="h-4 w-4" />}
          />
          <Pill
            active={tab === "graficos"}
            label="Gráficos"
            onClick={() => setTab("graficos")}
            icon={<BarChart3 className="h-4 w-4" />}
          />
          <Pill
            active={tab === "funnel"}
            label="Funnel"
            onClick={() => setTab("funnel")}
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <Pill
            active={tab === "usuarios"}
            label="Usuarios"
            onClick={() => setTab("usuarios")}
            icon={<Users className="h-4 w-4" />}
          />
        </div>

        {/* Content */}
        <div className="mt-5 space-y-4">
          {/* ===================== RESUMEN ===================== */}
          {tab === "resumen" ? (
            <div className="adray-fadeup space-y-4">
              {/* ✅ KPIs */}
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/55">Eventos (rango)</div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                      <Activity className="h-4 w-4 text-white/75" />
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {summaryLoading ? "…" : formatInt(summary?.events)}
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Total eventos en ventana
                  </div>
                </div>

                {/* ✅ LOGIN COUNT */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/55">Inicios de sesión</div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                      <ChevronRight className="h-4 w-4 text-white/75" />
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {summaryLoading ? "…" : formatInt(loginCount)}
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Conteo REAL (evento user_logged_in)
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-white/55">Registros</div>
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06]">
                      <Users className="h-4 w-4 text-white/75" />
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {summaryLoading ? "…" : formatInt(summary?.signups)}
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Evento: user_signed_up
                  </div>
                </div>
              </div>

              {summaryErr ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100/90">
                  Error cargando resumen: {summaryErr}
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-sm font-semibold text-white">
                    KPIs (orden fijo)
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Siempre los mismos 10 KPIs, siempre en el mismo orden (como la
                    captura).
                  </div>

                  <div className="mt-4 space-y-2">
                    {topEventsStatic10.map((x: any, idx: number) => {
                      const name = String(x?.name || "—");
                      const count = Number(x?.count || 0);
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
                        >
                          <div className="text-sm text-white/85">
                            {prettyEventName(name)}
                            <div className="text-[11px] text-white/40">{name}</div>
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {summaryLoading ? "…" : formatInt(count)}
                          </div>
                        </div>
                      );
                    })}

                    {summaryLoading ? (
                      <div className="h-24 rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-sm font-semibold text-white">
                    Acciones rápidas
                  </div>
                  <div className="mt-1 text-xs text-white/45">
                    Atajos típicos para marketing/soporte.
                  </div>

                  <div className="mt-4 grid gap-2">
                    <button
                      className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left hover:bg-white/[0.08]"
                      onClick={() => setTab("graficos")}
                    >
                      <div>
                        <div className="text-sm font-semibold text-white/90">
                          Gráficas
                        </div>
                        <div className="text-xs text-white/50">
                          distribución, top y tendencia
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-white/60 group-hover:text-white" />
                    </button>

                    <button
                      className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left hover:bg-white/[0.08]"
                      onClick={() => {
                        setTab("funnel");
                        setFunnel(null);
                        setTimeout(() => loadFunnel(), 50);
                      }}
                    >
                      <div>
                        <div className="text-sm font-semibold text-white/90">
                          Funnel general
                        </div>
                        <div className="text-xs text-white/50">
                          registro → conexiones → auditorías
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-white/60 group-hover:text-white" />
                    </button>

                    <button
                      className="group flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left hover:bg-white/[0.08]"
                      onClick={() => setTab("usuarios")}
                    >
                      <div>
                        <div className="text-sm font-semibold text-white/90">
                          Usuarios (CRM)
                        </div>
                        <div className="text-xs text-white/50">
                          registro, último login, selecciones, métricas 30D
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-white/60 group-hover:text-white" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* ===================== GRÁFICOS ===================== */}
          {tab === "graficos" ? (
            <div className="adray-fadeup space-y-4">
              <div className="flex flex-col gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Panel de gráficas
                  </div>
                  <div className="text-xs text-white/45">
                    Distribución, top y tendencia — usando ÚNICAMENTE los KPIs del resumen.
                  </div>
                </div>
              </div>

              {insightsErr ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100/90">
                  Error cargando gráficas: {insightsErr}
                </div>
              ) : null}

              {/* Donut */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-white">
                  <PieIcon className="h-4 w-4 text-white/70" />
                  <div className="text-sm font-semibold">
                    Distribución de KPIs (Resumen)
                  </div>
                </div>
                <div className="mt-1 text-xs text-white/45">
                  Solo los 10 KPIs del resumen (mismo orden y mismas etiquetas).
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="h-[320px]">
                    {summaryLoading ? (
                      <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
                    ) : topEventsForCharts.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={topEventsForCharts}
                            dataKey="value"
                            nameKey="label"
                            innerRadius={72}
                            outerRadius={120}
                            paddingAngle={2}
                          >
                            {topEventsForCharts.map((_, i) => (
                              <Cell key={`cell-${i}`} fill={chartColor(i)} />
                            ))}
                          </Pie>

                          <RTooltip
                            content={({ active, payload }: any) => {
                              if (!active || !payload?.length) return null;
                              const p = payload[0]?.payload;
                              return (
                                <div className="rounded-2xl border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-xs text-white shadow-xl">
                                  <div className="font-semibold">{p?.label}</div>
                                  <div className="text-white/70">
                                    {formatInt(p?.count)} eventos
                                  </div>
                                </div>
                              );
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full rounded-2xl border border-white/10 bg-white/[0.02] flex items-center justify-center text-sm text-white/55">
                        Sin datos en esta ventana.
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="text-xs text-white/55">Leyenda</div>
                    <div className="mt-2 max-h-[280px] space-y-2 overflow-auto pr-2">
                      {topEventsStatic10.map((it: any, i: number) => (
                        <div
                          key={`${it.name}-${i}`}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ background: chartColor(i) }}
                            />
                            <div className="min-w-0">
                              <div className="truncate text-sm text-white/85">
                                {it.label}
                              </div>
                              <div className="truncate text-[11px] text-white/40">
                                {it.name}
                              </div>
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-white">
                            {formatInt(it.count)}
                          </div>
                        </div>
                      ))}

                      {!summaryLoading && topEventsStatic10.length === 0 ? (
                        <div className="text-sm text-white/55">
                          Sin datos en esta ventana.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {/* Top eventos (barras horizontales) */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-white">
                  <BarChart3 className="h-4 w-4 text-white/70" />
                  <div className="text-sm font-semibold">Top KPIs (Resumen)</div>
                </div>
                <div className="mt-1 text-xs text-white/45">
                  Barras horizontales (solo KPIs del resumen).
                </div>

                <div className="mt-4 h-[380px]">
                  {summaryLoading ? (
                    <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={topEventsStatic10.map((x) => ({
                          label: x.label,
                          count: Number(x.count || 0),
                        }))}
                        layout="vertical"
                        margin={{ top: 8, right: 18, left: 18, bottom: 8 }}
                      >
                        <CartesianGrid
                          stroke="rgba(255,255,255,.08)"
                          horizontal={false}
                        />
                        <XAxis
                          type="number"
                          tick={{ fill: "rgba(255,255,255,.65)", fontSize: 11 }}
                          axisLine={{ stroke: "rgba(255,255,255,.10)" }}
                          tickLine={{ stroke: "rgba(255,255,255,.10)" }}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={210}
                          tick={{ fill: "rgba(255,255,255,.70)", fontSize: 12 }}
                          axisLine={{ stroke: "rgba(255,255,255,.10)" }}
                          tickLine={{ stroke: "rgba(255,255,255,.10)" }}
                        />
                        <RTooltip
                          content={({ active, payload, label }: any) => {
                            if (!active || !payload?.length) return null;
                            return (
                              <div className="rounded-2xl border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-xs text-white shadow-xl">
                                <div className="font-semibold">{label}</div>
                                <div className="text-white/70">
                                  {formatInt(payload[0]?.value)} eventos
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="count"
                          fill="hsl(var(--primary))"
                          radius={[10, 10, 10, 10]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Tendencia */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-white">
                      <LineIcon className="h-4 w-4 text-white/70" />
                      <div className="text-sm font-semibold">Tendencia diaria</div>
                    </div>
                    <div className="mt-1 text-xs text-white/45">
                      Evento:{" "}
                      <span className="text-white/80 font-semibold">
                        {prettyEventName(insightsEvent)}
                      </span>{" "}
                      <span className="text-white/40">({insightsEvent})</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>Rango: {rangeLabel}</Chip>
                    <Chip>{formatInt(totalSeriesCount)} eventos</Chip>
                    <Chip>corte: {cutoffLabel}</Chip>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip>Evento de tendencia</Chip>

                    {insightChips.length ? (
                      insightChips.map((name, i) => {
                        const active = name === insightsEvent;
                        return (
                          <button
                            key={`${name}-${i}`}
                            type="button"
                            onClick={() => {
                              setInsightsEvent(name);
                              setInsightsSeries(null);
                              setTimeout(() => loadInsights(name), 0);
                            }}
                            className={cx(
                              "rounded-2xl border px-3 py-2 text-xs transition",
                              active
                                ? "border-white/20 bg-white/[0.10] text-white"
                                : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08]"
                            )}
                            title={name}
                          >
                            {prettyEventName(name)}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-xs text-white/50">Cargando eventos…</span>
                    )}
                  </div>

                  <div className="text-[11px] text-white/35">
                    {prettyEventName(insightsEvent)}{" "}
                    <span className="text-white/25">({insightsEvent})</span>
                  </div>
                </div>

                <div className="mt-4 h-[360px]">
                  {insightsLoading ? (
                    <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={seriesPointsForChart}
                        margin={{ top: 10, right: 18, left: 6, bottom: 12 }}
                      >
                        <CartesianGrid stroke="rgba(255,255,255,.08)" />
                        <XAxis
                          dataKey="bucket"
                          tick={{ fill: "rgba(255,255,255,.65)", fontSize: 11 }}
                          tickMargin={8}
                          interval="preserveStartEnd"
                          axisLine={{ stroke: "rgba(255,255,255,.10)" }}
                          tickLine={{ stroke: "rgba(255,255,255,.10)" }}
                        />
                        <YAxis
                          tick={{ fill: "rgba(255,255,255,.65)", fontSize: 11 }}
                          width={40}
                          axisLine={{ stroke: "rgba(255,255,255,.10)" }}
                          tickLine={{ stroke: "rgba(255,255,255,.10)" }}
                        />
                        <RTooltip
                          content={({ active, payload, label }: any) => {
                            if (!active || !payload?.length) return null;
                            const p0 = payload[0];
                            return (
                              <div className="rounded-2xl border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-xs text-white shadow-xl">
                                <div className="font-semibold">{label}</div>
                                <div className="text-white/70">
                                  Eventos: {formatInt(p0?.value)}
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Area
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          fill="hsl(var(--primary))"
                          fillOpacity={0.22}
                        />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke="hsl(var(--primary))"
                          dot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {/* ===================== FUNNEL ===================== */}
          {tab === "funnel" ? (
            <div className="adray-fadeup space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-white">Funnel</div>
                  <div className="text-xs text-white/45">
                    Usuarios únicos por paso (ventana seleccionada).
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.09]"
                  onClick={() => loadFunnel()}
                  disabled={funnelLoading}
                >
                  {funnelLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : null}
                  Recargar
                </Button>
              </div>

              {funnelErr ? (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-100/90">
                  Error cargando funnel: {funnelErr}
                </div>
              ) : null}

              {funnelLoading ? (
                <div className="h-56 rounded-2xl border border-white/10 bg-white/[0.04] animate-pulse" />
              ) : (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="text-xs text-white/45">
                    Total usuarios con al menos 1 evento en steps:{" "}
                    <span className="text-white/80 font-semibold">
                      {formatInt(funnel?.totalUsersInWindow)}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    {(funnel?.funnel || []).map((row: any, idx: number) => {
                      const users = Number(row?.users || 0);
                      const step = String(row?.step || `step_${idx}`);
                      const pretty = prettyEventName(step);

                      const widthPct =
                        idx === 0
                          ? "100%"
                          : (() => {
                              const prev = Number(
                                funnel?.funnel?.[idx - 1]?.users || 0
                              );
                              const pct =
                                prev > 0
                                  ? Math.min(
                                      100,
                                      Math.max(0, (users / prev) * 100)
                                    )
                                  : 0;
                              return `${pct}%`;
                            })();

                      return (
                        <div key={idx}>
                          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white/90">
                                  {idx + 1}. {pretty}
                                </div>
                                <div className="text-xs text-white/50">{step}</div>
                              </div>

                              <div className="text-right">
                                <div className="text-xs text-white/55">Usuarios</div>
                                <div className="text-lg font-semibold text-white">
                                  {formatInt(users)}
                                </div>
                              </div>
                            </div>

                            <div className="mt-3 h-2 w-full rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-violet-500/70 via-fuchsia-400/60 to-sky-400/70"
                                style={{ width: widthPct }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {!funnelLoading &&
                    (!funnel?.funnel || funnel.funnel.length === 0) ? (
                      <div className="text-sm text-white/55">
                        No hay datos de funnel en esta ventana.
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* ===================== USUARIOS (CRM) ===================== */}
          {tab === "usuarios" ? (
            <div className="adray-fadeup space-y-4">
              <InternalUsersTable token={token} range={range} />
            </div>
          ) : null}
        </div>
      </GlassShell>
    </div>
  );
}

/* =============================================================================
  Page (login + dashboard)
============================================================================= */

export default function InternalAdmin() {
  const [tokenInput, setTokenInput] = useState("");
  const [token, setToken] = useState<string | null>(null);

  const [show, setShow] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [shake, setShake] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(SS_KEY);
    if (saved) setToken(saved);
  }, []);

  const hasToken = useMemo(() => !!(token && token.trim()), [token]);

  function setAndPersist(t: string) {
    sessionStorage.setItem(SS_KEY, t);
    setToken(t);
  }

  function resetToken() {
    sessionStorage.removeItem(SS_KEY);
    setToken(null);
    setTokenInput("");
    setAttempted(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function onEnter() {
    const t = tokenInput.trim();
    setAttempted(true);

    if (!t) {
      setShake(true);
      setTimeout(() => setShake(false), 450);
      inputRef.current?.focus();
      return;
    }

    setAndPersist(t);
  }

  return (
    <DashboardLayout>
      <InlineMotionStyles />

      <div className="max-w-6xl mx-auto w-full p-4 space-y-4">
        {!hasToken ? (
          <div className="adray-popin">
            <GlassShell
              title="Bienvenido, equipo Adray"
              subtitle="Ingresa la clave interna para acceder al panel de analítica."
              className={cx(shake ? "adray-shake" : "")}
              icon={<Sparkles className="h-4 w-4 text-white/80" />}
            >
              <div className="space-y-3">
                <div className="relative">
                  <Input
                    ref={inputRef}
                    type={show ? "text" : "password"}
                    placeholder="Clave interna"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onEnter();
                    }}
                    className={cx(
                      "pr-12 rounded-2xl border-white/10 bg-white/[0.03] text-white placeholder:text-white/35",
                      attempted && !tokenInput.trim() ? "border-red-500/30" : ""
                    )}
                  />

                  <button
                    type="button"
                    aria-label={show ? "Ocultar clave" : "Mostrar clave"}
                    onClick={() => setShow((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]"
                  >
                    {show ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>

                {attempted && !tokenInput.trim() ? (
                  <div className="text-xs text-red-200/90">
                    Ingresa la clave para continuar.
                  </div>
                ) : null}

                <div className="flex gap-2">
                  <Button onClick={onEnter} className="rounded-xl">
                    Entrar
                  </Button>

                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTokenInput("");
                      setAttempted(false);
                      setTimeout(() => inputRef.current?.focus(), 30);
                    }}
                    className="rounded-xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.09]"
                  >
                    Limpiar
                  </Button>
                </div>
              </div>
            </GlassShell>
          </div>
        ) : (
          <InternalAdminDashboard token={token!} onReset={resetToken} />
        )}
      </div>
    </DashboardLayout>
  );
}
