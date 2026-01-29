// dashboard-src/src/components/google-analytics/SalesKPIs.tsx
import React, { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useGAOverview } from "@/hooks/useGAOverview";

type Props = {
  revenue: number;
  purchases: number;
  aov: number;
  purchaseConversionRate: number; // 0–1
  loading?: boolean;
  /** Si lo pasas, tiene prioridad. Si no, se intentará leer del hook/useGAOverview */
  currencyCode?: string;
  deltas?: {
    revenue: number | null;
    purchases: number | null;
    aov: number | null;
    purchaseConversionRate: number | null;
  } | null;
};

// % y enteros se pueden quedar fuera del hook
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const int = (n: number) => new Intl.NumberFormat("es-MX").format(Math.round(n));

function DeltaChip({ value }: { value?: number | null }) {
  if (value === null || value === undefined) return null;
  const pctVal = value * 100;
  const sign = pctVal === 0 ? "neutral" : pctVal > 0 ? "up" : "down";
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
      {Math.abs(pctVal).toFixed(1)}% <span className="opacity-70 ml-1">vs mes anterior</span>
    </span>
  );
}

const Card: React.FC<{ title: string; value: string; delta?: number | null }> = ({ title, value, delta }) => (
  <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
    <div className="text-sm text-muted-foreground">{title}</div>
    <div className="text-3xl font-semibold tracking-tight">{value}</div>
    <DeltaChip value={delta} />
  </div>
);

const SalesKPIs: React.FC<Props> = ({
  revenue,
  purchases,
  aov,
  purchaseConversionRate,
  loading,
  currencyCode,
  deltas,
}) => {
  // Intento de descubrimiento de divisa si no se pasa por props
  const state: any = useGAOverview() as any;
  const data: any = state?.data ?? state ?? {};

  const resolvedCurrency: string =
    currencyCode ||
    state?.currency ||
    data?.currency ||
    data?.kpis?.currency ||
    data?.kpis?.currencyCode ||
    data?.kpis?.currency_code ||
    "USD";

  const moneyFmt = useMemo(
    () =>
      new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: resolvedCurrency,
        maximumFractionDigits: 0, // como en tus capturas de GA
      }),
    [resolvedCurrency]
  );

  const money = (n: number) => moneyFmt.format(n);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-5">
            <div className="h-4 w-24 bg-muted rounded mb-3" />
            <div className="h-8 w-40 bg-muted rounded mb-3" />
            <div className="h-5 w-32 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Card title="Ingresos" value={money(revenue)} delta={deltas?.revenue ?? null} />
      <Card title="Órdenes" value={int(purchases)} delta={deltas?.purchases ?? null} />
      <Card title="AOV" value={money(aov)} delta={deltas?.aov ?? null} />
      <Card title="Tasa de compra" value={pct(purchaseConversionRate)} delta={deltas?.purchaseConversionRate ?? null} />
    </div>
  );
};

export default SalesKPIs;
