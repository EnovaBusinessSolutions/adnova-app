// dashboard-src/src/components/google-ads/GoogleAdsKPICards.tsx
import React, { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export type GoogleObjective = "ventas" | "alcance" | "leads";

export type GoogleKpis = {
  impressions?: number;
  clicks?: number;
  ctr?: number;          // ratio (0-1)
  cpc?: number;          // currency
  cost?: number;         // currency
  conversions?: number;
  conv_value?: number;   // currency
  cpa?: number;          // currency
  roas?: number;         // ratio x
  cpm?: number;          // currency (puede venir undefined)
  cvr?: number;          // ratio (0-1, puede venir undefined)
};

type Props = {
  objective?: GoogleObjective;
  kpis?: GoogleKpis | null;
  deltas?: Partial<Record<keyof GoogleKpis, number | null>> | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  currency?: string;
  locale?: string;
  compareLabel?: string; // “vs periodo anterior”
};

/* ================= helpers de formato ================= */
const makeMoneyFmt = (currency?: string, locale?: string) =>
  new Intl.NumberFormat(locale || "es-MX", {
    style: "currency",
    currency: currency || "MXN",
    maximumFractionDigits: 2,
  });

const makeIntFmt = (locale?: string) =>
  new Intl.NumberFormat(locale || "es-MX", { maximumFractionDigits: 0 });

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const toNum = (v: unknown): number | undefined =>
  isNum(v) ? (v as number) : undefined;

const fmtPercent = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(2)}%`;

const fmtX = (n?: number | null) =>
  n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}×`;

/* =========== cálculo derivado (sin inventar datos) =========== */
/** Completa CPM y CVR si no vienen del backend, usando KPIs base. */
function withDerived(k?: GoogleKpis | null): GoogleKpis | null {
  if (!k) return k ?? null;
  const out: GoogleKpis = { ...k };

  // CPM = (cost / impressions) * 1000
  if (!isNum(out.cpm)) {
    const cost = toNum(out.cost) ?? 0;
    const imp = toNum(out.impressions) ?? 0;
    out.cpm = imp > 0 ? (cost / imp) * 1000 : undefined;
  }

  // CVR = conversions / clicks
  if (!isNum(out.cvr)) {
    const conv = toNum(out.conversions) ?? 0;
    const clk = toNum(out.clicks) ?? 0;
    out.cvr = clk > 0 ? conv / clk : undefined;
  }

  // Refuerzos por si el backend no manda alguno
  if (!isNum(out.ctr)) {
    const imp = toNum(out.impressions) ?? 0;
    const clk = toNum(out.clicks) ?? 0;
    out.ctr = imp > 0 ? clk / imp : undefined;
  }
  if (!isNum(out.cpc)) {
    const clk = toNum(out.clicks) ?? 0;
    const cost = toNum(out.cost) ?? 0;
    out.cpc = clk > 0 ? cost / clk : undefined;
  }
  if (!isNum(out.cpa)) {
    const conv = toNum(out.conversions) ?? 0;
    const cost = toNum(out.cost) ?? 0;
    out.cpa = conv > 0 ? cost / conv : undefined;
  }
  if (!isNum(out.roas)) {
    const cost = toNum(out.cost) ?? 0;
    const val = toNum(out.conv_value) ?? 0;
    out.roas = cost > 0 ? val / cost : undefined;
  }

  return out;
}

/* ================= UI subcomponentes ================= */
function DeltaChip({
  value,
  label = "vs periodo anterior",
}: {
  value?: number | null;
  label?: string;
}) {
  if (value == null || !Number.isFinite(value)) return null;
  const pct = value * 100;
  const sign = pct === 0 ? "neutral" : pct > 0 ? "up" : "down";
  const cls =
    sign === "up"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
      : sign === "down"
      ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
      : "bg-slate-500/10 text-slate-300 ring-slate-400/20";
  const Icon =
    sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cls} max-w-fit self-start`}
    >
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(1)}% <span className="opacity-70 ml-1">{label}</span>
    </span>
  );
}

const Card: React.FC<{
  title: string;
  value: string;
  delta?: number | null;
  compareLabel?: string;
}> = ({ title, value, delta, compareLabel }) => (
  <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight">{value}</div>
    <DeltaChip value={delta} label={compareLabel} />
  </div>
);

const CardSkeleton: React.FC = () => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <div className="mb-3 h-4 w-24 rounded bg-muted" />
    <div className="mb-3 h-8 w-40 rounded bg-muted" />
    <div className="h-5 w-32 rounded bg-muted" />
  </div>
);

const ErrorState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
    <div className="mb-3 font-medium text-destructive-foreground">
      Ocurrió un error al obtener los KPIs.
    </div>
    {onRetry && (
      <Button variant="outline" onClick={onRetry} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Reintentar
      </Button>
    )}
  </div>
);

type Kind = "money" | "percent" | "x" | "int";

type CardDef =
  | {
      title: string;
      kind: Kind;
      key: keyof GoogleKpis;
      deltaKey?: keyof GoogleKpis | string;
    }
  | {
      title: string;
      kind: Kind;
      pick: (k?: GoogleKpis | null) => number | undefined;
      deltaKey?: keyof GoogleKpis | string;
    };

/** Conjuntos de KPIs por objetivo (igual que Meta). */
function cardsForObjective(objective: GoogleObjective): CardDef[] {
  if (objective === "alcance") {
    return [
      { key: "impressions", title: "Impresiones", kind: "int" },
      { key: "clicks",      title: "Clics",       kind: "int" },
      { key: "ctr",         title: "CTR",         kind: "percent" },
      { key: "cpc",         title: "CPC",         kind: "money" },
      { key: "cpm",         title: "CPM",         kind: "money" }, // derivable
      { key: "cost",        title: "Gasto Total", kind: "money" },
    ];
  }
  if (objective === "leads") {
    return [
      { key: "conversions", title: "Conversiones", kind: "int" },
      { key: "cpa",         title: "CPA",          kind: "money" }, // derivable
      { key: "ctr",         title: "CTR",          kind: "percent" },
      { key: "cpc",         title: "CPC",          kind: "money" },
      { key: "cvr",         title: "CVR",          kind: "percent" }, // derivable
      { key: "clicks",      title: "Clics",        kind: "int" },
      { key: "cost",        title: "Gasto Total",  kind: "money" },
    ];
  }
  // ventas
  return [
    { title: "Ingresos", kind: "money", pick: (k) => k?.conv_value, deltaKey: "conv_value" },
    { title: "Compras",  kind: "int",   pick: (k) => k?.conversions, deltaKey: "conversions" },
    { key: "roas",       title: "ROAS",        kind: "x" },
    { key: "cpa",        title: "CPA",         kind: "money" },
    { key: "ctr",        title: "CTR",         kind: "percent" },
    { key: "cpc",        title: "CPC",         kind: "money" },
    { key: "clicks",     title: "Clics",       kind: "int" },
    { key: "cost",       title: "Gasto Total", kind: "money" },
  ];
}

export default function GoogleAdsKPICards({
  objective = "ventas",
  kpis,
  deltas,
  loading,
  error,
  onRetry,
  currency = "MXN",
  locale = "es-MX",
  compareLabel = "vs periodo anterior",
}: Props) {
  const moneyFmt = makeMoneyFmt(currency, locale);
  const intFmt = makeIntFmt(locale);

  const safeKpis = useMemo(() => withDerived(kpis), [kpis]);

  const fmtMoney = (n?: number | null) =>
    n == null || !Number.isFinite(n) ? "—" : moneyFmt.format(n);

  const fmtInt = (n?: number | null) =>
    n == null || !Number.isFinite(n) ? "—" : intFmt.format(Math.round(n));

  // Si hay error PERO también hay KPIs, mostramos KPIs (no bloquea)
  const hasBlockingError = !!error && (!safeKpis || Object.keys(safeKpis).length === 0);
  const defs = cardsForObjective(objective);

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: defs.length }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (hasBlockingError) return <ErrorState onRetry={onRetry} />;

  if (!safeKpis) {
    return (
      <div className="rounded-2xl border p-6 text-sm text-muted-foreground">
        No hay KPIs para mostrar con el rango/objetivo actual.
        {onRetry && (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          </div>
        )}
      </div>
    );
  }

  const renderValue = (def: CardDef) => {
    const raw = "key" in def ? (safeKpis as any)?.[def.key] : def.pick?.(safeKpis ?? undefined);
    const n = toNum(raw);
    switch (def.kind) {
      case "money":   return fmtMoney(n);
      case "percent": return fmtPercent(n);
      case "x":       return fmtX(n);
      case "int":     return fmtInt(n);
    }
  };

  const getDelta = (def: CardDef) => {
    const key = "key" in def ? (def.deltaKey ?? def.key) : (def.deltaKey ?? "");
    if (!deltas || !key) return undefined;
    const v = (deltas as any)[key];
    return isNum(v) ? (v as number) : undefined;
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {defs.map((def, i) => (
        <Card
          key={("key" in def ? (def.key as string) : def.title) + "_" + i}
          title={def.title}
          value={renderValue(def)!}
          delta={getDelta(def)}
          compareLabel={compareLabel}
        />
      ))}
    </div>
  );
}
