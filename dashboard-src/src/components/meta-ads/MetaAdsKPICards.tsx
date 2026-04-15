// dashboard-src/src/components/meta-ads/MetaAdsKPICards.tsx
import React, { useMemo } from "react";
import type { MetaKpis, MetaObjective } from "@/hooks/useMetaInsights";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  objective: MetaObjective;
  kpis?: MetaKpis | null;
  deltas?: Record<string, number> | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  datePreset?: string;
  level?: "account" | "campaign" | "adset" | "ad";
  /** Divisa a usar para formatear dinero (ej. "USD", "MXN", "EUR"). */
  currencyCode?: string;
};

function fmtPercent(n: number | undefined | null) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : "0.00%";
}
function fmtX(n: number | undefined | null) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? `${v.toFixed(2)}×` : "0.00×";
}
function fmtInt(n: number | undefined | null) {
  const v = Number(n ?? 0);
  return Number.isFinite(v)
    ? new Intl.NumberFormat("es-MX").format(Math.round(v))
    : "0";
}

function DeltaChip({ value }: { value?: number }) {
  if (value === undefined || value === null || !Number.isFinite(value)) return null;
  const pct = value * 100;
  const sign = pct === 0 ? "neutral" : pct > 0 ? "up" : "down";
  const cls =
    sign === "up"
      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/20"
      : sign === "down"
      ? "bg-rose-500/10 text-rose-300 ring-rose-400/20"
      : "bg-slate-500/10 text-slate-300 ring-slate-400/20";
  const Icon = sign === "up" ? ArrowUpRight : sign === "down" ? ArrowDownRight : Minus;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cls} max-w-fit self-start`}>
      <Icon className="h-3.5 w-3.5" />
      {Math.abs(pct).toFixed(1)}% <span className="opacity-70 ml-1">vs mes anterior</span>
    </span>
  );
}

type CardDef = { key: keyof MetaKpis; title: string; kind: "money" | "percent" | "x" | "int" };

const Card: React.FC<{ title: string; value: string; delta?: number }> = ({ title, value, delta }) => (
  <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight">{value}</div>
    <DeltaChip value={delta} />
  </div>
);

function cardsForObjective(objective: MetaObjective): CardDef[] {
  if (objective === "alcance") {
    return [
      { key: "reach",       title: "Alcance",      kind: "int" },
      { key: "impressions", title: "Impresiones",  kind: "int" },
      { key: "frecuencia",  title: "Frecuencia",   kind: "x" },
      { key: "ctr",         title: "CTR",          kind: "percent" },
      { key: "gastoTotal",  title: "Gasto Total",  kind: "money" },
      { key: "clics",       title: "Clics",        kind: "int" },
      { key: "cpm",         title: "CPM",          kind: "money" },
    ];
  }
  if (objective === "leads") {
    return [
      { key: "leads",       title: "Leads",        kind: "int" },
      { key: "cpl",         title: "CPL",          kind: "money" },
      { key: "cvr",         title: "CVR",          kind: "percent" },
      { key: "ctr",         title: "CTR",          kind: "percent" },
      { key: "gastoTotal",  title: "Gasto Total",  kind: "money" },
      { key: "clics",       title: "Clics",        kind: "int" },
    ];
  }
  return [
    { key: "ingresos",       title: "Ingresos",          kind: "money" },
    { key: "compras",        title: "Compras",           kind: "int" },
    { key: "valorPorCompra", title: "Valor por compra",  kind: "money" },
    { key: "roas",           title: "ROAS",              kind: "x" },
    { key: "cpa",            title: "CPA",               kind: "money" },
    { key: "cvr",            title: "CVR",               kind: "percent" },
    { key: "ctr",            title: "CTR",               kind: "percent" },
    { key: "gastoTotal",     title: "Gasto Total",       kind: "money" },
    { key: "cpc",            title: "CPC",               kind: "money" },
    { key: "clics",          title: "Clics",             kind: "int" },
  ];
}

const CardSkeleton: React.FC = () => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <div className="h-4 w-24 bg-muted rounded mb-3" />
    <div className="h-8 w-40 bg-muted rounded mb-3" />
    <div className="h-5 w-32 bg-muted rounded" />
  </div>
);

const ErrorState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
    <div className="mb-3 font-medium text-destructive-foreground">
      Ocurrió un error al obtener los KPIs.
    </div>
    {onRetry && (
      <Button variant="outline" onClick={onRetry}>
        Reintentar
      </Button>
    )}
  </div>
);

const MetaAdsKPICards: React.FC<Props> = ({
  objective,
  kpis,
  deltas,
  loading,
  error,
  onRetry,
  currencyCode = "MXN",
}) => {
  // Formateador de moneda dinámico por divisa
  const moneyFmt = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: currencyCode || "MXN",
        maximumFractionDigits: 2,
      }),
    [currencyCode]
  );
  const fmtMoney = (n: number | undefined | null) => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? moneyFmt.format(v) : moneyFmt.format(0);
  };

  const valueByKind = (kind: CardDef["kind"], v: number | undefined | null) => {
    switch (kind) {
      case "money":   return fmtMoney(v);
      case "percent": return fmtPercent(v);
      case "x":       return fmtX(v);
      case "int":     return fmtInt(v);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (<CardSkeleton key={i} />))}
      </div>
    );
  }
  if (error) return <ErrorState onRetry={onRetry} />;

  const defs = cardsForObjective(objective);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {defs.map((def) => (
        <Card
          key={def.key as string}
          title={def.title}
          value={valueByKind(def.kind, (kpis as any)?.[def.key])!}
          delta={(deltas || undefined)?.[def.key as string]}
        />
      ))}
    </div>
  );
};

export default MetaAdsKPICards;
